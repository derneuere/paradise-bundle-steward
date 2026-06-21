// Regression: repeated saving must not forget earlier TRK COL edits.
//
// User report (2026-06-21): after editing one TRK COL (polygonSoupList
// instance), switching to another, and saving, the FIRST instance's edits were
// dropped from the exported bundle. PR #133 fixed the original broadcast
// corruption and a SINGLE save that touches several instances at once (see the
// "single save" control). The case it missed was REPEATED saving.
//
// Old root cause: WorkspaceContext.saveBundle rebuilt output from the pristine
// `originalArrayBuffer` and only re-applied the resources currently in
// `dirtyMulti`, then ran `clearBundleDirty`. So a second save saw only the
// instance edited since the first save as dirty; every instance edited-and-
// saved earlier was no longer dirty, absent from the override maps, and passed
// through from the ORIGINAL (un-edited) bytes — silently reverting its edit.
//
// Fix: after a same-platform save, `saveBundle` re-bases the bundle onto the
// just-written bytes (`rebaseEditableBundle`) instead of only clearing dirty,
// so previously-saved edits are already baked into the new baseline and pass
// through verbatim on the next save. This test models that save step and pins
// the behaviour with a real WORLDCOL.BIN round-trip.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { makeEditableBundle, rebaseEditableBundle } from '../WorkspaceContext.bundle';
import {
	applyResourceWriteToBundle,
	buildSingleInstanceOverrides,
} from '../WorkspaceContext.helpers';
import {
	buildByResourceIdOverrides,
	keyedOverridesToTypeIdMap,
} from '../WorkspaceContext';
import { writeBundleFresh, parseBundle } from '@/lib/core/bundle';
import { extractResourceRaw } from '@/lib/core/registry/extract';
import { resourceCtxFromBundle } from '@/lib/core/registry/handler';
import { registry } from '@/lib/core/registry';
import { u64ToBigInt } from '@/lib/core/u64';
import type { EditableBundle } from '../WorkspaceContext.types';
import type { ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';

const PSL_KEY = 'polygonSoupList';
const PSL_TYPE_ID = 0x43;
const WORLDCOL = path.resolve(__dirname, '../../../example/WORLDCOL.BIN');

function loadWorldcol(): EditableBundle {
	const raw = fs.readFileSync(WORLDCOL);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return makeEditableBundle(bytes.buffer, 'WORLDCOL.BIN');
}

function pslList(bundle: EditableBundle): (ParsedPolygonSoupList | null)[] {
	return (bundle.parsedResourcesAll.get(PSL_KEY) ?? []) as (ParsedPolygonSoupList | null)[];
}

// First two PSL instances with a polygon to edit.
function firstTwoPopulated(bundle: EditableBundle): [number, number] {
	const list = pslList(bundle);
	const out: number[] = [];
	for (let i = 0; i < list.length && out.length < 2; i++) {
		const m = list[i];
		if (m && m.soups.length > 0 && m.soups[0].polygons.length > 0) out.push(i);
	}
	if (out.length < 2) throw new Error('WORLDCOL needs ≥2 populated polygonSoupList instances');
	return [out[0], out[1]];
}

// Resource-id hex for the n-th 0x43 resource — the key the writer routes a
// byResourceId override through. Stable across saves (the writer preserves ids).
function idHexOfNthPsl(bundle: EditableBundle, nth: number): string {
	let seen = 0;
	for (const r of bundle.parsed.resources) {
		if (r.resourceTypeId !== PSL_TYPE_ID) continue;
		if (seen === nth) {
			return `0x${u64ToBigInt(r.resourceId).toString(16).toUpperCase().padStart(16, '0')}`;
		}
		seen++;
	}
	throw new Error(`no ${nth}-th polygonSoupList resource`);
}

// Bump the first polygon's collisionTag without aliasing the original arrays
// (mirrors how the inspector / PSL bulk path produces an edited model).
function withFirstPolyTag(model: ParsedPolygonSoupList, tag: number): ParsedPolygonSoupList {
	const s0 = model.soups[0];
	const p0 = s0.polygons[0];
	const ns0 = { ...s0, polygons: [{ ...p0, collisionTag: tag >>> 0 }, ...s0.polygons.slice(1)] };
	return { ...model, soups: [ns0, ...model.soups.slice(1)] };
}

// Re-parse exported bytes → first polygon's collisionTag for resource `idHex`.
function tagAfterSave(exported: ArrayBuffer, idHex: string): number {
	const reparsed = parseBundle(exported);
	const ctx = resourceCtxFromBundle(reparsed);
	const handler = registry.find((h) => h.typeId === PSL_TYPE_ID)!;
	const r = reparsed.resources.find(
		(res) =>
			res.resourceTypeId === PSL_TYPE_ID &&
			`0x${u64ToBigInt(res.resourceId).toString(16).toUpperCase().padStart(16, '0')}` === idHex,
	);
	if (!r) throw new Error(`resource ${idHex} missing after save`);
	const raw = extractResourceRaw(exported, reparsed, r);
	const model = handler.parseRaw(raw, ctx) as ParsedPolygonSoupList;
	return model.soups[0].polygons[0].collisionTag >>> 0;
}

// Faithful mirror of one WorkspaceContext.saveBundle invocation: build overrides
// from the current dirty set, write from `originalArrayBuffer`, then (same-
// platform) re-base the bundle onto the written bytes — exactly the provider's
// post-save step. Returns the exported bytes and the next bundle state.
function performSave(bundle: EditableBundle): { bytes: ArrayBuffer; next: EditableBundle } {
	const byResourceId = buildByResourceIdOverrides(
		bundle.parsed,
		bundle.parsedResourcesAll,
		bundle.dirtyMulti,
	);
	const filteredSingle = buildSingleInstanceOverrides(
		bundle.parsedResources,
		bundle.parsedResourcesAll,
		bundle.dirtyMulti,
	);
	const bytes = writeBundleFresh(bundle.parsed, bundle.originalArrayBuffer, {
		includeDebugData: true,
		overrides: {
			resources: keyedOverridesToTypeIdMap(filteredSingle),
			byResourceId,
		},
	});
	return { bytes, next: rebaseEditableBundle(bundle, bytes) };
}

const TAG_A = 0x0badf00d;
const TAG_B = 0x0c0ffee0;

describe.skipIf(!fs.existsSync(WORLDCOL))('WORLDCOL repeated-save edit retention', () => {
	// Control: a SINGLE save that covers both edits round-trips fine. This is
	// the path PR #133 fixed; it documents that the override-building + writer
	// are correct when the dirty set still holds every edit.
	it('control — one save covering both instances keeps both edits', () => {
		let bundle = loadWorldcol();
		const [idxA, idxB] = firstTwoPopulated(bundle);
		const idHexA = idHexOfNthPsl(bundle, idxA);
		const idHexB = idHexOfNthPsl(bundle, idxB);

		bundle = applyResourceWriteToBundle(bundle, PSL_KEY, idxA, withFirstPolyTag(pslList(bundle)[idxA]!, TAG_A));
		bundle = applyResourceWriteToBundle(bundle, PSL_KEY, idxB, withFirstPolyTag(pslList(bundle)[idxB]!, TAG_B));

		const { bytes } = performSave(bundle);
		expect(tagAfterSave(bytes, idHexA)).toBe(TAG_A);
		expect(tagAfterSave(bytes, idHexB)).toBe(TAG_B);
	});

	// The reported bug: edit A → save → edit B → save again. Before the fix the
	// second file dropped A's edit (A was no longer dirty and the writer rebuilt
	// from the original bytes). With the re-base, A's edit is baked into the new
	// baseline after the first save and survives the second.
	it('edit A → save → edit B → save again keeps instance A’s edit', () => {
		let bundle = loadWorldcol();
		const [idxA, idxB] = firstTwoPopulated(bundle);
		const idHexA = idHexOfNthPsl(bundle, idxA);
		const idHexB = idHexOfNthPsl(bundle, idxB);

		// 1) Edit instance A and SAVE. First export is correct; the provider
		//    then re-bases the bundle onto these bytes.
		bundle = applyResourceWriteToBundle(bundle, PSL_KEY, idxA, withFirstPolyTag(pslList(bundle)[idxA]!, TAG_A));
		const save1 = performSave(bundle);
		expect(tagAfterSave(save1.bytes, idHexA)).toBe(TAG_A); // sanity: first save kept A
		bundle = save1.next;

		// 2) Switch to instance B, edit it, and SAVE AGAIN.
		bundle = applyResourceWriteToBundle(bundle, PSL_KEY, idxB, withFirstPolyTag(pslList(bundle)[idxB]!, TAG_B));
		const save2 = performSave(bundle);

		// Both the newly-edited B and the earlier-saved A must be present.
		expect(tagAfterSave(save2.bytes, idHexB)).toBe(TAG_B);
		expect(tagAfterSave(save2.bytes, idHexA)).toBe(TAG_A);
	});

	// Guard the re-base's own contract: after a save the bundle is clean, its
	// edited models are intact, and the baseline bytes now carry the edit.
	it('re-base after save: clean flag, models preserved, baseline updated', () => {
		let bundle = loadWorldcol();
		const [idxA] = firstTwoPopulated(bundle);
		bundle = applyResourceWriteToBundle(bundle, PSL_KEY, idxA, withFirstPolyTag(pslList(bundle)[idxA]!, TAG_A));
		expect(bundle.isModified).toBe(true);

		const { bytes, next } = performSave(bundle);
		expect(next.isModified).toBe(false);
		expect(next.dirtyMulti.size).toBe(0);
		// Edited model is still in memory (not reverted or re-parsed away)...
		expect(pslList(next)[idxA]!.soups[0].polygons[0].collisionTag >>> 0).toBe(TAG_A);
		// ...and the new baseline bytes are exactly what we just wrote.
		expect(next.originalArrayBuffer.byteLength).toBe(bytes.byteLength);
	});
});

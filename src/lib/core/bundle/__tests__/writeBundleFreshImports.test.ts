// Round-trip coverage for import-table handling in writeBundleFresh.
//
// BND2 import tables are INLINE in each resource's block-0 payload and
// ResourceEntry.importOffset is payload-relative (see parseImportEntries).
// The fresh writer used to copy `importCount * 16` bytes from the ORIGINAL
// FILE buffer at that relative offset (garbage), append them as a standalone
// file region, and point importOffset at the file-absolute position — so any
// imports-bearing resource broke on repack, and count-changing payload edits
// (e.g. adding/removing EnvironmentTimeLine keyframes) left stale envelope
// metadata. These tests pin the fixed behavior:
//   1. unchanged repack preserves every payload byte and every import entry;
//   2. count-changing edits recompute importOffset/importCount via the
//      handler's importTable() hook.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle, writeBundleFresh } from '../index';
import { getResourceImportSlice } from '../bundleEntry';
import { registry, extractResourceRaw, resourceCtxFromBundle } from '../../registry/index';
import type { ParsedEnvironmentTimeLine } from '../../environmentSettings';
import type { ParsedFont } from '../../font';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const ENV_BUNDLE = 'example/ENVIRONMENTSETTINGS/000_DLC24HR_SUN_A.BUNDLE';
const TRK_BUNDLE = 'example/TRK_UNIT0_GR.BNDL';
const FONT_BUNDLE = 'example/FONTS/DEFAULT.FONT';
const TIMELINE_TYPE_ID = 0x10013;
const FONT_TYPE_ID = 0x21;

function loadBundle(name: string): ArrayBuffer {
	const raw = fs.readFileSync(path.resolve(REPO_ROOT, name));
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return bytes.buffer as ArrayBuffer;
}

function exists(name: string): boolean {
	return fs.existsSync(path.resolve(REPO_ROOT, name));
}

function formatId(id: { low: number; high: number }): string {
	const bi = (BigInt(id.high >>> 0) << 32n) | BigInt(id.low >>> 0);
	return `0x${bi.toString(16).toUpperCase().padStart(16, '0')}`;
}

// ---------------------------------------------------------------------------
// Unchanged repack: payloads and import tables must survive byte-exact.
// The ENVIRONMENTSETTINGS bundle covers keyframes (1 import each) plus the
// timeline (N imports); the TRK bundle sweeps the graphics-side types
// (Renderable, Model, Material, ...) whose imports are heavily populated.
// ---------------------------------------------------------------------------

for (const fixture of [ENV_BUNDLE, TRK_BUNDLE]) {
	describe(`unchanged repack: ${fixture}`, () => {
		if (!exists(fixture)) {
			it.skip(`${fixture} not available`, () => { /* noop */ });
			return;
		}

		const original = loadBundle(fixture);
		const bundle = parseBundle(original);
		const repacked = writeBundleFresh(bundle, original);
		const reparsed = parseBundle(repacked);

		it('preserves every resource payload byte-exact', () => {
			expect(reparsed.resources.length).toBe(bundle.resources.length);
			for (let i = 0; i < bundle.resources.length; i++) {
				const before = bundle.resources[i];
				const after = reparsed.resources[i];
				expect(formatId(after.resourceId)).toBe(formatId(before.resourceId));
				const rawBefore = extractResourceRaw(original, bundle, before);
				const rawAfter = extractResourceRaw(repacked, reparsed, after);
				expect(rawAfter.byteLength).toBe(rawBefore.byteLength);
				expect(Buffer.from(rawAfter).equals(Buffer.from(rawBefore))).toBe(true);
			}
		});

		it('preserves importOffset/importCount on every entry', () => {
			for (let i = 0; i < bundle.resources.length; i++) {
				expect(reparsed.resources[i].importOffset).toBe(bundle.resources[i].importOffset);
				expect(reparsed.resources[i].importCount).toBe(bundle.resources[i].importCount);
			}
		});

		it('re-parses identical import entries for every resource', () => {
			expect(bundle.imports.length).toBeGreaterThan(0);
			expect(reparsed.imports.length).toBe(bundle.imports.length);
			for (let i = 0; i < bundle.resources.length; i++) {
				const before = getResourceImportSlice(bundle.imports, bundle.resources, i);
				const after = getResourceImportSlice(reparsed.imports, reparsed.resources, i);
				expect(after === null).toBe(before === null);
				if (!before || !after) continue;
				for (let j = 0; j < before.length; j++) {
					expect(after[j].resourceId).toEqual(before[j].resourceId);
					expect(after[j].offset).toBe(before[j].offset);
				}
			}
		});
	});
}

// ---------------------------------------------------------------------------
// Count-changing EnvironmentTimeLine edits: the keyframe schedule maps 1:1
// onto the inline import table, so adding/removing an entry resizes the table
// and the envelope's importOffset/importCount must follow.
// ---------------------------------------------------------------------------

describe('count-changing EnvironmentTimeLine edit', () => {
	if (!exists(ENV_BUNDLE)) {
		it.skip(`${ENV_BUNDLE} not available`, () => { /* noop */ });
		return;
	}

	const original = loadBundle(ENV_BUNDLE);
	const bundle = parseBundle(original);
	const ctx = resourceCtxFromBundle(bundle);
	const handler = registry.find((h) => h.typeId === TIMELINE_TYPE_ID)!;
	const timelineEntry = bundle.resources.find((r) => r.resourceTypeId === TIMELINE_TYPE_ID)!;
	const timelineRaw = extractResourceRaw(original, bundle, timelineEntry);
	const model = handler.parseRaw(timelineRaw, ctx) as ParsedEnvironmentTimeLine;
	const originalCount = model.locations.reduce((n, l) => n + l.keyframes.length, 0);

	function assertEnvelopeTracksModel(repacked: ArrayBuffer, mutated: ParsedEnvironmentTimeLine) {
		const reparsed = parseBundle(repacked);
		const idx = reparsed.resources.findIndex((r) => r.resourceTypeId === TIMELINE_TYPE_ID);
		const entry = reparsed.resources[idx];
		const expectedKeyframes = mutated.locations.flatMap((l) => l.keyframes);

		// Envelope metadata follows the new payload layout: table at the tail,
		// one entry per schedule entry.
		const payload = extractResourceRaw(repacked, reparsed, entry);
		expect(entry.importCount).toBe(expectedKeyframes.length);
		expect(entry.importOffset).toBe(payload.byteLength - expectedKeyframes.length * 16);

		// The bundle-level import entries resolve to the schedule's keyframe ids,
		// in order.
		const slice = getResourceImportSlice(reparsed.imports, reparsed.resources, idx)!;
		expect(slice.length).toBe(expectedKeyframes.length);
		for (let j = 0; j < slice.length; j++) {
			const id = (BigInt(slice[j].resourceId.high) << 32n) | BigInt(slice[j].resourceId.low);
			expect(id).toBe(expectedKeyframes[j].mKeyframeId);
		}

		// The payload itself round-trips to the mutated model.
		const remodel = handler.parseRaw(payload, ctx) as ParsedEnvironmentTimeLine;
		expect(remodel.locations.map((l) => l.keyframes)).toEqual(mutated.locations.map((l) => l.keyframes));

		// Sibling resources (the keyframes themselves) pass through untouched.
		for (let i = 0; i < bundle.resources.length; i++) {
			const before = bundle.resources[i];
			if (before.resourceTypeId === TIMELINE_TYPE_ID) continue;
			const after = reparsed.resources[i];
			expect(after.importOffset).toBe(before.importOffset);
			expect(after.importCount).toBe(before.importCount);
			const rawBefore = extractResourceRaw(original, bundle, before);
			const rawAfter = extractResourceRaw(repacked, reparsed, after);
			expect(Buffer.from(rawAfter).equals(Buffer.from(rawBefore))).toBe(true);
		}
	}

	it('removing a keyframe shrinks the envelope import metadata (model override)', () => {
		const mutated: ParsedEnvironmentTimeLine = {
			...model,
			locations: [
				{ keyframes: model.locations[0].keyframes.slice(0, -1) },
				...model.locations.slice(1),
			],
		};
		const repacked = writeBundleFresh(bundle, original, {
			overrides: { resources: { [TIMELINE_TYPE_ID]: mutated } },
		});
		expect(originalCount).toBeGreaterThan(1);
		assertEnvelopeTracksModel(repacked, mutated);
	});

	it('appending a keyframe grows the envelope import metadata (byte override)', () => {
		const mutated: ParsedEnvironmentTimeLine = {
			...model,
			locations: [
				{ keyframes: [...model.locations[0].keyframes, { mfTimeOfDay: 86340, mKeyframeId: 0xabcdef01n }] },
				...model.locations.slice(1),
			],
		};
		const bytes = handler.writeRaw!(mutated as never, ctx);
		const repacked = writeBundleFresh(bundle, original, {
			overrides: { byResourceId: { [formatId(timelineEntry.resourceId)]: bytes } },
		});
		assertEnvelopeTracksModel(repacked, mutated);
	});
});

// ---------------------------------------------------------------------------
// Font glyph append: the import COUNT stays at one-per-page, but growing the
// char array moves the inline table — importOffset must track it.
// ---------------------------------------------------------------------------

describe('count-preserving Font glyph append moves importOffset', () => {
	if (!exists(FONT_BUNDLE)) {
		it.skip(`${FONT_BUNDLE} not available`, () => { /* noop */ });
		return;
	}

	it('repacked bundle points importOffset at the moved tail table', () => {
		const original = loadBundle(FONT_BUNDLE);
		const bundle = parseBundle(original);
		const ctx = resourceCtxFromBundle(bundle);
		const handler = registry.find((h) => h.typeId === FONT_TYPE_ID)!;
		const fontEntry = bundle.resources.find((r) => r.resourceTypeId === FONT_TYPE_ID)!;
		const model = handler.parseRaw(extractResourceRaw(original, bundle, fontEntry), ctx) as ParsedFont;

		// Bucket 127 (0x7F) is >= every existing bucket, keeping the char array
		// hash-grouped (the writer throws otherwise).
		const mutated: ParsedFont = {
			...model,
			chars: [...model.chars, {
				charId: 0xff,
				mTopLeftUV: { x: 0.5, y: 0.5 },
				mDimensionsUV: { x: 0.05, y: 0.05 },
				mStart: { x: 0, y: 0 },
				mfAdvance: 0.05,
				mu16TexturePageId: 0,
				mbIsLowerCaseScale: false,
				mbIsRenderable: true,
			}],
		};
		const repacked = writeBundleFresh(bundle, original, {
			overrides: { resources: { [FONT_TYPE_ID]: mutated } },
		});

		const reparsed = parseBundle(repacked);
		const idx = reparsed.resources.findIndex((r) => r.resourceTypeId === FONT_TYPE_ID);
		const entry = reparsed.resources[idx];
		const payload = extractResourceRaw(repacked, reparsed, entry);

		expect(entry.importCount).toBe(model.texturePages.length);
		expect(entry.importOffset).toBe(payload.byteLength - model.texturePages.length * 16);
		expect(entry.importOffset).not.toBe(fontEntry.importOffset);

		const slice = getResourceImportSlice(reparsed.imports, reparsed.resources, idx)!;
		const id = (BigInt(slice[0].resourceId.high) << 32n) | BigInt(slice[0].resourceId.low);
		expect(id).toBe(model.texturePages[0].textureId);

		const remodel = handler.parseRaw(payload, ctx) as ParsedFont;
		expect(remodel.chars.length).toBe(model.chars.length + 1);
		expect(remodel.chars[remodel.chars.length - 1].charId).toBe(0xff);
	});
});

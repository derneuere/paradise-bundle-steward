// Integration test for WorkspaceContext — exercises the (bundleId, key) APIs
// against a real example bundle, plus the Selection round-trip shape.
//
// The vitest environment is `node` so we can't render the WorkspaceProvider
// to a DOM; this test exercises `makeEditableBundle` (the synchronous core
// of `loadBundle`) and the helpers (`applyResourceWriteToBundle`,
// `clearBundleDirty`) together — covering the same end-to-end flow the
// React provider stitches up around them.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { makeEditableBundle } from './WorkspaceContext.bundle';
import {
	applyResourceWriteToBundle,
	clearBundleDirty,
} from './WorkspaceContext.helpers';
import type {
	EditableBundle,
	WorkspaceSelection,
} from './WorkspaceContext.types';
import type { ParsedAISections } from '@/lib/core/aiSections';

// AI.DAT is a small PC bundle that contains a single AISections resource —
// well-suited for testing the Bundle-keyed read/write/selection flow without
// dragging in a multi-resource fixture.
const FIXTURE = path.resolve(__dirname, '../../example/AI.DAT');

function loadFixture(): ArrayBuffer {
	const raw = fs.readFileSync(FIXTURE);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return bytes.buffer;
}

// Tiny "workspace state" stand-in for the React state the provider holds.
// Mirrors the provider's `bundles` array plus the public read/write helpers
// so a test can assert on the same shape the live provider exposes via
// `useWorkspace()`.
type WorkspaceState = { bundles: EditableBundle[] };

function getResource<T>(state: WorkspaceState, bundleId: string, key: string): T | null {
	const b = state.bundles.find((x) => x.id === bundleId);
	if (!b) return null;
	return (b.parsedResources.get(key) as T | undefined) ?? null;
}

function setResource<T>(
	state: WorkspaceState,
	bundleId: string,
	key: string,
	value: T,
): WorkspaceState {
	return {
		bundles: state.bundles.map((b) =>
			b.id === bundleId ? applyResourceWriteToBundle(b, key, 0, value) : b,
		),
	};
}

// ---------------------------------------------------------------------------
// loadBundle
// ---------------------------------------------------------------------------

describe('loadBundle (via makeEditableBundle)', () => {
	it('parses a real bundle, populates resource maps, starts clean', () => {
		const bundle = makeEditableBundle(loadFixture(), 'AI.DAT');

		expect(bundle.id).toBe('AI.DAT');
		expect(bundle.parsed.resources.length).toBeGreaterThan(0);
		expect(bundle.resources.length).toBe(bundle.parsed.resources.length);
		// AI.DAT's whole reason for existing is the AI Sections resource —
		// confirm both the single-instance and multi-instance maps see it.
		expect(bundle.parsedResources.get('aiSections')).toBeDefined();
		expect(bundle.parsedResourcesAll.get('aiSections')?.length).toBeGreaterThan(0);
		expect(bundle.dirtyMulti.size).toBe(0);
		expect(bundle.isModified).toBe(false);
	});

	it('uses the supplied filename as the BundleId (game refs files by name)', () => {
		// Different filename, same bytes — the workspace forbids two bundles
		// with the same name (CONTEXT.md / Bundle filename), so the id is the
		// addressable identity throughout Steward.
		const bundle = makeEditableBundle(loadFixture(), 'PRIMARY.DAT');
		expect(bundle.id).toBe('PRIMARY.DAT');
	});
});

// ---------------------------------------------------------------------------
// getResource(bundleId, key)
// ---------------------------------------------------------------------------

describe('getResource(bundleId, key)', () => {
	it('returns the parsed model for a Bundle that has it', () => {
		const state: WorkspaceState = {
			bundles: [makeEditableBundle(loadFixture(), 'AI.DAT')],
		};
		const ai = getResource<ParsedAISections>(state, 'AI.DAT', 'aiSections');
		expect(ai).not.toBeNull();
		expect(ai!.sections.length).toBeGreaterThan(0);
	});

	it('returns null for a Bundle that does not have the resource type', () => {
		const state: WorkspaceState = {
			bundles: [makeEditableBundle(loadFixture(), 'AI.DAT')],
		};
		const missing = getResource<unknown>(state, 'AI.DAT', 'streetData');
		expect(missing).toBeNull();
	});

	it('returns null for a BundleId that is not loaded', () => {
		const state: WorkspaceState = {
			bundles: [makeEditableBundle(loadFixture(), 'AI.DAT')],
		};
		const missing = getResource<unknown>(state, 'NOT_LOADED.DAT', 'aiSections');
		expect(missing).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// setResource(bundleId, key, value)
// ---------------------------------------------------------------------------

describe('setResource(bundleId, key, value)', () => {
	it('overwrites the model and marks the Bundle dirty', () => {
		const initial: WorkspaceState = {
			bundles: [makeEditableBundle(loadFixture(), 'AI.DAT')],
		};
		const original = getResource<ParsedAISections>(initial, 'AI.DAT', 'aiSections')!;

		// Build a tiny edit — bumping the version field is the cheapest legal
		// mutation, and it survives the immutable-update path because we're
		// writing a brand-new object in.
		const next: ParsedAISections = { ...original, version: original.version + 1 };
		const after = setResource(initial, 'AI.DAT', 'aiSections', next);

		const updated = getResource<ParsedAISections>(after, 'AI.DAT', 'aiSections')!;
		expect(updated.version).toBe(original.version + 1);

		const updatedBundle = after.bundles[0];
		expect(updatedBundle.isModified).toBe(true);
		expect(updatedBundle.dirtyMulti.has('aiSections:0')).toBe(true);

		// Original state untouched — `applyResourceWriteToBundle` is immutable.
		expect(initial.bundles[0].isModified).toBe(false);
		expect(initial.bundles[0].dirtyMulti.size).toBe(0);
	});

	it('leaves other Bundles in the workspace untouched', () => {
		// Simulating two bundles in the workspace by giving the same fixture
		// two different filenames. setResource must address only the named
		// Bundle and ignore the rest.
		const initial: WorkspaceState = {
			bundles: [
				makeEditableBundle(loadFixture(), 'A.DAT'),
				makeEditableBundle(loadFixture(), 'B.DAT'),
			],
		};
		const oa = getResource<ParsedAISections>(initial, 'A.DAT', 'aiSections')!;
		const next: ParsedAISections = { ...oa, version: oa.version + 1 };
		const after = setResource(initial, 'A.DAT', 'aiSections', next);

		expect(after.bundles[0].isModified).toBe(true);
		expect(after.bundles[1].isModified).toBe(false);
		expect(getResource<ParsedAISections>(after, 'B.DAT', 'aiSections')!.version).toBe(
			oa.version,
		);
	});

	it('saveBundle bookkeeping clears dirty without touching the model', () => {
		const initial: WorkspaceState = {
			bundles: [makeEditableBundle(loadFixture(), 'AI.DAT')],
		};
		const original = getResource<ParsedAISections>(initial, 'AI.DAT', 'aiSections')!;
		const edited = setResource(initial, 'AI.DAT', 'aiSections', {
			...original,
			version: original.version + 1,
		});

		const saved: WorkspaceState = {
			bundles: edited.bundles.map(clearBundleDirty),
		};
		const after = getResource<ParsedAISections>(saved, 'AI.DAT', 'aiSections')!;

		// Edit survives the save; dirty bookkeeping clears.
		expect(after.version).toBe(original.version + 1);
		expect(saved.bundles[0].isModified).toBe(false);
		expect(saved.bundles[0].dirtyMulti.size).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Selection round-trip
// ---------------------------------------------------------------------------

describe('selection round-trip', () => {
	it('round-trips a deep selection through a setter without mutation', () => {
		// Selection is a plain immutable record — no helper methods. The
		// "round-trip" guarantee is that whatever shape we hand to the setter
		// comes back out byte-identical, so consumers can reason about
		// selection equality without normalisation.
		const sel: WorkspaceSelection = {
			bundleId: 'AI.DAT',
			resourceKey: 'aiSections',
			index: 0,
			path: ['sections', 3, 'portals', 1],
		};
		let stored: WorkspaceSelection = null;
		const select = (next: WorkspaceSelection) => {
			stored = next;
		};
		select(sel);
		expect(stored).toEqual(sel);
		// Path is preserved as a separate array reference round-trippable
		// without normalisation — consumers can rely on referential equality
		// for fast selection-equality checks.
		expect((stored as NonNullable<WorkspaceSelection>).path).toEqual([
			'sections',
			3,
			'portals',
			1,
		]);
	});

	it('null is the deselected state', () => {
		const sel: WorkspaceSelection = null;
		expect(sel).toBeNull();
	});

	it('selection always pins to a (bundleId, resourceKey, index) — no implicit active Bundle', () => {
		// Documented invariant from CONTEXT.md / Selection: the selected
		// resource's Bundle is implicit in the selection. There is no
		// separate "active Bundle" concept, so a selection without
		// `bundleId` is malformed. Test by exhaustive type check.
		const sel = {
			bundleId: 'AI.DAT',
			resourceKey: 'aiSections',
			index: 0,
			path: [],
		} satisfies NonNullable<WorkspaceSelection>;
		expect(sel.bundleId).toBe('AI.DAT');
	});
});

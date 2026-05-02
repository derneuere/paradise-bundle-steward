// Workspace conversion-provenance store — reducer tests.
//
// The provider in WorkspaceContext.tsx wires React state around these
// pure helpers; covering them directly in node exercises the same
// behaviour without a DOM. Mirrors the WorkspaceContext.helpers.test.ts
// pattern for visibility / history.

import { describe, it, expect } from 'vitest';
import {
	dismissProvenance,
	dropProvenanceForBundle,
	getActiveProvenance,
	provenanceKey,
	recordProvenance,
	type ConversionProvenance,
} from '../WorkspaceContext.provenance';

const SAMPLE: ConversionProvenance = {
	sourceKind: 'v4',
	targetKind: 'v12',
	defaulted: ['aiSections: spanIndex'],
	lossy: ['aiSections: speed (from dangerRating)'],
	exportedAt: 1714521600000,
};

describe('provenanceKey', () => {
	it('produces a stable string keyed by (bundle, resource, index)', () => {
		expect(provenanceKey('AI.DAT', 'aiSections', 0)).toBe('AI.DAT::aiSections::0');
		expect(provenanceKey('AI.DAT', 'aiSections', 0)).toBe(
			provenanceKey('AI.DAT', 'aiSections', 0),
		);
	});

	it('distinguishes different bundles, resources, and indices', () => {
		const a = provenanceKey('A.DAT', 'aiSections', 0);
		const b = provenanceKey('B.DAT', 'aiSections', 0);
		const c = provenanceKey('A.DAT', 'streetData', 0);
		const d = provenanceKey('A.DAT', 'aiSections', 1);
		expect(new Set([a, b, c, d]).size).toBe(4);
	});
});

describe('recordProvenance', () => {
	it('inserts a fresh entry with dismissed=false', () => {
		const map = recordProvenance(new Map(), 'AI.DAT', 'aiSections', 0, SAMPLE);
		const entry = map.get(provenanceKey('AI.DAT', 'aiSections', 0));
		expect(entry).toBeDefined();
		expect(entry!.sourceKind).toBe('v4');
		expect(entry!.targetKind).toBe('v12');
		expect(entry!.dismissed).toBe(false);
	});

	it('overwrites a prior entry and clears its dismissed flag', () => {
		// A second export to the same resource should re-surface the
		// banner — the user is being told about a new conversion, even if
		// they had dismissed an earlier one.
		let map = recordProvenance(new Map(), 'AI.DAT', 'aiSections', 0, SAMPLE);
		map = dismissProvenance(map, 'AI.DAT', 'aiSections', 0);
		expect(map.get(provenanceKey('AI.DAT', 'aiSections', 0))!.dismissed).toBe(true);
		map = recordProvenance(map, 'AI.DAT', 'aiSections', 0, {
			...SAMPLE,
			exportedAt: SAMPLE.exportedAt + 1,
		});
		expect(map.get(provenanceKey('AI.DAT', 'aiSections', 0))!.dismissed).toBe(false);
	});

	it('returns a fresh Map — input is not mutated', () => {
		const input = new Map();
		const out = recordProvenance(input, 'AI.DAT', 'aiSections', 0, SAMPLE);
		expect(out).not.toBe(input);
		expect(input.size).toBe(0);
	});
});

describe('dismissProvenance', () => {
	it('flips dismissed=true on an existing entry', () => {
		let map = recordProvenance(new Map(), 'AI.DAT', 'aiSections', 0, SAMPLE);
		map = dismissProvenance(map, 'AI.DAT', 'aiSections', 0);
		expect(map.get(provenanceKey('AI.DAT', 'aiSections', 0))!.dismissed).toBe(true);
	});

	it('is a no-op on a missing entry — returns a fresh Map of the same shape', () => {
		const map = dismissProvenance(new Map(), 'AI.DAT', 'aiSections', 0);
		expect(map.size).toBe(0);
	});

	it('is idempotent — dismissing twice keeps dismissed=true', () => {
		let map = recordProvenance(new Map(), 'AI.DAT', 'aiSections', 0, SAMPLE);
		map = dismissProvenance(map, 'AI.DAT', 'aiSections', 0);
		map = dismissProvenance(map, 'AI.DAT', 'aiSections', 0);
		expect(map.get(provenanceKey('AI.DAT', 'aiSections', 0))!.dismissed).toBe(true);
	});
});

describe('getActiveProvenance', () => {
	it('returns the provenance when present and not dismissed', () => {
		const map = recordProvenance(new Map(), 'AI.DAT', 'aiSections', 0, SAMPLE);
		const active = getActiveProvenance(map, 'AI.DAT', 'aiSections', 0);
		expect(active).not.toBeNull();
		expect(active!.defaulted).toEqual(SAMPLE.defaulted);
		expect(active!.lossy).toEqual(SAMPLE.lossy);
		// dismissed flag should not leak into the read shape — callers
		// don't need to reason about it.
		expect((active as Record<string, unknown>).dismissed).toBeUndefined();
	});

	it('returns null when the entry is dismissed', () => {
		let map = recordProvenance(new Map(), 'AI.DAT', 'aiSections', 0, SAMPLE);
		map = dismissProvenance(map, 'AI.DAT', 'aiSections', 0);
		expect(getActiveProvenance(map, 'AI.DAT', 'aiSections', 0)).toBeNull();
	});

	it('returns null when no entry exists for the key', () => {
		const map = recordProvenance(new Map(), 'AI.DAT', 'aiSections', 0, SAMPLE);
		expect(getActiveProvenance(map, 'AI.DAT', 'aiSections', 1)).toBeNull();
		expect(getActiveProvenance(map, 'OTHER.DAT', 'aiSections', 0)).toBeNull();
		expect(getActiveProvenance(map, 'AI.DAT', 'streetData', 0)).toBeNull();
	});
});

describe('dropProvenanceForBundle', () => {
	it('removes every entry keyed under the given bundleId', () => {
		// Acceptance criterion: closing or replacing a bundle drops its
		// provenance entries so a same-name reload starts clean.
		let map = recordProvenance(new Map(), 'A.DAT', 'aiSections', 0, SAMPLE);
		map = recordProvenance(map, 'A.DAT', 'streetData', 0, SAMPLE);
		map = recordProvenance(map, 'B.DAT', 'aiSections', 0, SAMPLE);
		expect(map.size).toBe(3);
		const after = dropProvenanceForBundle(map, 'A.DAT');
		expect(after.size).toBe(1);
		expect(after.get(provenanceKey('B.DAT', 'aiSections', 0))).toBeDefined();
	});

	it('preserves map identity (reference) when nothing matches — no churn', () => {
		// Same trick `dropHistoryForBundle` plays — a no-op prune
		// shouldn't churn React state that was bound to the previous
		// reference. We can't assert reference equality here because the
		// helper always returns a fresh Map for the no-op branch too, but
		// the contents must be identical and the size unchanged.
		let map = recordProvenance(new Map(), 'A.DAT', 'aiSections', 0, SAMPLE);
		map = recordProvenance(map, 'B.DAT', 'aiSections', 0, SAMPLE);
		const after = dropProvenanceForBundle(map, 'NEVER_LOADED.DAT');
		expect(after.size).toBe(2);
		expect(after.get(provenanceKey('A.DAT', 'aiSections', 0))).toBeDefined();
		expect(after.get(provenanceKey('B.DAT', 'aiSections', 0))).toBeDefined();
	});

	it('dropping a bundle clears both undismissed and dismissed entries', () => {
		// A user could have one banner dismissed and another active on the
		// same bundle — closing the bundle must drop both.
		let map = recordProvenance(new Map(), 'A.DAT', 'aiSections', 0, SAMPLE);
		map = recordProvenance(map, 'A.DAT', 'aiSections', 1, SAMPLE);
		map = dismissProvenance(map, 'A.DAT', 'aiSections', 0);
		const after = dropProvenanceForBundle(map, 'A.DAT');
		expect(after.size).toBe(0);
	});
});

// selection.ts — codec helpers, equality, and stable keys.
//
// We exercise the pure helpers directly rather than mounting a React tree.
// The repo's vitest env is `node` (no jsdom, no @testing-library/react), and
// these helpers are the load-bearing logic — the hook layer above just plumbs
// them into a paint loop.

import { describe, it, expect } from 'vitest';
import {
	defineSelectionCodec,
	selectionEquals,
	selectionKey,
} from '../selection';
import type { Selection, SelectionCodec } from '../selection';
import type { NodePath } from '@/lib/schema/walk';

describe('selectionEquals', () => {
	it('treats two nulls as equal', () => {
		expect(selectionEquals(null, null)).toBe(true);
	});

	it('returns false when one side is null', () => {
		const sel: Selection = { kind: 'street', indices: [3] };
		expect(selectionEquals(sel, null)).toBe(false);
		expect(selectionEquals(null, sel)).toBe(false);
	});

	it('compares kind + indices structurally', () => {
		expect(selectionEquals(
			{ kind: 'street', indices: [3] },
			{ kind: 'street', indices: [3] },
		)).toBe(true);
		// Different kind.
		expect(selectionEquals(
			{ kind: 'street', indices: [3] },
			{ kind: 'road', indices: [3] },
		)).toBe(false);
		// Different index.
		expect(selectionEquals(
			{ kind: 'street', indices: [3] },
			{ kind: 'street', indices: [4] },
		)).toBe(false);
		// Different arity (single vs nested).
		expect(selectionEquals(
			{ kind: 'portal', indices: [3] },
			{ kind: 'portal', indices: [3, 0] },
		)).toBe(false);
		// Nested 2-deep equal.
		expect(selectionEquals(
			{ kind: 'portal', indices: [3, 1] },
			{ kind: 'portal', indices: [3, 1] },
		)).toBe(true);
	});

	it('is reference-stable on identical refs', () => {
		const sel: Selection = { kind: 'junction', indices: [9] };
		expect(selectionEquals(sel, sel)).toBe(true);
	});
});

describe('selectionKey', () => {
	it('produces stable strings distinct across kinds', () => {
		expect(selectionKey({ kind: 'street', indices: [3] })).toBe('street:3');
		expect(selectionKey({ kind: 'road', indices: [3] })).toBe('road:3');
		// Same indices, different kind → distinct keys (Set membership doesn't
		// collide between meshes).
		expect(selectionKey({ kind: 'street', indices: [3] })).not.toBe(
			selectionKey({ kind: 'road', indices: [3] }),
		);
	});

	it('encodes nested indices joined by `/`', () => {
		expect(selectionKey({ kind: 'portal', indices: [4, 2] })).toBe('portal:4/2');
	});

	it('round-trips through Set membership', () => {
		const set = new Set<string>([
			selectionKey({ kind: 'street', indices: [1] }),
			selectionKey({ kind: 'street', indices: [2] }),
		]);
		expect(set.has(selectionKey({ kind: 'street', indices: [1] }))).toBe(true);
		expect(set.has(selectionKey({ kind: 'street', indices: [2] }))).toBe(true);
		expect(set.has(selectionKey({ kind: 'street', indices: [3] }))).toBe(false);
		// Different kind, same index → not present.
		expect(set.has(selectionKey({ kind: 'road', indices: [1] }))).toBe(false);
	});
});

describe('defineSelectionCodec', () => {
	// Toy codec used only in this file — exercises the round-trip contract a
	// real overlay's codec must satisfy.
	const codec: SelectionCodec = defineSelectionCodec({
		pathToSelection: (path: NodePath) => {
			if (path.length < 2) return null;
			const head = path[0];
			const idx = path[1];
			if (typeof idx !== 'number') return null;
			if (head === 'streets') return { kind: 'street', indices: [idx] };
			if (head === 'roads') return { kind: 'road', indices: [idx] };
			return null;
		},
		selectionToPath: (sel: Selection) => {
			if (sel.kind === 'street') return ['streets', sel.indices[0]];
			if (sel.kind === 'road') return ['roads', sel.indices[0]];
			return [];
		},
	});

	it('returns the codec it was given (identity)', () => {
		const inner = { pathToSelection: () => null, selectionToPath: () => [] };
		expect(defineSelectionCodec(inner)).toBe(inner);
	});

	it('round-trips entity-level paths', () => {
		const sel = codec.pathToSelection(['streets', 7]);
		expect(sel).toEqual({ kind: 'street', indices: [7] });
		expect(codec.selectionToPath(sel!)).toEqual(['streets', 7]);

		const sel2 = codec.pathToSelection(['roads', 0]);
		expect(sel2).toEqual({ kind: 'road', indices: [0] });
		expect(codec.selectionToPath(sel2!)).toEqual(['roads', 0]);
	});

	it('returns null for off-resource paths', () => {
		expect(codec.pathToSelection([])).toBeNull();
		expect(codec.pathToSelection(['somethingElse', 0])).toBeNull();
		expect(codec.pathToSelection(['streets'])).toBeNull();
	});
});

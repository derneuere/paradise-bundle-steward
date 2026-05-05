// Coverage for findUnresolvedPortals (Slice 2).

import { describe, it, expect } from 'vitest';
import {
	SectionSpeed,
	type ParsedAISectionsV12,
	type AISection,
	type Portal,
} from '../aiSections';
import { findUnresolvedPortals } from '../aiSectionsValidate';

function portal(linkSection: number): Portal {
	return {
		position: { x: 0, y: 0, z: 0 },
		boundaryLines: [],
		linkSection,
	};
}

function section(portals: Portal[]): AISection {
	return {
		portals,
		noGoLines: [],
		corners: [
			{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
		],
		id: 0,
		spanIndex: -1,
		speed: SectionSpeed.E_SECTION_SPEED_NORMAL,
		district: 0,
		flags: 0,
	};
}

function model(sections: AISection[]): ParsedAISectionsV12 {
	return {
		kind: 'v12',
		version: 12,
		sectionMinSpeeds: [0, 0, 0, 0, 0],
		sectionMaxSpeeds: [0, 0, 0, 0, 0],
		sections,
		sectionResetPairs: [],
	};
}

describe('findUnresolvedPortals', () => {
	it('returns empty for an empty model', () => {
		expect(findUnresolvedPortals(model([]))).toEqual([]);
	});

	it('returns empty when every portal links to a real section', () => {
		// Two sections, each with one portal pointing at the other.
		const m = model([section([portal(1)]), section([portal(0)])]);
		expect(findUnresolvedPortals(m)).toEqual([]);
	});

	it('flags negative linkSection (-1 stale sentinel)', () => {
		const m = model([section([portal(-1)])]);
		expect(findUnresolvedPortals(m)).toEqual([
			{ sectionIdx: 0, portalIdx: 0, linkSection: -1 },
		]);
	});

	it('flags out-of-range linkSection (the bulk-import 0xFFFF sentinel)', () => {
		const m = model([section([portal(0xffff)])]);
		expect(findUnresolvedPortals(m)).toEqual([
			{ sectionIdx: 0, portalIdx: 0, linkSection: 0xffff },
		]);
	});

	it('flags linkSection equal to numSections (one past the end)', () => {
		const m = model([section([portal(1)]), section([portal(2)])]);
		expect(findUnresolvedPortals(m)).toEqual([
			{ sectionIdx: 1, portalIdx: 0, linkSection: 2 },
		]);
	});

	it('flags NaN linkSection', () => {
		const m = model([section([portal(Number.NaN)])]);
		expect(findUnresolvedPortals(m)).toEqual([
			{ sectionIdx: 0, portalIdx: 0, linkSection: Number.NaN },
		]);
	});

	it('flags non-integer linkSection', () => {
		const m = model([section([portal(0.5)])]);
		const out = findUnresolvedPortals(m);
		expect(out).toHaveLength(1);
		expect(out[0].linkSection).toBe(0.5);
	});

	it('handles a mixed model with valid + invalid portals', () => {
		const m = model([
			section([portal(1), portal(0xffff)]),
			section([portal(0), portal(99)]),
			section([]),
		]);
		expect(findUnresolvedPortals(m)).toEqual([
			{ sectionIdx: 0, portalIdx: 1, linkSection: 0xffff },
			{ sectionIdx: 1, portalIdx: 1, linkSection: 99 },
		]);
	});

	it('returns sectionIdx + portalIdx in walk order', () => {
		const m = model([
			section([portal(99), portal(98)]), // both unresolved
			section([portal(97)]),
		]);
		const out = findUnresolvedPortals(m);
		expect(out.map((u) => [u.sectionIdx, u.portalIdx])).toEqual([
			[0, 0],
			[0, 1],
			[1, 0],
		]);
	});

	it('handles all-broken model', () => {
		const m = model([
			section([portal(99)]),
			section([portal(99)]),
			section([portal(99)]),
		]);
		expect(findUnresolvedPortals(m)).toHaveLength(3);
	});

	it('does not flag a portal-less section', () => {
		const m = model([section([])]);
		expect(findUnresolvedPortals(m)).toEqual([]);
	});
});

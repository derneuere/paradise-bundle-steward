// Tests for the AI Section Y resolver (issue #27).
//
// Pure unit tests against hand-built `ParsedAISectionsV12` and
// `LegacyAISectionsData` models — no fixtures, no IO, no React. The
// algorithm has two branches per format (seed via portal Y, propagate via
// linkSection BFS); each test pins one edge case.

import { describe, it, expect } from 'vitest';
import {
	meanLegacyPortalY,
	meanPortalY,
	resolveLegacySectionYs,
	resolveSectionYs,
} from './aiSectionY';
import {
	AI_SECTIONS_VERSION,
	SectionSpeed,
	type AISection,
	type LegacyAISection,
	type LegacyAISectionsData,
	type LegacyPortal,
	type ParsedAISectionsV12,
	type Portal,
	type Vector2,
} from './aiSections';

// ---------------------------------------------------------------------------
// Builders — minimal V12 / legacy section + model factories
// ---------------------------------------------------------------------------

const SQUARE_CORNERS: Vector2[] = [
	{ x: 0, y: 0 },
	{ x: 10, y: 0 },
	{ x: 10, y: 10 },
	{ x: 0, y: 10 },
];

function makeSection(opts: {
	portals?: Portal[];
	corners?: Vector2[];
} = {}): AISection {
	return {
		portals: opts.portals ?? [],
		noGoLines: [],
		corners: opts.corners ?? SQUARE_CORNERS,
		id: 0xAA,
		spanIndex: -1,
		speed: SectionSpeed.E_SECTION_SPEED_NORMAL,
		district: 0,
		flags: 0,
	};
}

function makeModel(sections: AISection[]): ParsedAISectionsV12 {
	return {
		kind: 'v12',
		version: AI_SECTIONS_VERSION,
		sectionMinSpeeds: [0, 0, 0, 0, 0],
		sectionMaxSpeeds: [0, 0, 0, 0, 0],
		sections,
		sectionResetPairs: [],
	};
}

function makePortal(linkSection: number, y: number): Portal {
	return {
		position: { x: 0, y, z: 0 },
		boundaryLines: [],
		linkSection,
	};
}

function makeLegacySection(opts: {
	portals?: LegacyPortal[];
} = {}): LegacyAISection {
	return {
		portals: opts.portals ?? [],
		noGoLines: [],
		cornersX: [0, 10, 10, 0],
		cornersZ: [0, 0, 10, 10],
		dangerRating: 0,
		flags: 0,
	};
}

function makeLegacyPortal(linkSection: number, y: number): LegacyPortal {
	return {
		midPosition: { x: 0, y, z: 0, w: 0 },
		boundaryLines: [],
		linkSection,
	};
}

function makeLegacyModel(sections: LegacyAISection[]): LegacyAISectionsData {
	return {
		version: 4,
		sections,
	};
}

// ---------------------------------------------------------------------------
// meanPortalY
// ---------------------------------------------------------------------------

describe('meanPortalY', () => {
	it('returns null for sections with no portals', () => {
		expect(meanPortalY(makeSection())).toBeNull();
	});

	it('returns the single portal Y for a one-portal section', () => {
		const sec = makeSection({ portals: [makePortal(1, 17.5)] });
		expect(meanPortalY(sec)).toBe(17.5);
	});

	it('averages portal Y values when a section has multiple portals', () => {
		// Junction sections often have several portals at different heights —
		// the resolver should land at the mean rather than picking one
		// arbitrary portal.
		const sec = makeSection({
			portals: [
				makePortal(1, 10),
				makePortal(2, 20),
				makePortal(3, 30),
			],
		});
		expect(meanPortalY(sec)).toBe(20);
	});
});

// ---------------------------------------------------------------------------
// resolveSectionYs — V12
// ---------------------------------------------------------------------------

describe('resolveSectionYs', () => {
	it('seeds every section that has at least one portal', () => {
		const model = makeModel([
			makeSection({ portals: [makePortal(1, 5)] }),
			makeSection({ portals: [makePortal(0, 12)] }),
		]);
		const ys = resolveSectionYs(model);
		expect(Array.from(ys)).toEqual([5, 12]);
	});

	it('propagates Y to portal-less sections via the section graph', () => {
		// Section 0 has a portal pointing to itself with Y=42; section 1 has
		// no portals but is the link target of section 0 (model[0] -> 1) and
		// also points back at 0 → section 1 should resolve to 42 in pass 2.
		// Build via two-way links so the BFS sees section 1 through section 0.
		const model = makeModel([
			makeSection({ portals: [makePortal(1, 42)] }),
			makeSection({ portals: [] }),
		]);
		// Force a back-link by hand so the BFS walks 0 -> 1.
		// (The "frontier" walks forward from seeded sections by inspecting
		// THEIR portals; an unseeded neighbour is reached when an already-
		// resolved section's portal points at it.)
		const ys = resolveSectionYs(model);
		expect(ys[0]).toBe(42);
		expect(ys[1]).toBe(42);
	});

	it('averages neighbour Y values when an unseeded section has multiple resolved neighbours', () => {
		// Section 1 has no portals; sections 0 and 2 both point at it with
		// portal Ys of 10 and 30. After one BFS pass, section 1 should
		// resolve to (10 + 30) / 2 = 20 — that's the "interpolated" reading
		// the resolver promises for sections wedged between known heights.
		const model = makeModel([
			makeSection({ portals: [makePortal(1, 10)] }),
			makeSection({
				portals: [makePortal(0, 0), makePortal(2, 0)],
				// Section 1 has portals, so they SEED it instead of forcing
				// us into the BFS. Re-do with section 1 truly empty.
			}),
			makeSection({ portals: [makePortal(1, 30)] }),
		]);
		// Replace section 1 with a portal-less variant; the resolver still
		// reaches it via 0->1 and 2->1 link edges from the seeded sections.
		model.sections[1] = makeSection({ portals: [] });
		const ys = resolveSectionYs(model);
		expect(ys[0]).toBe(10);
		expect(ys[2]).toBe(30);
		expect(ys[1]).toBe(20);
	});

	it('falls back to 0 (default) for unreachable portal-less sections', () => {
		// Two disconnected components: section 0 (portal-less, isolated) and
		// section 1 (has a portal pointing to itself). Section 0 has no way
		// to reach a seeded neighbour, so the fallback applies.
		const model = makeModel([
			makeSection({ portals: [] }),
			makeSection({ portals: [makePortal(1, 99)] }),
		]);
		const ys = resolveSectionYs(model);
		expect(ys[0]).toBe(0);
		expect(ys[1]).toBe(99);
	});

	it('honours a custom fallback for unreachable sections', () => {
		const model = makeModel([
			makeSection({ portals: [] }),
			makeSection({ portals: [makePortal(1, 99)] }),
		]);
		const ys = resolveSectionYs(model, -50);
		expect(ys[0]).toBe(-50);
		expect(ys[1]).toBe(99);
	});

	it('returns an empty Float32Array for an empty model', () => {
		const ys = resolveSectionYs(makeModel([]));
		expect(ys.length).toBe(0);
	});

	it('ignores portal linkSection indices that are out of range', () => {
		// A section pointing at linkSection=999 in a 2-section model is a
		// stale or corrupt index — the resolver should treat it as no link
		// and keep the section seeded by its own portal Y.
		const model = makeModel([
			makeSection({ portals: [makePortal(999, 7)] }),
			makeSection({ portals: [] }),
		]);
		const ys = resolveSectionYs(model);
		expect(ys[0]).toBe(7);
		expect(ys[1]).toBe(0);
	});

	it('terminates on a fully-portal-less model without infinite-looping', () => {
		// Pathological case — three sections, no portals anywhere. The BFS
		// frontier never starts, so every section falls back.
		const model = makeModel([
			makeSection({ portals: [] }),
			makeSection({ portals: [] }),
			makeSection({ portals: [] }),
		]);
		const ys = resolveSectionYs(model);
		expect(Array.from(ys)).toEqual([0, 0, 0]);
	});
});

// ---------------------------------------------------------------------------
// Legacy V4/V6 — same algorithm against `midPosition.y`
// ---------------------------------------------------------------------------

describe('meanLegacyPortalY', () => {
	it('returns null for portal-less legacy sections', () => {
		expect(meanLegacyPortalY(makeLegacySection())).toBeNull();
	});

	it('reads height from midPosition.y (Vector4) rather than position', () => {
		const sec = makeLegacySection({ portals: [makeLegacyPortal(1, 33)] });
		expect(meanLegacyPortalY(sec)).toBe(33);
	});
});

describe('resolveLegacySectionYs', () => {
	it('seeds and propagates against the legacy parallel-array storage', () => {
		const model = makeLegacyModel([
			makeLegacySection({ portals: [makeLegacyPortal(1, 8)] }),
			makeLegacySection({ portals: [] }),
		]);
		const ys = resolveLegacySectionYs(model);
		expect(ys[0]).toBe(8);
		expect(ys[1]).toBe(8);
	});
});

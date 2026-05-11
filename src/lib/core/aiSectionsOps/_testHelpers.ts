// Shared test fixtures for the aiSectionsOps directory module.
//
// `makeSection` / `makeModel` build a tiny `ParsedAISectionsV12` for the V12
// retail tests; `makeLegacyV4Section` / `makeLegacyV6Section` / `makeLegacyModel`
// do the same for the legacy V4/V6 layouts. The split test files import these
// builders so they don't drift out of sync — every test exercising the public
// API uses the same starting shape.
//
// Underscore-prefixed because this file is private to the directory; the
// production barrel never re-exports it.

import {
	LegacyDangerRating,
	LegacyEDistrict,
	SectionSpeed,
	AI_SECTIONS_VERSION,
	type AISection,
	type LegacyAISection,
	type LegacyAISectionsData,
	type LegacyPortal,
	type ParsedAISectionsV12,
	type Portal,
	type SectionResetPair,
	type Vector2,
} from '../aiSections';
import { EResetSpeedType } from '../aiSections';

// ---------------------------------------------------------------------------
// V12 builders
// ---------------------------------------------------------------------------

export function makeSection(opts: {
	id?: number;
	corners?: Vector2[];
	portals?: Portal[];
	spanIndex?: number;
	speed?: SectionSpeed;
	district?: number;
	flags?: number;
}): AISection {
	return {
		portals: opts.portals ?? [],
		noGoLines: [],
		corners: opts.corners ?? [
			// Default unit square (CCW in XZ, edge 0 = bottom, edge 1 = right,
			// edge 2 = top, edge 3 = left).
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
			{ x: 0, y: 10 },
		],
		id: opts.id ?? 0xAA,
		spanIndex: opts.spanIndex ?? -1,
		speed: opts.speed ?? SectionSpeed.E_SECTION_SPEED_NORMAL,
		district: opts.district ?? 0,
		flags: opts.flags ?? 0,
	};
}

export function makeModel(sections: AISection[]): ParsedAISectionsV12 {
	return {
		kind: 'v12',
		version: AI_SECTIONS_VERSION,
		sectionMinSpeeds: [0, 0, 0, 0, 0],
		sectionMaxSpeeds: [0, 0, 0, 0, 0],
		sections,
		sectionResetPairs: [],
	};
}

// Helper: build a portal that links to `target`.
export function portalTo(target: number): Portal {
	return {
		position: { x: 0, y: 0, z: 0 },
		boundaryLines: [],
		linkSection: target,
	};
}

// Helper: build a reset pair.
export function resetPair(start: number, reset: number): SectionResetPair {
	return {
		resetSpeed: EResetSpeedType.E_RESET_SPEED_TYPE_NONE,
		startSectionIndex: start,
		resetSectionIndex: reset,
	};
}

// ---------------------------------------------------------------------------
// Legacy V4 / V6 builders
// ---------------------------------------------------------------------------

export function makeLegacyV4Section(opts: {
	cornersX?: number[];
	cornersZ?: number[];
	portals?: LegacyPortal[];
	dangerRating?: number;
	flags?: number;
} = {}): LegacyAISection {
	return {
		portals: opts.portals ?? [],
		noGoLines: [],
		// Default unit square mirroring the V12 builder above (CCW in XZ,
		// edge 0 = bottom, edge 1 = right, edge 2 = top, edge 3 = left).
		cornersX: opts.cornersX ?? [0, 10, 10, 0],
		cornersZ: opts.cornersZ ?? [0, 0, 10, 10],
		dangerRating: opts.dangerRating ?? LegacyDangerRating.E_DANGER_RATING_NORMAL,
		flags: opts.flags ?? 0,
	};
}

export function makeLegacyV6Section(opts: {
	cornersX?: number[];
	cornersZ?: number[];
	portals?: LegacyPortal[];
	dangerRating?: number;
	flags?: number;
	spanIndex?: number;
	district?: number;
} = {}): LegacyAISection {
	return {
		...makeLegacyV4Section(opts),
		spanIndex: opts.spanIndex ?? -1,
		district: opts.district ?? LegacyEDistrict.E_DISTRICT_SUBURBS,
	};
}

export function makeLegacyModel(version: 4 | 6, sections: LegacyAISection[]): LegacyAISectionsData {
	return { version, sections };
}

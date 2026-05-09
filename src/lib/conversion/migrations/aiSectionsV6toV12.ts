// AI Sections V6 → V12 migration (issue #40).
//
// Converts a Burnout 5 2007-02-22 prototype V6 AI Sections payload into the
// retail V12 shape. Pure: same input → same output, no I/O.
//
// === Investigation findings (see scripts/investigate-aiSections-v6-to-v12.ts) ===
//
// V6 carries strictly more information than V4 — `spanIndex` (i32),
// `district` (u8 enum), and a documented three-bit flag set
// (IS_IN_AIR / IS_SHORTCUT / IS_JUNCTION). That trims the defaulted list
// (V12's spanIndex / district come straight across) and adds a real flag
// mapping rather than V4's "drop everything".
//
// Defaulted fields (V12 additive — V6 has no equivalent):
//
//   - sectionMinSpeeds / sectionMaxSpeeds — V6 has no per-speed limits.
//     Both retail PC and PS3 fixtures ship identical values; we use them
//     as a stable default. See `RETAIL_SPEED_*` below. Same constants as
//     V4→V12 (#36) — kept duplicated rather than shared so the V6
//     migration is auditable as a single self-contained file.
//   - sectionResetPairs — V6 has no reset table. Defaulted to empty.
//   - sections[].id — V6 sections have no AISectionId (V12 uses a u32).
//     We synthesise the index (0..N-1) so the IDs are deterministic and
//     round-trip-stable; V6 had no GameDB hashes either, so any choice is
//     invented. Same approach as V4→V12.
//
// Pass-through fields (V6 carries them directly, no synthesis):
//
//   - sections[].spanIndex — V6 `i32` widens cleanly into V12's `i16`
//     storage in practice (each section can reference one span; with
//     section counts in the low thousands the index never approaches
//     32767). Pass through verbatim. The V6 fixture's 3,900 sections
//     produced 2,250 positive spanIndex values, all within i16 range.
//   - sections[].district — always 0 across the V6 fixture (3,900/3,900)
//     and the V12 PC retail fixture (8,780/8,780). Pass through verbatim;
//     the byte will be 0 in any practical input. The enum values for
//     non-zero districts (1..4) survive untouched if a synthetic V6 ever
//     uses them.
//
// Lossy fields (V6 carries information that V12 maps with a semantic
// change — see the JSDoc on `migrateV6toV12` for the per-field rationale):
//
//   - sections[].speed (from dangerRating) — Same modal mapping derived
//     in #36's V4 investigation (the V6 axis is the same enum). Spatial
//     join on the V6 fixture vs V12 PC retail confirmed the modal
//     mapping holds: dr=0 (Freeway) → VERY_FAST is the 1st-place mode
//     (214/493 within 50 units, vs 209 NORMAL — close call but
//     consistent with V4's much stronger dominance). dr=1 (Normal) →
//     NORMAL (1798/2293). dr=2 (Dangerous) → NORMAL (975/1026). The
//     dangerRating axis was retired in V12; this is a documented guess.
//   - sections[].flags (V6 → V12 cognate name mapping) — V6's three flag
//     bits map onto V12's same-name bits via a 1:1 rename (V6 IS_IN_AIR →
//     V12 IN_AIR, V6 IS_SHORTCUT → V12 SHORTCUT, V6 IS_JUNCTION → V12
//     JUNCTION). Spatial-join correlation against V12 PC retail:
//     SHORTCUT 70.4% direct hit (722/1025, with 147 more hitting the
//     adjacent AI_SHORTCUT bit), JUNCTION 59% direct hit (199/336),
//     IN_AIR 30% direct hit (15/50 — small sample). Cognate names are
//     the natural mapping; topology shifts between the V6 prototype map
//     and the V12 retail map account for the imperfect correlation.
//   - sections[].portals[].position (V6 midPosition.w dropped — same
//     vpu::Vector3 structural padding as V4). All 8,906 portals in the
//     V6 fixture have w=0, but the parser preserves the field verbatim
//     for round-trip fidelity, and a non-zero W on a synthetic V6 would
//     silently vanish here, so we flag it as lossy when at least one
//     section has portals.
//
// Dropped fields (V6 has, V12 doesn't):
//
//   - sections[].dangerRating — superseded by `speed`; the V6 enum value
//     is consumed via DANGER_TO_SPEED, not preserved.
//
// V12 has but V6 → V12 doesn't synthesise (left at zero):
//
//   - V12 flag bits NO_RESET / SPLIT / TERMINATOR / AI_SHORTCUT /
//     AI_INTERSTATE_EXIT — the V6 model has no fields that signal these.
//     Users who want them set must edit the V12 result by hand.

import type {
	ParsedAISectionsV6,
	ParsedAISectionsV12,
	AISection,
	Portal,
	BoundaryLine,
	LegacyAISection,
} from '@/lib/core/aiSections';
import {
	SectionSpeed,
	AISectionFlag,
	LegacyAISectionFlagV6,
	CORNERS_PER_SECTION,
} from '@/lib/core/aiSections';
import type { ConversionResult } from '@/lib/editor/types';

// ---------------------------------------------------------------------------
// Defaults sourced from retail PC/PS3 fixtures. Identical to V4→V12 (#36) —
// duplicated here so the V6 migration is self-contained and auditable.
// ---------------------------------------------------------------------------

const RETAIL_SPEED_MIN: readonly number[] = [
	67.05000305175781,
	24.583332061767578,
	26.81666374206543,
	29.05000114440918,
	31.28333282470703,
];

const RETAIL_SPEED_MAX: readonly number[] = [
	71.51666259765625,
	58.11666488647461,
	71.51666259765625,
	75.98332977294922,
	80.44999694824219,
];

// ---------------------------------------------------------------------------
// dangerRating → speed (lossy, modal mapping). Same axis values as V4 — kept
// duplicated rather than imported from `aiSectionsV4toV12.ts` so the V6
// migration's investigation findings are documented in one place.
//
// V6 fixture vs V12 PC retail spatial-join distribution (within 50 world
// units, 3,786/3,900 sections matched):
//
//   Freeway   (0):  214 → VERY_FAST, 209 → NORMAL, 65 → FAST   (n=493)
//   Normal    (1): 1798 → NORMAL, 393 → FAST, 31 → SLOW, ...   (n=2293)
//   Dangerous (2):  975 → NORMAL, 42 → FAST, 7 → VERY_SLOW, …  (n=1026)
//
// Same modal pick as V4. The Freeway → VERY_FAST mode is closer to a tie
// in V6 than V4, but VERY_FAST stays the 1st-place pick on the spatial
// join.
// ---------------------------------------------------------------------------

const DANGER_TO_SPEED: Record<number, SectionSpeed> = {
	0: SectionSpeed.E_SECTION_SPEED_VERY_FAST, // Freeway   → Very Fast
	1: SectionSpeed.E_SECTION_SPEED_NORMAL,    // Normal    → Normal
	2: SectionSpeed.E_SECTION_SPEED_NORMAL,    // Dangerous → Normal (the V4/V6 axis was retired in V12)
};

// ---------------------------------------------------------------------------
// V6 flag-bit → V12 flag-bit table. Cognate name mapping; see file header
// for the spatial-correlation rationale. Two-tuple `[v6Mask, v12Mask]`
// keeps the table grep-able for the bit values.
// ---------------------------------------------------------------------------

const V6_TO_V12_FLAG_MAP: readonly { v6: number; v12: number }[] = [
	{ v6: LegacyAISectionFlagV6.IS_IN_AIR,   v12: AISectionFlag.IN_AIR },
	{ v6: LegacyAISectionFlagV6.IS_SHORTCUT, v12: AISectionFlag.SHORTCUT },
	{ v6: LegacyAISectionFlagV6.IS_JUNCTION, v12: AISectionFlag.JUNCTION },
];

function mapV6Flags(v6Flags: number): number {
	let v12 = 0;
	for (const { v6, v12: v12Bit } of V6_TO_V12_FLAG_MAP) {
		if (v6Flags & v6) v12 |= v12Bit;
	}
	return v12;
}

// ---------------------------------------------------------------------------
// Per-section migration — same Set-of-paths bookkeeping shape as V4→V12 so
// callers that mix per-resource and per-section reports get a consistent
// surface.
// ---------------------------------------------------------------------------

type ReportSet = Set<string>;

/** Per-section migration report — the set of `defaulted` / `lossy` field
 *  paths recorded while migrating ONE V6 section. */
export type SectionMigrationReportV6 = {
	defaulted: ReadonlySet<string>;
	lossy: ReadonlySet<string>;
};

/**
 * Migrate a single V6 legacy AI section to its V12 shape. Pure function.
 *
 * `destinationIndex` is used for the placeholder `id` value — for the
 * whole-resource migration path, this doubles as the canonical sequential
 * id. Bulk-import callers can overwrite the id after the call.
 *
 * Unlike the V4 path, V6 sections carry their own `spanIndex`, `district`,
 * and a documented three-bit flag set, so they are NOT defaulted — they
 * pass through (with the V6→V12 flag mapping applied).
 *
 * @param v6 The V6 section to migrate. The `LegacyAISection` shape declares
 *   `spanIndex` / `district` as optional because the same type is used by
 *   the V4 parser; on a V6 section both are guaranteed populated.
 * @param options.destinationIndex Placeholder section id; bulk-import
 *   callers can overwrite this after the call.
 */
export function migrateSectionV6toV12(
	v6: LegacyAISection,
	options: { destinationIndex: number },
): { section: AISection; report: SectionMigrationReportV6 } {
	const defaulted: ReportSet = new Set();
	const lossy: ReportSet = new Set();
	const section = migrateSection(v6, options.destinationIndex, defaulted, lossy);
	return { section, report: { defaulted, lossy } };
}

function migrateSection(
	v6: LegacyAISection,
	index: number,
	defaulted: ReportSet,
	lossy: ReportSet,
): AISection {
	// V6 corners — same parallel cornersX / cornersZ f32[4] layout as V4;
	// V12 packs them as Vector2[4] with x=worldX, y=worldZ.
	const corners = Array.from({ length: CORNERS_PER_SECTION }, (_, c) => ({
		x: v6.cornersX[c] ?? 0,
		y: v6.cornersZ[c] ?? 0,
	}));

	const portals: Portal[] = v6.portals.map((p) => {
		// midPosition.w is structural padding (vpu::Vector3 → 4 bytes pad);
		// V12 portals are packed vec3, so W is unconditionally dropped.
		// Tracked as lossy even when W is 0 because the V6 parser preserves
		// it verbatim; a non-zero W on a synthetic V6 would silently vanish.
		return {
			position: { x: p.midPosition.x, y: p.midPosition.y, z: p.midPosition.z },
			boundaryLines: p.boundaryLines.map((bl): BoundaryLine => ({
				verts: { x: bl.verts.x, y: bl.verts.y, z: bl.verts.z, w: bl.verts.w },
			})),
			linkSection: p.linkSection,
		};
	});

	const noGoLines: BoundaryLine[] = v6.noGoLines.map((bl) => ({
		verts: { x: bl.verts.x, y: bl.verts.y, z: bl.verts.z, w: bl.verts.w },
	}));

	const speedFromDanger = DANGER_TO_SPEED[v6.dangerRating];
	const speed = speedFromDanger ?? SectionSpeed.E_SECTION_SPEED_NORMAL;

	const v12Flags = mapV6Flags(v6.flags);

	defaulted.add('sections[].id');
	lossy.add('sections[].speed (from dangerRating)');
	if (v6.flags !== 0) {
		// Only flag this as lossy when at least one V6 bit was actually set
		// on the section — if no bits are set, no information was lost.
		lossy.add('sections[].flags (V6 IS_IN_AIR/IS_SHORTCUT/IS_JUNCTION mapped to V12 cognate bits)');
	}
	if (v6.portals.length > 0) {
		lossy.add('sections[].portals[].position (V6 midPosition.w dropped — vpu::Vector3 structural padding)');
	}

	return {
		portals,
		noGoLines,
		corners,
		// Sequential index — V6 has no AISectionId. Stable, deterministic,
		// cheap; same choice as V4→V12. Bulk-import callers can overwrite.
		id: index >>> 0,
		// V6 carries spanIndex (i32, -1 = none); pass through. The V12
		// writer truncates to i16, but in practice V6 spanIndex values
		// stay within i16 range (one entry per section, section counts
		// are in the low thousands).
		spanIndex: v6.spanIndex ?? -1,
		speed,
		// V6 carries district; pass through. Always 0 in retail-equivalent
		// V6 data — the V6 fixture has 3,900/3,900 sections at
		// E_DISTRICT_SUBURBS.
		district: v6.district ?? 0,
		flags: v12Flags,
	};
}

/**
 * Convert a Burnout 5 2007-02-22 prototype V6 AI Sections payload to the
 * retail Paradise V12 shape. Pure function.
 *
 * V6 has more direct overlap with V12 than V4: `spanIndex` and `district`
 * pass through verbatim, the V6 flag bits map cognate-name onto V12 flag
 * bits (IS_IN_AIR → IN_AIR, IS_SHORTCUT → SHORTCUT, IS_JUNCTION →
 * JUNCTION). The migration still has to default V12's per-speed limits
 * tables and reset-pair table (V6 has no equivalent) and synthesise
 * sequential section ids (V6 has no GameDB hashes). Three V6 fields
 * remain lossy: `dangerRating` is collapsed into V12's `speed` enum, the
 * V6 flag-bit cognate mapping is a documented guess (spatial correlation
 * 30–70%), and the portal `midPosition.w` structural-padding word is
 * dropped.
 *
 * @param v6 The V6 model to migrate.
 * @returns `result` = a fully-formed V12 model the writer can serialise;
 *          `defaulted` = field paths filled from defaults;
 *          `lossy` = field paths whose V6 source had no clean V12 equivalent.
 */
export function migrateV6toV12(v6: ParsedAISectionsV6): ConversionResult<ParsedAISectionsV12> {
	const defaulted = new Set<string>();
	const lossy = new Set<string>();

	defaulted.add('sectionMinSpeeds');
	defaulted.add('sectionMaxSpeeds');
	defaulted.add('sectionResetPairs');

	const sections: AISection[] = v6.legacy.sections.map((s, i) => {
		const { section, report } = migrateSectionV6toV12(s, { destinationIndex: i });
		for (const f of report.defaulted) defaulted.add(f);
		for (const f of report.lossy) lossy.add(f);
		return section;
	});

	const result: ParsedAISectionsV12 = {
		kind: 'v12',
		version: 12,
		sectionMinSpeeds: [...RETAIL_SPEED_MIN],
		sectionMaxSpeeds: [...RETAIL_SPEED_MAX],
		sections,
		sectionResetPairs: [],
	};

	return {
		result,
		defaulted: [...defaulted].sort(),
		lossy: [...lossy].sort(),
	};
}

export type { ParsedAISectionsV6, ParsedAISectionsV12 };

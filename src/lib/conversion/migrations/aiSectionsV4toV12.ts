// AI Sections V4 → V12 migration (issue #36).
//
// Converts a Burnout 5 prototype V4 AI Sections payload into the retail
// V12 shape. The function is pure: same input → same output, no I/O. The
// V12 export pipeline (next slice) calls this when the user picks
// "Convert to v12" on a V4 resource.
//
// === Investigation findings (see scripts/investigate-aiSections-v4-to-v12.ts) ===
//
// Defaulted fields (additive in V12 — V4 has no equivalent, so we fill
// with retail-bundle defaults):
//
//   - sectionMinSpeeds / sectionMaxSpeeds — V4 has no per-speed limits.
//     The retail PC and PS3 fixtures both ship the same values, so we use
//     them as a stable default. See `RETAIL_SPEED_*` below.
//   - sectionResetPairs — V4 has no reset table. Defaulted to empty.
//   - sections[].id — V4 sections have no AISectionId (V12 uses a u32
//     hash). We synthesise the index (0..N-1) so the IDs are deterministic
//     and round-trip-stable. Burnout 5 had no GameDB hashes at all in this
//     build, so any choice is invented; sequential-index is the simplest
//     stable choice and is easy for a human to scan.
//   - sections[].spanIndex — V4 has no spanIndex (V6 added it). Defaulted
//     to -1 ("no span"), matching V12's encoding for sections that don't
//     touch a StreetData span.
//   - sections[].district — V4 has no district. Defaulted to 0, the only
//     value seen in retail (the district enum is a V6-only experiment).
//
// Lossy fields (V4 carries information that V12 either drops or maps with
// a semantic change — see the JSDoc on `migrateV4toV12` for the
// per-field rationale):
//
//   - sections[].speed (from dangerRating) — see DANGER_TO_SPEED below.
//     The fixture-spatial join shows Freeway → VERY_FAST and both Normal
//     and Dangerous → NORMAL is the dominant V12 retail mapping (~80–90 %
//     of overlapping sections). The V4 dangerRating axis was retired —
//     "dangerous" doesn't mean "drive fast", it means "AI navigation is
//     risky here", which doesn't survive into V12's per-cell speed enum.
//   - sections[].flags (V4 bit 0x01 dropped — meaning unknown) — only 80
//     of 2,442 V4 sections set this bit. Spatially, only 1/80 lands on a
//     V12 IN_AIR section, so the wiki's "likely IN_AIR precursor" hint
//     does NOT hold up against the fixtures. Drop the bit and emit no
//     V12 flags (flags = 0). If a user wants to recover the bit's V4
//     semantics, they can edit the V12 flags by hand after migration.
//   - sections[].portals[].position (V4 midPosition.w dropped — vpu::Vector3
//     structural padding) — the V4 portal stores a 16-byte vec4 because
//     `vpu::Vector3` carries 4 bytes of structural padding; the W
//     component is typically 0.0 but is preserved by the V4 parser for
//     round-trip fidelity. V12 portals use a packed vec3, so W is
//     unconditionally dropped.

import type {
	ParsedAISectionsV4,
	ParsedAISectionsV12,
	AISection,
	Portal,
	BoundaryLine,
	LegacyAISection,
} from '@/lib/core/aiSections';
import { SectionSpeed, CORNERS_PER_SECTION } from '@/lib/core/aiSections';
import type { ConversionResult } from '@/lib/editor/types';

// ---------------------------------------------------------------------------
// Defaults sourced from retail PC/PS3 fixtures (see investigation script).
// Both ship identical values, so this isn't a per-platform pick — it's the
// canonical retail constant that V4 had no equivalent for.
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
// dangerRating → speed (lossy, but with a documented dominant mapping).
//
// Spatial-join distribution (V4 fixture vs V12 PC retail, sections within
// 50 world units of each other):
//
//   Freeway   (0): 170 → VERY_FAST, 26 → NORMAL, 1 → FAST          (n=197)
//   Normal    (1): 1451 → NORMAL, 331 → FAST, 17 → VERY_SLOW, ...  (n=1836)
//   Dangerous (2): 306 → NORMAL, 10 → FAST, 9 → VERY_SLOW, ...     (n=331)
//
// Picking the modal mapping per dangerRating value:
// ---------------------------------------------------------------------------

const DANGER_TO_SPEED: Record<number, SectionSpeed> = {
	0: SectionSpeed.E_SECTION_SPEED_VERY_FAST, // Freeway   → Very Fast
	1: SectionSpeed.E_SECTION_SPEED_NORMAL,    // Normal    → Normal
	2: SectionSpeed.E_SECTION_SPEED_NORMAL,    // Dangerous → Normal (the V4 axis was retired in V12)
};

// ---------------------------------------------------------------------------
// Bookkeeping for `defaulted` / `lossy` reporting. We use deduped sets so
// the per-section repetitions collapse into a single field-path entry.
// ---------------------------------------------------------------------------

type ReportSet = Set<string>;

function migrateSection(
	v4: LegacyAISection,
	index: number,
	defaulted: ReportSet,
	lossy: ReportSet,
): AISection {
	// V4 corners are parallel cornersX / cornersZ f32[4]; V12 packs them as
	// Vector2[4] with x=worldX, y=worldZ (the polygon is on the XZ plane).
	const corners = Array.from({ length: CORNERS_PER_SECTION }, (_, c) => ({
		x: v4.cornersX[c] ?? 0,
		y: v4.cornersZ[c] ?? 0,
	}));

	const portals: Portal[] = v4.portals.map((p) => {
		// midPosition.w is structural padding (vpu::Vector3 → 4 bytes pad);
		// the V12 portal is a packed vec3, so W is unconditionally dropped.
		// We track this as lossy even when W is exactly 0 because the V4
		// parser preserves it verbatim and a non-zero W would silently
		// vanish here.
		return {
			position: { x: p.midPosition.x, y: p.midPosition.y, z: p.midPosition.z },
			boundaryLines: p.boundaryLines.map((bl): BoundaryLine => ({
				verts: { x: bl.verts.x, y: bl.verts.y, z: bl.verts.z, w: bl.verts.w },
			})),
			linkSection: p.linkSection,
		};
	});

	const noGoLines: BoundaryLine[] = v4.noGoLines.map((bl) => ({
		verts: { x: bl.verts.x, y: bl.verts.y, z: bl.verts.z, w: bl.verts.w },
	}));

	const speedFromDanger = DANGER_TO_SPEED[v4.dangerRating];
	const speed = speedFromDanger ?? SectionSpeed.E_SECTION_SPEED_NORMAL;

	defaulted.add('sections[].id');
	defaulted.add('sections[].spanIndex');
	defaulted.add('sections[].district');
	lossy.add('sections[].speed (from dangerRating)');
	if (v4.flags !== 0) {
		// Only flag this as lossy when the V4 bit was actually set on at
		// least one section — otherwise the model carried no information
		// to lose.
		lossy.add('sections[].flags (V4 bit 0x01 dropped — meaning unknown)');
	}
	if (v4.portals.length > 0) {
		lossy.add('sections[].portals[].position (V4 midPosition.w dropped — vpu::Vector3 structural padding)');
	}

	return {
		portals,
		noGoLines,
		corners,
		// Sequential index — V4 has no AISectionId. Stable + deterministic
		// + cheap; the alternative (hash-of-corners) is harder to scan and
		// changes when a user edits geometry.
		id: index >>> 0,
		spanIndex: -1,
		speed,
		district: 0,
		// V4 bit 0x01 is dropped (see file header). We don't synthesise V12
		// flag bits from V4 either — the V4 model has no portal-shortcut /
		// junction / interstate-exit information to seed them.
		flags: 0,
	};
}

/**
 * Convert a Burnout 5 prototype V4 AI Sections payload to the retail
 * Paradise V12 shape. Pure function — same input always produces the same
 * output (sequential `id` synthesis, fixed retail-speed defaults).
 *
 * The V4 schema lacks five categories of V12 data (`sectionMinSpeeds`,
 * `sectionMaxSpeeds`, `sectionResetPairs`, per-section `id` / `spanIndex`
 * / `district`); those are filled with the retail defaults documented in
 * the file header. Three V4 fields don't survive V12 cleanly (the
 * `dangerRating` axis was retired, the V4-only flag bit 0x01 has no V12
 * equivalent, and the portal `midPosition.w` structural-padding word is
 * dropped); those are reported in `lossy` so the export UI can warn the
 * user.
 *
 * @param v4 The V4 model to migrate.
 * @returns `result` = a fully-formed V12 model the writer can serialise;
 *          `defaulted` = field paths filled from defaults;
 *          `lossy` = field paths whose V4 source had no V12 equivalent.
 */
export function migrateV4toV12(v4: ParsedAISectionsV4): ConversionResult<ParsedAISectionsV12> {
	const defaulted = new Set<string>();
	const lossy = new Set<string>();

	defaulted.add('sectionMinSpeeds');
	defaulted.add('sectionMaxSpeeds');
	defaulted.add('sectionResetPairs');

	const sections: AISection[] = v4.legacy.sections.map((s, i) =>
		migrateSection(s, i, defaulted, lossy),
	);

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

// Re-export for callers that want the typed alias (e.g. EditorProfile wiring).
export type { ParsedAISectionsV4, ParsedAISectionsV12 };

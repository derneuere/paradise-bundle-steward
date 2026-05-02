// Target presets for the "Export to game version..." flow.
//
// A preset names a complete export destination on three axes — container
// (BND1 / BND2), platform (PC / X360 / PS3), and the per-typeId variant
// `kind` that every resource of that type must end up as. The export
// dialog reads this registry to populate its dropdown; the export pipeline
// (`exportPlan.ts`) walks `kinds` to decide which resources need migrating
// and which pass through.
//
// Presets are intentionally hand-curated rather than synthesised — the set
// of game versions Steward can target is small, and being explicit about
// "which kind goes with which retail build" keeps the user out of
// invalid combinations (e.g. a V12 AI Sections inside a BND1 prototype
// container).
//
// Future presets land here as their migrations stabilise:
//   - 'paradise-pc-remastered' — once the Remastered V13 (or whatever) AI
//     Sections kind + migration are in.
//   - 'b5-prototype-x360' — round-trip the Burnout 5 prototype build with
//     V4 AI Sections in a BND1 container, BE encoding.
//
// The longer-term intent is one Container/Platform/Version export dialog
// that subsumes the existing platform-axis (PC/X360/PS3) and container-axis
// (BND1/BND2) export paths. This module is the first step — it cleanly
// names "where you want to land" so the platform/container/version axes
// can fold into the same picker later.

/**
 * A complete export destination — a single dropdown entry in the
 * "Export to game version..." dialog.
 *
 * @property id        Stable string identifier. Used to address the preset
 *                     from URL state, tests, etc. Must be unique within
 *                     `TARGET_PRESETS`.
 * @property label     Human-readable name shown in the dropdown.
 * @property container Output container format.
 * @property platform  Output platform (1=PC LE, 2=Xbox 360 BE, 3=PS3 BE).
 * @property kinds     For each typeId we want to constrain, the EditorProfile
 *                     `kind` every resource of that type must end up as.
 *                     Type IDs not listed pass through unchanged.
 */
export type TargetPreset = {
	id: string;
	label: string;
	container: 'bnd1' | 'bnd2';
	platform: 1 | 2 | 3;
	kinds: { [typeId: number]: string };
};

/**
 * Registered presets. Order is dropdown order. Add new entries below as
 * additional migrations stabilise.
 */
export const TARGET_PRESETS: readonly TargetPreset[] = [
	{
		id: 'paradise-pc-retail',
		label: 'Paradise PC Retail (V12, BND2, LE)',
		container: 'bnd2',
		platform: 1,
		// AI Sections (typeId 0x10001): retail uses the v12 layout. V4/V6
		// prototype variants will be migrated to v12 via the EditorProfile's
		// `conversions.v12` entry (issue #36 wires V4→V12).
		kinds: { 0x10001: 'v12' },
	},
];

/** Look up a preset by id. Returns undefined for unknown ids. */
export function getTargetPreset(id: string): TargetPreset | undefined {
	return TARGET_PRESETS.find((p) => p.id === id);
}

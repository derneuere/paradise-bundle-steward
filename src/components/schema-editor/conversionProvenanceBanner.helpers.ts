// Pure helpers for ConversionProvenanceBanner.
//
// The component itself is a thin layout wrapper around these — pulling
// the formatting into a node-testable module lets us assert the banner's
// content in vitest without DOM-test infrastructure (the repo's vitest
// env is `node`, no jsdom / @testing-library/react).
//
// Mirrors the `ConversionProvenance` shape from
// `src/context/WorkspaceContext.provenance.ts` so the component stays
// decoupled from the workspace-context import. Re-exported here for
// callers and tests.

export type ConversionProvenance = {
	sourceKind: string;
	targetKind: string;
	defaulted: string[];
	lossy: string[];
	exportedAt: number;
};

/**
 * Format the headline string shown at the top of the banner. The output
 * mirrors the wording from issue #38: `Converted from V4 to V12`. Kinds
 * are upper-cased so a `v4`/`v12` discriminator presents as a tidy `V4`/
 * `V12` to the user without burdening every migration entry to register
 * a display variant.
 */
export function formatBannerHeading(provenance: ConversionProvenance): string {
	const source = provenance.sourceKind.toUpperCase();
	const target = provenance.targetKind.toUpperCase();
	return `Converted from ${source} to ${target}`;
}

/**
 * True if the banner has anything worth showing. Both lists empty is a
 * degenerate case — the export ran but neither defaulted nor remapped
 * anything, which means the migration was a pure structural reshape.
 * Callers can treat this as "don't surface a banner" if they want; the
 * default behaviour is still to render so users know an export happened.
 */
export function hasFieldsToReport(provenance: ConversionProvenance): boolean {
	return provenance.defaulted.length > 0 || provenance.lossy.length > 0;
}

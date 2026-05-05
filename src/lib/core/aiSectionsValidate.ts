// AI Sections validation helpers — used both at import-preview time and at
// bundle-export time to surface unresolved portals.
//
// Walks every section's portals; flags portals whose linkSection is < 0
// (in-memory sentinel from older code) OR >= numSections (out-of-range,
// either the bulk-import 0xFFFF sentinel or genuinely-stale data) OR not a
// finite integer.
//
// Domain note (load-bearing): retail data already contains a non-zero count
// of portals at legitimate map boundaries that the game treats as "no
// neighbour" (these are 0xFFFF on the wire after the import flow lands).
// The dialog wording must make clear that the count includes pre-existing
// data so the user understands "N includes some retail boundaries" rather
// than reading the count as "N portals I just broke".

import type { ParsedAISectionsV12 } from './aiSections';

export type UnresolvedPortal = {
	sectionIdx: number;
	portalIdx: number;
	/** The original linkSection value — the sentinel (>= numSections, or
	 *  negative, or NaN) the dialog displays back to the user. */
	linkSection: number;
};

/**
 * Find every portal whose linkSection doesn't address a real section in
 * the model. Returns an empty array for an empty model. Pure function.
 */
export function findUnresolvedPortals(
	model: ParsedAISectionsV12,
): UnresolvedPortal[] {
	const out: UnresolvedPortal[] = [];
	const numSections = model.sections.length;
	for (let i = 0; i < numSections; i++) {
		const section = model.sections[i];
		const portals = section.portals;
		for (let p = 0; p < portals.length; p++) {
			const link = portals[p].linkSection;
			const isValid =
				Number.isFinite(link) &&
				Number.isInteger(link) &&
				link >= 0 &&
				link < numSections;
			if (!isValid) {
				out.push({ sectionIdx: i, portalIdx: p, linkSection: link });
			}
		}
	}
	return out;
}

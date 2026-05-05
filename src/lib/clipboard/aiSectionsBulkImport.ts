// AI Sections bulk-import pipeline (Slice 2).
//
// Takes a decoded BulkEnvelope and merges its items into a V12 destination
// model. Handles two source profiles:
//
//   - 'v12' source — items are AISection verbatim, used as-is.
//   - 'v4' / 'v6' source — items are LegacyAISection; each one runs through
//     migrateSectionV4toV12 to produce the V12 shape. The per-section
//     defaulted/lossy reports fold up into the result's union lists.
//
// The destination is V12 only — V4 schema is frozen, so V4 instances never
// surface the import UI. The function is total: every code path either
// returns a result or throws on an unsupported envelope profile.
//
// linkSection sentinel — IMPORTANT
//
//   V12's linkSection field is u16 on disk (see schema/resources/aiSections/
//   v12.ts and the writeU16 call in core/aiSections.ts). Storing `-1` works
//   in the in-memory model but `writeU16(-1)` masks to 0xFFFF on disk, so
//   the round-trip-stable sentinel for "no link" is 0xFFFF (65535). Real
//   section counts are <= 8780 in retail, so 0xFFFF is unambiguously out of
//   range and downstream consumers (the Y resolver, the overlay) already
//   treat out-of-range linkSection as "no link" — see aiSectionY.ts /
//   "ignores portal linkSection indices that are out of range".

import type {
	ParsedAISectionsV12,
	AISection,
	LegacyAISection,
} from '@/lib/core/aiSections';
import { migrateSectionV4toV12 } from '@/lib/conversion/migrations/aiSectionsV4toV12';
import type { BulkEnvelope } from './bulkEnvelope';
import type { AISectionsBulkItem } from './aiSectionsBulkExport';

export type ImportMode = 'append' | 'replace';

/**
 * Round-trip-stable u16 sentinel for "no link". See the file header for
 * why this is 0xFFFF and not -1: V12 linkSection is u16 on disk, so the
 * sentinel must survive writeU16/readU16 unchanged.
 */
export const NO_LINK_SENTINEL = 0xffff;

export type UnlinkedPortal = {
	/** Index in the FINAL destination list — i.e. after Append/Replace
	 *  placement. */
	destinationSectionIdx: number;
	portalIdx: number;
	/** The original linkSection value from the source bundle, for the
	 *  warnings dialog. */
	originalLinkSection: number;
};

export type AISectionsBulkImportInput = {
	envelope: BulkEnvelope<AISectionsBulkItem>;
	/** V12 only — V4 schema is frozen, so V4 instances never reach this
	 *  pipeline. */
	destination: ParsedAISectionsV12;
	mode: ImportMode;
	startId: number;
};

export type AISectionsBulkImportResult = {
	result: ParsedAISectionsV12;
	/** Top-level / per-section field paths that got defaulted because the
	 *  source profile didn't carry them (V4 → V12 fills `id`, `spanIndex`,
	 *  `district`, etc.). Sorted, deduped. */
	defaulted: readonly string[];
	/** Source-profile field paths with no V12 equivalent. Sorted, deduped. */
	lossy: readonly string[];
	/** Per-portal records of links that pointed OUTSIDE the bulk and were
	 *  rewritten to NO_LINK_SENTINEL. Used by the import-warnings dialog. */
	unlinkedPortals: readonly UnlinkedPortal[];
	/** Range of ids actually assigned (inclusive). null when the envelope
	 *  was empty. Surface in the UI so the user sees the IDs they need to
	 *  remember for GameDB tracking. */
	assignedIdRange: { firstId: number; lastId: number } | null;
};

/**
 * Merge the bulk envelope's items into the destination V12 model. Pure
 * function: same input → same output, no clipboard / DOM / network calls.
 *
 * The id assignment is sequential from `startId`. Bulk-import callers are
 * trusted to supply a starting id high enough to avoid GameDB collisions
 * with retail data; the caller surfaces the existing-id collision warning
 * in the dialog.
 */
export function importAISectionsBulk(
	input: AISectionsBulkImportInput,
): AISectionsBulkImportResult {
	const { envelope, destination, mode, startId } = input;
	const profile = envelope.profile;

	if (profile !== 'v12' && profile !== 'v4' && profile !== 'v6') {
		throw new Error(
			`importAISectionsBulk: unsupported envelope profile ${JSON.stringify(profile)}; expected 'v12', 'v4', or 'v6'.`,
		);
	}

	const existingSections: AISection[] =
		mode === 'append' ? destination.sections : [];
	const baseOffset = existingSections.length;

	// Build the sourceIndex → destinationIndex remap. Items are placed in
	// envelope order (the export side already sorted by sourceIndex
	// ascending, but we don't depend on that here).
	const remap = new Map<number, number>();
	envelope.items.forEach((item, k) => {
		remap.set(item.sourceIndex, baseOffset + k);
	});

	const defaulted = new Set<string>();
	const lossy = new Set<string>();
	const unlinkedPortals: UnlinkedPortal[] = [];

	const migratedItems: AISection[] = envelope.items.map((item, k) => {
		const destinationIndex = baseOffset + k;

		let section: AISection;
		if (profile === 'v12') {
			// V12 → V12: deep-clone the section so the workspace bundle's
			// model isn't aliased into the destination after import (mutating
			// the destination's portal would silently mutate the source).
			section = cloneV12Section(item.section as AISection);
		} else {
			const { section: migrated, report } = migrateSectionV4toV12(
				item.section as LegacyAISection,
				{ destinationIndex },
			);
			for (const f of report.defaulted) defaulted.add(f);
			for (const f of report.lossy) lossy.add(f);
			section = migrated;
		}

		// Overwrite the placeholder id with the user-chosen sequential id.
		section.id = (startId + k) >>> 0;

		// Rewrite portal linkSection values:
		//   - in-bulk source index → remapped destination index
		//   - everything else → NO_LINK_SENTINEL + record for the dialog
		const newPortals = section.portals.map((portal, portalIdx) => {
			const original = portal.linkSection;
			const remapped = remap.get(original);
			if (remapped != null) {
				return { ...portal, linkSection: remapped };
			}
			unlinkedPortals.push({
				destinationSectionIdx: destinationIndex,
				portalIdx,
				originalLinkSection: original,
			});
			return { ...portal, linkSection: NO_LINK_SENTINEL };
		});
		section.portals = newPortals;
		return section;
	});

	const finalSections =
		mode === 'append'
			? [...existingSections, ...migratedItems]
			: [...migratedItems];

	const result: ParsedAISectionsV12 = {
		...destination,
		sections: finalSections,
	};

	const assignedIdRange =
		migratedItems.length > 0
			? { firstId: startId >>> 0, lastId: (startId + migratedItems.length - 1) >>> 0 }
			: null;

	return {
		result,
		defaulted: [...defaulted].sort(),
		lossy: [...lossy].sort(),
		unlinkedPortals,
		assignedIdRange,
	};
}

/** Deep-clone a V12 AISection. Portals and boundary lines have to be
 *  duplicated independently because the user can re-open the source
 *  bundle later and edit the shared section while the destination
 *  references the same object reference — silent cross-bundle mutation. */
function cloneV12Section(s: AISection): AISection {
	return {
		portals: s.portals.map((p) => ({
			position: { ...p.position },
			boundaryLines: p.boundaryLines.map((bl) => ({ verts: { ...bl.verts } })),
			linkSection: p.linkSection,
		})),
		noGoLines: s.noGoLines.map((bl) => ({ verts: { ...bl.verts } })),
		corners: s.corners.map((c) => ({ ...c })),
		id: s.id,
		spanIndex: s.spanIndex,
		speed: s.speed,
		district: s.district,
		flags: s.flags,
	};
}

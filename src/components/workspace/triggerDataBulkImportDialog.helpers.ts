// Pure helpers for TriggerDataBulkImportDialog.
//
// Two jobs, both kept out of the .tsx so they're node-testable:
//   1. decodeTriggerEnvelope — wrap the resource-agnostic decodeBulkEnvelope,
//      then narrow to a TriggerData envelope by asserting resourceKey. Returns
//      a discriminated ok/err so the dialog can switch without try/catch.
//   2. buildTriggerImportPreview — produce the live preview block. It DOES NOT
//      re-derive the id / regionIndex assignment math; it runs the real
//      importTriggerDataBulk (the single source of truth) against the chosen
//      mode and reads the ranges + counts straight off the result. Re-deriving
//      would risk the preview drifting from what Confirm actually does.
//
// The import is total in normal use, but the regionIndex assignment can throw
// (i16 overflow past 32767 — see triggerDataBulkImport.ts). The preview catches
// that and surfaces it as an `error` field rather than letting it escape, so a
// destination already at the region cap shows a readable warning instead of a
// crashed dialog.

import { decodeBulkEnvelope, type BulkEnvelope } from '@/lib/clipboard/bulkEnvelope';
import {
	importTriggerDataBulk,
	type TriggerImportMode,
} from '@/lib/clipboard/triggerDataBulkImport';
import type {
	TriggerDataBulkItem,
	TriggerDataBulkListKey,
} from '@/lib/clipboard/triggerDataBulkExport';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import { parseStartingId } from './bulkImportDialog.helpers';

// The Starting-ID parser is resource-agnostic (decimal / 0x hex → u32 | null).
// Re-export the AI dialog's implementation so both import dialogs share ONE
// parser rather than drifting.
export { parseStartingId };

const RESOURCE_KEY = 'triggerData';

/** Canonical list order for displaying per-list counts — mirrors the export
 *  pipeline's fixed ordering so the preview reads the same way every time. */
export const TRIGGER_PREVIEW_LIST_ORDER: readonly TriggerDataBulkListKey[] = [
	'landmarks',
	'genericRegions',
	'blackspots',
	'vfxBoxRegions',
	'spawnLocations',
	'roamingLocations',
];

/** The lists that carry a box-region mId — the only imported entries that
 *  consume ids and can collide with a starting id. spawn / roaming carry no
 *  mId and are excluded. */
export const BOX_REGION_LIST_KEYS: readonly TriggerDataBulkListKey[] = [
	'landmarks',
	'genericRegions',
	'blackspots',
	'vfxBoxRegions',
];

/** Sum the four box-region list counts in a preview — the number of mIds the
 *  import will consume, for collision detection against the starting id. */
export function previewBoxRegionCount(preview: TriggerImportPreview): number {
	const boxKeys = new Set<TriggerDataBulkListKey>(BOX_REGION_LIST_KEYS);
	return preview.perList.reduce(
		(sum, l) => (boxKeys.has(l.listKey) ? sum + l.count : sum),
		0,
	);
}

// Each branch carries a field absent on the other (`reason?: undefined` /
// `envelope?: undefined`) so narrowing on `ok` works under the project's
// `strict: false` tsconfig — same trick bulkEnvelope.ts uses.
export type DecodedTriggerEnvelope =
	| { ok: true; envelope: BulkEnvelope<TriggerDataBulkItem>; reason?: undefined }
	| { ok: false; reason: string; envelope?: undefined };

/**
 * Decode a pasted / loaded string into a TriggerData bulk envelope. Wraps the
 * resource-agnostic validator, then enforces `resourceKey === 'triggerData'`
 * so a well-formed envelope for a DIFFERENT resource (e.g. an aiSections bulk)
 * is rejected with a clear message instead of silently importing garbage.
 */
export function decodeTriggerEnvelope(raw: string): DecodedTriggerEnvelope {
	const parsed = decodeBulkEnvelope(raw);
	if (!parsed.ok) return { ok: false, reason: parsed.reason };
	if (parsed.envelope.resourceKey !== RESOURCE_KEY) {
		return {
			ok: false,
			reason: `Wrong resource type: envelope is for ${parsed.envelope.resourceKey}, expected triggerData.`,
		};
	}
	// decodeBulkEnvelope returns `unknown[]` items by design; the import
	// pipeline structuredClones + casts each entry per listKey, so the cast
	// here is the same trust boundary the AI dialog uses.
	// TODO(types): a per-resource item validator that narrows TriggerDataBulkItem
	// shape lives outside this slice.
	return {
		ok: true,
		envelope: parsed.envelope as BulkEnvelope<TriggerDataBulkItem>,
	};
}

/** A single per-list line in the preview: the list and how many entries from
 *  the envelope land in it. Zero-count lists are still emitted so the preview
 *  shows the full six-list shape. */
export type TriggerPreviewListCount = {
	listKey: TriggerDataBulkListKey;
	count: number;
};

export type TriggerImportPreview = {
	/** Total entries across all six lists. */
	total: number;
	/** Per-list counts in canonical list order. */
	perList: TriggerPreviewListCount[];
	/** Box-region mId range that WILL be assigned on confirm (null when no
	 *  box-region — landmarks/genericRegions/blackspots/vfxBoxRegions — is in
	 *  the import; spawn/roaming carry no id). */
	assignedIdRange: { firstId: number; lastId: number } | null;
	/** Box-region regionIndex range that WILL be assigned on confirm (null when
	 *  no box-region is in the import). */
	assignedRegionIndexRange: { first: number; last: number } | null;
	/** True when the envelope profile != String(destination.version). Purely
	 *  informational — TriggerData needs no cross-version migration. */
	profileMismatch: boolean;
	/** Human-readable notes from the import pipeline (offline-landmark, profile
	 *  mismatch, etc.). */
	notes: string[];
	/** Set when the import would throw (i16 regionIndex overflow). When present
	 *  the dialog must block confirm. */
	error: string | null;
};

/**
 * Build the live preview for a decoded envelope against a destination + mode.
 * Runs the real import so the displayed ranges are EXACTLY what Confirm will
 * assign — no parallel math to drift out of sync. `startId`, when provided,
 * seeds the previewed assignedIdRange to the user's chosen base mId.
 */
export function buildTriggerImportPreview(
	envelope: BulkEnvelope<TriggerDataBulkItem>,
	destination: ParsedTriggerData,
	mode: TriggerImportMode,
	startId?: number,
): TriggerImportPreview {
	try {
		const out = importTriggerDataBulk({ envelope, destination, mode, startId });
		const perList: TriggerPreviewListCount[] = TRIGGER_PREVIEW_LIST_ORDER.map(
			(listKey) => ({ listKey, count: out.perListCounts[listKey] }),
		);
		const total = perList.reduce((sum, l) => sum + l.count, 0);
		return {
			total,
			perList,
			assignedIdRange: out.assignedIdRange,
			assignedRegionIndexRange: out.assignedRegionIndexRange,
			profileMismatch: out.profileMismatch,
			notes: out.notes,
			error: null,
		};
	} catch (err) {
		return {
			total: 0,
			perList: TRIGGER_PREVIEW_LIST_ORDER.map((listKey) => ({ listKey, count: 0 })),
			assignedIdRange: null,
			assignedRegionIndexRange: null,
			profileMismatch: envelope.profile !== String(destination.version),
			notes: [],
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/** The four box-region lists that carry an mId. Only these consume mIds —
 *  spawn / roaming locations do not, so they never collide with a starting id. */
function boxRegionIds(destination: ParsedTriggerData): number[] {
	return [
		...destination.landmarks.map((r) => r.id),
		...destination.genericRegions.map((r) => r.id),
		...destination.blackspots.map((r) => r.id),
		...destination.vfxBoxRegions.map((r) => r.id),
	];
}

/** Suggest a starting mId high enough to sit above every box-region id already
 *  in the destination: `max(existing box-region id) + 1`, or 0 when the
 *  destination carries no box regions. Mirrors the AI dialog's default. */
export function defaultTriggerStartId(destination: ParsedTriggerData): number {
	let max = -1;
	for (const id of boxRegionIds(destination)) {
		if (id > max) max = id;
	}
	return (max + 1) >>> 0;
}

/** Ids in `[startId, startId + boxRegionCount - 1]` that already exist among the
 *  destination's four box-region lists, sorted ascending. Only box regions
 *  consume mIds, so spawn / roaming counts must be excluded from
 *  `boxRegionCount` by the caller. */
export function detectTriggerIdCollisions(
	destination: ParsedTriggerData,
	startId: number,
	boxRegionCount: number,
): number[] {
	if (boxRegionCount <= 0) return [];
	const lo = startId >>> 0;
	const hi = (startId + boxRegionCount - 1) >>> 0;
	const existing = new Set<number>();
	for (const id of boxRegionIds(destination)) existing.add(id >>> 0);
	const out: number[] = [];
	for (let i = lo; i <= hi; i++) {
		if (existing.has(i)) out.push(i);
	}
	return out;
}

/** Format a box-region id / index as a decimal+hex paired string
 *  (`0x9000 (36864)`). Matches the AI dialog's id labelling so the two import
 *  dialogs read consistently. */
export function formatTriggerIdLabel(id: number): string {
	const u = id >>> 0;
	return `0x${u.toString(16).toUpperCase()} (${u})`;
}

// Pure helpers for `BulkPanel`'s export buttons. Lives in `.ts` (no React)
// so the unit tests under `__tests__/` can drive the envelope-shaping
// logic without mounting the panel.

import type {
	ParsedAISections,
	ParsedAISectionsV12,
	ParsedAISectionsV4,
	ParsedAISectionsV6,
} from '@/lib/core/aiSections';
import {
	exportAISectionsBulk,
	type AISectionsBulkItem,
} from '@/lib/clipboard/aiSectionsBulkExport';
import {
	exportTriggerDataBulk,
	type TriggerDataBulkItem,
	type TriggerDataBulkListKey,
} from '@/lib/clipboard/triggerDataBulkExport';
import { parseSectionPathKey } from './aiSectionsBulk';
import { parseEntryPathKey } from './triggerDataBulk';
import type { WorkspaceAISectionsBulkSummary } from './AISectionsBulkProvider';
import type { WorkspaceTriggerDataBulkSummary } from './TriggerDataBulkProvider';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import type { BulkEnvelope } from '@/lib/clipboard/bulkEnvelope';

/** Translate a workspace bulk summary's path-keyed Set into the
 *  source-section-index Set the export pipeline expects. Cross-variant
 *  entries (a V12 path key when the model is V4, or vice-versa) are
 *  silently dropped — the bulk only addresses sections within ONE
 *  resource, so cross-variant entries are nonsensical. */
export function bulkPathKeysToSectionIndices(
	pathKeys: ReadonlySet<string>,
	modelKind: ParsedAISections['kind'],
): Set<number> {
	const out = new Set<number>();
	const expectedVariant = modelKind === 'v12' ? 'v12' : 'legacy';
	for (const key of pathKeys) {
		const addr = parseSectionPathKey(key);
		if (!addr) continue;
		if (addr.variant !== expectedVariant) continue;
		out.add(addr.sectionIndex);
	}
	return out;
}

/** Build a BulkEnvelope ready to feed encodeBulkEnvelope from a workspace
 *  bulk summary + the parsed AI Sections model the summary points at. */
export function buildEnvelopeFromBulk(
	model: ParsedAISections,
	summary: WorkspaceAISectionsBulkSummary,
	sourceBundleFilename: string,
): BulkEnvelope<AISectionsBulkItem> {
	const indices = bulkPathKeysToSectionIndices(summary.pathKeys, model.kind);
	return exportAISectionsBulk({
		// Narrow the discriminated-union type so TS picks the right branch.
		model: model as
			| ParsedAISectionsV12
			| ParsedAISectionsV4
			| ParsedAISectionsV6,
		selectedSectionIndices: indices,
		sourceBundleFilename,
	});
}

/** Build the export filename. Format: `bulk-${slug}-${bundleFilename}-${YYYYMMDD-HHMMSS}.json`.
 *  The timestamp is local-clock so users on the same machine can sort their
 *  exports without timezone surprises. `slug` defaults to `'aisections'` so
 *  the AI call sites stay unchanged; the trigger panel passes `'triggerdata'`. */
export function exportEnvelopeFilename(
	bundleFilename: string,
	now: Date = new Date(),
	slug = 'aisections',
): string {
	const stamp = formatTimestamp(now);
	const safeName = bundleFilename.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]/g, '_');
	return `bulk-${slug}-${safeName}-${stamp}.json`;
}

/** Filename for a TriggerData bulk export — same shape as the AI export, only
 *  the resource slug differs. */
export function exportTriggerEnvelopeFilename(
	bundleFilename: string,
	now: Date = new Date(),
): string {
	return exportEnvelopeFilename(bundleFilename, now, 'triggerdata');
}

/** Translate a workspace TriggerData bulk summary's path-key Set (keys like
 *  `'genericRegions/3'`) into the `{ listKey, index }[]` that
 *  `exportTriggerDataBulk` expects. Unlike AI, triggers have no cross-variant
 *  disambiguation — keys just group by `listKey`. Indices past the end of
 *  their list in the model are dropped so a stale selection never emits a
 *  phantom entry. */
export function triggerBulkPathKeysToEntries(
	pathKeys: ReadonlySet<string>,
	model: ParsedTriggerData,
): Array<{ listKey: TriggerDataBulkListKey; index: number }> {
	const out: Array<{ listKey: TriggerDataBulkListKey; index: number }> = [];
	for (const key of pathKeys) {
		const addr = parseEntryPathKey(key);
		if (!addr) continue;
		const listKey = addr.listKey as TriggerDataBulkListKey;
		const list = model[listKey];
		// parseEntryPathKey already gates listKey to the six bulk lists, but the
		// index can still be out of range if the model shrank since selection.
		if (!Array.isArray(list) || addr.index < 0 || addr.index >= list.length) continue;
		out.push({ listKey, index: addr.index });
	}
	return out;
}

/** Build a BulkEnvelope ready to feed encodeBulkEnvelope from a workspace
 *  TriggerData bulk summary + the parsed model the summary points at. */
export function buildTriggerEnvelopeFromBulk(
	model: ParsedTriggerData,
	summary: WorkspaceTriggerDataBulkSummary,
	sourceBundleFilename: string,
): BulkEnvelope<TriggerDataBulkItem> {
	const selectedEntries = triggerBulkPathKeysToEntries(summary.pathKeys, model);
	return exportTriggerDataBulk({
		model,
		selectedEntries,
		sourceBundleFilename,
	});
}

function formatTimestamp(d: Date): string {
	const pad = (n: number) => n.toString().padStart(2, '0');
	return (
		d.getFullYear().toString() +
		pad(d.getMonth() + 1) +
		pad(d.getDate()) +
		'-' +
		pad(d.getHours()) +
		pad(d.getMinutes()) +
		pad(d.getSeconds())
	);
}

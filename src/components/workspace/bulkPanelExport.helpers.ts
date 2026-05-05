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
import { parseSectionPathKey } from './aiSectionsBulk';
import type { WorkspaceAISectionsBulkSummary } from './AISectionsBulkProvider';
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

/** Build the export filename. Format: `bulk-aisections-${bundleFilename}-${YYYYMMDD-HHMMSS}.json`.
 *  The timestamp is local-clock so users on the same machine can sort their
 *  exports without timezone surprises. */
export function exportEnvelopeFilename(
	bundleFilename: string,
	now: Date = new Date(),
): string {
	const stamp = formatTimestamp(now);
	const safeName = bundleFilename.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]/g, '_');
	return `bulk-aisections-${safeName}-${stamp}.json`;
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

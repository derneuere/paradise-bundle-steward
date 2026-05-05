// AI Sections bulk-export pipeline (Slice 2).
//
// Slots between the workspace bulk panel's "Export → clipboard / file…"
// buttons and the resource-agnostic JSON envelope. The export side never
// migrates — V4/V6 bulks ship as V4/V6 items and the import side decides
// whether to migrate based on `envelope.profile` vs the destination's
// profile.
//
// Determinism: items go out in ascending sourceIndex order. The user's
// click sequence inside the workspace is irrelevant — sorting here makes
// the JSON byte-stable for the same selection regardless of click order,
// which matters for diffing two exports of "the same selection".

import type {
	ParsedAISectionsV12,
	ParsedAISectionsV4,
	ParsedAISectionsV6,
	AISection,
	LegacyAISection,
} from '@/lib/core/aiSections';
import {
	encodeBulkEnvelope as _unused_encode, // keep import discoverable
	type BulkEnvelope,
} from './bulkEnvelope';

// Silence the unused-symbol warning from the import-discovery comment above.
void _unused_encode;

export type AISectionsBulkItem = {
	/** Source-bundle index of the section. The import pipeline uses this to
	 *  build a `sourceIndex → destinationIndex` remap so portal.linkSection
	 *  values that pointed at other in-bulk sections rewrite correctly. */
	sourceIndex: number;
	/** Profile-shaped section data. For V12 this is `AISection` verbatim;
	 *  for V4/V6 this is `LegacyAISection` verbatim. The envelope's
	 *  `profile` field tells the import side which type to expect. */
	section: AISection | LegacyAISection;
};

export type AISectionsBulkExportInput = {
	model: ParsedAISectionsV12 | ParsedAISectionsV4 | ParsedAISectionsV6;
	selectedSectionIndices: ReadonlySet<number>;
	sourceBundleFilename?: string;
};

const RESOURCE_KEY = 'aiSections';

/**
 * Build a JSON envelope from a workspace bulk selection. The envelope is
 * resource-agnostic; the AI-Sections-specific logic — which sections to
 * include, which profile to label them with — lives here.
 */
export function exportAISectionsBulk(
	input: AISectionsBulkExportInput,
): BulkEnvelope<AISectionsBulkItem> {
	const sortedIndices = [...input.selectedSectionIndices]
		.filter((i) => Number.isInteger(i) && i >= 0)
		.sort((a, b) => a - b);

	const profile = input.model.kind; // 'v12' | 'v4' | 'v6'
	const items: AISectionsBulkItem[] = [];

	if (input.model.kind === 'v12') {
		for (const i of sortedIndices) {
			const section = input.model.sections[i];
			if (!section) continue;
			items.push({ sourceIndex: i, section });
		}
	} else {
		// V4 / V6 share the same `legacy.sections` shape.
		for (const i of sortedIndices) {
			const section = input.model.legacy.sections[i];
			if (!section) continue;
			items.push({ sourceIndex: i, section });
		}
	}

	return {
		kind: 'steward.bulk',
		version: 1,
		resourceKey: RESOURCE_KEY,
		profile,
		exportedAt: new Date().toISOString(),
		items,
		...(input.sourceBundleFilename != null
			? { sourceBundle: input.sourceBundleFilename }
			: {}),
	};
}

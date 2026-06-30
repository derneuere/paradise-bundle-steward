// TriggerData bulk-export pipeline.
//
// Slots between the workspace bulk panel's "Export → clipboard / file…"
// buttons and the resource-agnostic JSON envelope (bulkEnvelope.ts). The
// TriggerData-specific logic — which of the six bulk-eligible lists an entry
// belongs to, how to make each entry JSON-safe — lives here.
//
// Bigint → hex-string wire conversion (load-bearing, non-obvious):
//   SpawnLocation.junkyardId is a CgsID, modeled as a JS `bigint`. The
//   envelope is serialized with `JSON.stringify`, and JSON.stringify THROWS
//   ("Do not know how to serialize a BigInt") the moment it hits a bigint —
//   it has no number type wide enough to carry a 64-bit id losslessly. So on
//   the way out we replace junkyardId with a '0x…' hex string, and the import
//   side rehydrates it with BigInt(str). Among the six bulk lists, ONLY
//   spawnLocations carries a bigint — every other field across landmarks /
//   genericRegions / blackspots / vfxBoxRegions / roamingLocations is a plain
//   number (or nested {x,y,z(,w)} of numbers) and passes through untouched.
//
// Determinism: entries go out in a FIXED listKey order, then by sourceIndex
// ascending, with duplicate (listKey,index) pairs collapsed. The user's click
// sequence in the workspace is irrelevant — sorting here makes the JSON
// byte-stable for the same selection regardless of click order, which matters
// for diffing two exports of "the same selection".

import type {
	ParsedTriggerData,
	Landmark,
	GenericRegion,
	Blackspot,
	VFXBoxRegion,
	SpawnLocation,
	RoamingLocation,
} from '@/lib/core/triggerData';
import type { BulkEnvelope } from './bulkEnvelope';

/** The six TriggerData lists that participate in bulk transfer. Killzones and
 *  signatureStunts are excluded — they hold cross-references (region-id
 *  pointers) that can't be carried entry-by-entry. */
export type TriggerDataBulkListKey =
	| 'landmarks'
	| 'genericRegions'
	| 'blackspots'
	| 'vfxBoxRegions'
	| 'spawnLocations'
	| 'roamingLocations';

/** SpawnLocation as it travels on the wire: junkyardId is a '0x…' hex string
 *  because JSON cannot carry a bigint (see file header). */
export type WireSpawnLocation = Omit<SpawnLocation, 'junkyardId'> & {
	junkyardId: string;
};

export type TriggerBulkEntryWire =
	| Landmark
	| GenericRegion
	| Blackspot
	| VFXBoxRegion
	| WireSpawnLocation
	| RoamingLocation;

export type TriggerDataBulkItem = {
	listKey: TriggerDataBulkListKey;
	/** Source-bundle index of the entry within its list. */
	sourceIndex: number;
	entry: TriggerBulkEntryWire;
};

export type TriggerDataBulkExportInput = {
	model: ParsedTriggerData;
	selectedEntries: ReadonlyArray<{
		listKey: TriggerDataBulkListKey;
		index: number;
	}>;
	sourceBundleFilename?: string;
};

const RESOURCE_KEY = 'triggerData';

// Fixed list ordering — anchors deterministic output (see file header). The
// ranks double as the membership test for "is this a bulk-eligible list".
const LIST_ORDER: TriggerDataBulkListKey[] = [
	'landmarks',
	'genericRegions',
	'blackspots',
	'vfxBoxRegions',
	'spawnLocations',
	'roamingLocations',
];
const LIST_RANK: Record<TriggerDataBulkListKey, number> = {
	landmarks: 0,
	genericRegions: 1,
	blackspots: 2,
	vfxBoxRegions: 3,
	spawnLocations: 4,
	roamingLocations: 5,
};

function toWireEntry(
	listKey: TriggerDataBulkListKey,
	entry: unknown,
): TriggerBulkEntryWire {
	// structuredClone severs aliasing so a later mutation of an exported item
	// can never reach back into the live source model.
	const cloned = structuredClone(entry);
	if (listKey === 'spawnLocations') {
		const spawn = cloned as SpawnLocation;
		const { junkyardId, ...rest } = spawn;
		return { ...rest, junkyardId: '0x' + junkyardId.toString(16) };
	}
	return cloned as TriggerBulkEntryWire;
}

/**
 * Build a JSON envelope from a workspace bulk selection. Entries are emitted
 * in a fixed list order then by ascending index, with duplicates collapsed
 * and out-of-range indices skipped.
 */
export function exportTriggerDataBulk(
	input: TriggerDataBulkExportInput,
): BulkEnvelope<TriggerDataBulkItem> {
	// Dedupe + deterministic sort. Keyed by "listKey:index" so the same entry
	// selected twice (different clicks) collapses to one item.
	const seen = new Set<string>();
	const ordered = [...input.selectedEntries]
		.filter((e) => {
			if (!(e.listKey in LIST_RANK)) return false;
			if (!Number.isInteger(e.index) || e.index < 0) return false;
			const key = `${e.listKey}:${e.index}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort((a, b) => {
			const byList = LIST_RANK[a.listKey] - LIST_RANK[b.listKey];
			return byList !== 0 ? byList : a.index - b.index;
		});

	const items: TriggerDataBulkItem[] = [];
	for (const { listKey, index } of ordered) {
		const list = input.model[listKey];
		const entry = list?.[index];
		if (entry == null) continue;
		items.push({
			listKey,
			sourceIndex: index,
			entry: toWireEntry(listKey, entry),
		});
	}

	return {
		kind: 'steward.bulk',
		version: 1,
		resourceKey: RESOURCE_KEY,
		profile: String(input.model.version),
		exportedAt: new Date().toISOString(),
		items,
		...(input.sourceBundleFilename != null
			? { sourceBundle: input.sourceBundleFilename }
			: {}),
	};
}

// Re-exported so the import side / tests can iterate the canonical order
// without re-declaring it.
export { LIST_ORDER as TRIGGER_BULK_LIST_ORDER };

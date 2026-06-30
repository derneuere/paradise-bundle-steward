// TriggerData bulk-import pipeline.
//
// Merges a decoded BulkEnvelope (from triggerDataBulkExport.ts) into a
// destination ParsedTriggerData. Pure function: same input → same output,
// no clipboard / DOM / network. The mirror image of aiSectionsBulkImport.ts.
//
// Why we assign a FRESH id + regionIndex to every appended box-region
// (landmarks / genericRegions / blackspots / vfxBoxRegions):
//
//   The writer (core/triggerData.ts, writeTriggerDataData) builds the
//   consolidated TriggerRegion offset table by sorting ALL four box-region
//   kinds together on `regionIndex`. If two regions share a regionIndex the
//   table ordering is ambiguous and the bundle's index-keyed lookups
//   (killzone / landmark matching compare index-to-index) break. So every
//   appended region gets a regionIndex strictly above the destination's
//   current max, contiguous and collision-free across all four lists —
//   exactly the dense, unique invariant the writer's sort assumes.
//
//   `id` (mId) is the key killzones and signature stunts dereference. The
//   writer records `genericOffsetsById` and THROWS if a referenced id is
//   missing. We never import killzones/stunts and never touch the
//   destination's, so imported regions are referenced by nobody — but they
//   still must not COLLIDE with an existing id, or a destination killzone
//   that points at the old id could resolve to the wrong (imported) region.
//   Fresh ids above the destination max guarantee no collision.
//
// regionIndex is i16 on disk (writeI16 in the writer). We guard against
// overflow past 32767 with a clear error rather than silently wrapping
// negative — a wrapped index sorts wrong and corrupts the region table.
//
// genericRegion.groupId is PRESERVED verbatim. It is the author's
// intentional grouping (miGroupID — the functional key tying a stunt /
// killzone cluster together at runtime), NOT a remappable offset/index into
// any table. Rewriting it would dissolve the author's grouping.
//
// Recon risk note (the user has CHOSEN auto-reassign+append regardless):
//   - SAVE-GAME / RoadRules cross-resource keys: when groupId == 0, a
//     region's mId is the key into the player save profile (stunt / drive-
//     thru completion) and into the companion RoadRules resource (road-limit
//     validity). Reassigning ids divorces a region from any such prior
//     state. HARMLESS for newly-imported regions: they have no save state in
//     the destination, and any RoadRules entry that would back an imported
//     road-limit region does not exist in the destination's RoadRules — that
//     link is already broken by the import, reassign or not.
//   - This pipeline imports PLAIN trigger regions only — never killzone /
//     signatureStunt wrappers. Were that ever added, the reassigned mId
//     values would have to be propagated into the wrapper's parallel id list
//     (Killzone.regionIds / SignatureStunt linkage); the pointer arrays
//     self-heal on re-serialization, the parallel id lists do NOT.

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
import type {
	TriggerDataBulkItem,
	TriggerDataBulkListKey,
	WireSpawnLocation,
} from './triggerDataBulkExport';

export type TriggerImportMode = 'append' | 'replace';

export type TriggerDataBulkImportInput = {
	envelope: BulkEnvelope<TriggerDataBulkItem>;
	destination: ParsedTriggerData;
	mode: TriggerImportMode;
};

export type TriggerDataBulkImportResult = {
	result: ParsedTriggerData;
	perListCounts: Record<TriggerDataBulkListKey, number>;
	/** Range of box-region mIds actually assigned (inclusive). null when no
	 *  box-region was imported. */
	assignedIdRange: { firstId: number; lastId: number } | null;
	/** Range of box-region regionIndices actually assigned (inclusive). null
	 *  when no box-region was imported. */
	assignedRegionIndexRange: { first: number; last: number } | null;
	/** True when the envelope profile != String(destination.version). Not a
	 *  blocker — TriggerData needs no migration across versions — surfaced as
	 *  a note for the UI. */
	profileMismatch: boolean;
	notes: string[];
};

const RESOURCE_KEY = 'triggerData';

// regionIndex is a signed 16-bit field on disk (writeI16). Past 0x7FFF it
// wraps negative, which sorts wrong in the writer's region table.
const MAX_I16 = 0x7fff;

// The four box-region lists — the ones that carry id + regionIndex and feed
// the consolidated region offset table.
const BOX_REGION_LISTS: TriggerDataBulkListKey[] = [
	'landmarks',
	'genericRegions',
	'blackspots',
	'vfxBoxRegions',
];

/** Largest `id` across the four box-region lists in the working state, or 0
 *  if all four are empty. */
function maxBoxRegionId(td: ParsedTriggerData): number {
	let max = 0;
	for (const lm of td.landmarks) if (lm.id > max) max = lm.id;
	for (const gr of td.genericRegions) if (gr.id > max) max = gr.id;
	for (const bs of td.blackspots) if (bs.id > max) max = bs.id;
	for (const v of td.vfxBoxRegions) if (v.id > max) max = v.id;
	return max;
}

/** Largest `regionIndex` across the four box-region lists in the working
 *  state, or 0 if all four are empty. */
function maxBoxRegionIndex(td: ParsedTriggerData): number {
	let max = 0;
	for (const lm of td.landmarks) if (lm.regionIndex > max) max = lm.regionIndex;
	for (const gr of td.genericRegions) if (gr.regionIndex > max) max = gr.regionIndex;
	for (const bs of td.blackspots) if (bs.regionIndex > max) max = bs.regionIndex;
	for (const v of td.vfxBoxRegions) if (v.regionIndex > max) max = v.regionIndex;
	return max;
}

/** Rehydrate a wire spawn (junkyardId is a '0x…' hex string) back to the
 *  model shape (junkyardId is a bigint CgsID). */
function spawnFromWire(wire: WireSpawnLocation): SpawnLocation {
	const { junkyardId, ...rest } = wire;
	return { ...rest, junkyardId: BigInt(junkyardId) };
}

/**
 * Merge the bulk envelope's items into the destination model.
 *
 * mode 'append' — all six working lists start as copies of the destination's
 * and imported entries are appended.
 *
 * mode 'replace' — only the lists that APPEAR in the envelope items start
 * empty; lists absent from the import are left as copies of the destination's
 * (replacing nothing the user didn't bring data for).
 */
export function importTriggerDataBulk(
	input: TriggerDataBulkImportInput,
): TriggerDataBulkImportResult {
	const { envelope, destination, mode } = input;

	if (envelope.resourceKey !== RESOURCE_KEY) {
		throw new Error(
			`importTriggerDataBulk: wrong resourceKey ${JSON.stringify(envelope.resourceKey)}; expected ${JSON.stringify(RESOURCE_KEY)}.`,
		);
	}

	const notes: string[] = [];
	const profileMismatch = envelope.profile !== String(destination.version);
	if (profileMismatch) {
		notes.push(
			`Source profile ${JSON.stringify(envelope.profile)} differs from destination version ${destination.version}; TriggerData needs no migration, importing as-is.`,
		);
	}

	// For 'replace', a list starts empty only if the import carries entries
	// for it. Lists with no imported entries are left untouched.
	const importedLists = new Set<TriggerDataBulkListKey>(
		envelope.items.map((it) => it.listKey),
	);
	const startEmpty = (key: TriggerDataBulkListKey): boolean =>
		mode === 'replace' && importedLists.has(key);

	// Build the working state. Each of the six bulk-eligible lists gets a NEW
	// array so we never alias the destination's arrays into the result.
	const landmarks: Landmark[] = startEmpty('landmarks')
		? []
		: [...destination.landmarks];
	const genericRegions: GenericRegion[] = startEmpty('genericRegions')
		? []
		: [...destination.genericRegions];
	const blackspots: Blackspot[] = startEmpty('blackspots')
		? []
		: [...destination.blackspots];
	const vfxBoxRegions: VFXBoxRegion[] = startEmpty('vfxBoxRegions')
		? []
		: [...destination.vfxBoxRegions];
	const spawnLocations: SpawnLocation[] = startEmpty('spawnLocations')
		? []
		: [...destination.spawnLocations];
	const roamingLocations: RoamingLocation[] = startEmpty('roamingLocations')
		? []
		: [...destination.roamingLocations];

	// Seed counters from the POST-replace working state so 'replace' that
	// empties a list reclaims those ids/indices, while preserved lists still
	// constrain the floor.
	const working: ParsedTriggerData = {
		...destination,
		landmarks,
		genericRegions,
		blackspots,
		vfxBoxRegions,
		spawnLocations,
		roamingLocations,
	};
	let nextId = maxBoxRegionId(working) + 1;
	let nextRegionIndex = maxBoxRegionIndex(working) + 1;

	const perListCounts: Record<TriggerDataBulkListKey, number> = {
		landmarks: 0,
		genericRegions: 0,
		blackspots: 0,
		vfxBoxRegions: 0,
		spawnLocations: 0,
		roamingLocations: 0,
	};

	let firstAssignedId: number | null = null;
	let lastAssignedId: number | null = null;
	let firstAssignedRegionIndex: number | null = null;
	let lastAssignedRegionIndex: number | null = null;

	const assignBoxRegion = <T extends { id: number; regionIndex: number }>(
		entry: T,
	): T => {
		if (nextRegionIndex > MAX_I16) {
			throw new Error(
				'TriggerData regionIndex would overflow i16 (32767); destination has too many regions to append.',
			);
		}
		entry.id = nextId;
		entry.regionIndex = nextRegionIndex;
		if (firstAssignedId === null) firstAssignedId = nextId;
		lastAssignedId = nextId;
		if (firstAssignedRegionIndex === null) firstAssignedRegionIndex = nextRegionIndex;
		lastAssignedRegionIndex = nextRegionIndex;
		nextId++;
		nextRegionIndex++;
		return entry;
	};

	for (const item of envelope.items) {
		// structuredClone severs aliasing so the imported entry can never reach
		// back into the source workspace's model after import.
		const cloned = structuredClone(item.entry);
		switch (item.listKey) {
			case 'spawnLocations':
				spawnLocations.push(spawnFromWire(cloned as WireSpawnLocation));
				break;
			case 'roamingLocations':
				roamingLocations.push(cloned as RoamingLocation);
				break;
			case 'landmarks':
				landmarks.push(assignBoxRegion(cloned as Landmark));
				break;
			case 'genericRegions':
				// groupId preserved verbatim (author's grouping, not an offset).
				genericRegions.push(assignBoxRegion(cloned as GenericRegion));
				break;
			case 'blackspots':
				blackspots.push(assignBoxRegion(cloned as Blackspot));
				break;
			case 'vfxBoxRegions':
				vfxBoxRegions.push(assignBoxRegion(cloned as VFXBoxRegion));
				break;
		}
		perListCounts[item.listKey]++;
	}

	if (perListCounts.landmarks > 0) {
		// Appended landmarks are OFFLINE by default — onlineLandmarkCount keys
		// the leading slice of the landmark table that is exposed online, and
		// appended entries go to the tail, so the count stays as the
		// destination's.
		notes.push(
			'Appended landmarks are offline by default; onlineLandmarkCount left unchanged.',
		);
	}

	const result: ParsedTriggerData = working;

	return {
		result,
		perListCounts,
		assignedIdRange:
			firstAssignedId !== null && lastAssignedId !== null
				? { firstId: firstAssignedId, lastId: lastAssignedId }
				: null,
		assignedRegionIndexRange:
			firstAssignedRegionIndex !== null && lastAssignedRegionIndex !== null
				? { first: firstAssignedRegionIndex, last: lastAssignedRegionIndex }
				: null,
		profileMismatch,
		notes,
	};
}

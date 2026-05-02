// Conversion provenance — workspace metadata recording what each
// "Export to game version..." migration did to the resources it touched.
//
// Why a separate module: the UI banner (issue #38) needs to show, per
// resource, "we converted this from V4 to V12; these fields got default
// values, these got semantically remapped guesses." The migration runner
// in `src/lib/conversion/exportPlan.ts` already returns that data per
// run. This module is the side-channel store that lets the banner read
// it later, keyed by (bundleId, resourceKey, index).
//
// Why option 2 (workspace metadata) rather than option 1 (a leading-
// underscore field on the parsed model — see issue #38 for the design
// note): the parsed model is a binary-faithful mirror of the bytes. The
// "leading-underscore-survives-write" trick the writer uses is fragile
// and confined to one writer; future writers could lose it silently.
// Keeping provenance in workspace metadata also means ⌘Z'ing an unrelated
// edit doesn't accidentally restore stale provenance.
//
// Persistence: in-memory only for now. Bundle-persistence (sidecar JSON
// or similar) doesn't exist yet — when it lands, this module's exported
// shape can be serialised to/from the sidecar without changing callers.

import type { BundleId } from './WorkspaceContext.types';

/**
 * Compound key uniquely identifying a (bundle, resource type, instance)
 * triple within a single Workspace session. Stored as a string so it can
 * be a Map key — `Map<{...}, V>` would compare by reference.
 */
export type ProvenanceKey = string;

export function provenanceKey(
	bundleId: BundleId,
	resourceKey: string,
	index: number,
): ProvenanceKey {
	return `${bundleId}::${resourceKey}::${index}`;
}

/**
 * One migration's record. Mirrors `ConversionResult` plus the source/
 * target kinds and the timestamp the export ran. The field-path lists are
 * verbatim copies of what the migration emitted — the banner does not
 * post-process them.
 */
export type ConversionProvenance = {
	sourceKind: string;
	targetKind: string;
	/** Field paths that the migration filled with sensible defaults. Quiet
	 *  informational tone in the banner — "we did this without losing
	 *  information." */
	defaulted: string[];
	/** Field paths whose source values were dropped or semantically
	 *  remapped (a guess). Attention-grabbing tone in the banner — "review
	 *  these." */
	lossy: string[];
	/** Wall-clock timestamp the export completed. Surfaced in the banner
	 *  for users juggling several conversions in one session. */
	exportedAt: number;
};

/**
 * Per-resource entry in the workspace's provenance map. The dismissal
 * flag is a UI concern but lives here because dismissal is bound to the
 * provenance entry's lifetime — a fresh export overwrites the entry
 * (clearing dismissal), and clearing the entry should clear dismissal.
 */
export type ProvenanceEntry = ConversionProvenance & {
	dismissed: boolean;
};

export type ProvenanceMap = ReadonlyMap<ProvenanceKey, ProvenanceEntry>;

/**
 * Record one migration's provenance into a map, returning a fresh map.
 * A fresh export always clears any prior `dismissed` flag — the user is
 * being told about a *new* conversion, even if the old one happened to
 * touch the same resource.
 */
export function recordProvenance(
	map: ProvenanceMap,
	bundleId: BundleId,
	resourceKey: string,
	index: number,
	provenance: ConversionProvenance,
): Map<ProvenanceKey, ProvenanceEntry> {
	const next = new Map(map);
	next.set(provenanceKey(bundleId, resourceKey, index), {
		...provenance,
		dismissed: false,
	});
	return next;
}

/**
 * Mark one resource's banner dismissed. If the entry doesn't exist the
 * map is returned unchanged — there's nothing to dismiss.
 */
export function dismissProvenance(
	map: ProvenanceMap,
	bundleId: BundleId,
	resourceKey: string,
	index: number,
): Map<ProvenanceKey, ProvenanceEntry> {
	const key = provenanceKey(bundleId, resourceKey, index);
	const existing = map.get(key);
	if (!existing || existing.dismissed) return new Map(map);
	const next = new Map(map);
	next.set(key, { ...existing, dismissed: true });
	return next;
}

/**
 * Look up the provenance entry for a specific (bundle, resource, index)
 * triple. Returns null when no entry exists OR when the entry has been
 * dismissed — both states should hide the banner. Callers that need to
 * distinguish "no provenance" from "dismissed" should consult the map
 * directly via `provenanceKey`.
 */
export function getActiveProvenance(
	map: ProvenanceMap,
	bundleId: BundleId,
	resourceKey: string,
	index: number,
): ConversionProvenance | null {
	const entry = map.get(provenanceKey(bundleId, resourceKey, index));
	if (!entry || entry.dismissed) return null;
	const { dismissed: _dismissed, ...rest } = entry;
	void _dismissed;
	return rest;
}

/**
 * Drop every provenance entry that referenced a Bundle that no longer
 * exists. Used by close / replace, mirroring `dropHistoryForBundle`.
 *
 * Map identity is preserved when no entries match so a no-op prune
 * doesn't churn React state.
 */
export function dropProvenanceForBundle(
	map: ProvenanceMap,
	bundleId: BundleId,
): Map<ProvenanceKey, ProvenanceEntry> {
	const prefix = `${bundleId}::`;
	let dropped = 0;
	const next = new Map<ProvenanceKey, ProvenanceEntry>();
	for (const [key, value] of map) {
		if (key.startsWith(prefix)) {
			dropped++;
			continue;
		}
		next.set(key, value);
	}
	if (dropped === 0) return new Map(map);
	return next;
}

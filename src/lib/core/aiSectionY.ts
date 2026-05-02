// AI Section vertical placement (issue #27).
//
// AI Sections store XY corners only — they're 2D polygons describing the
// floor plan of a chunk of road on the XZ plane. The Y axis (height) is
// implicit and never persisted. For rendering inside the WorldViewport
// alongside WORLDCOL terrain we need a sensible Y per section so the polygon
// sits on (or near) the actual ground rather than at Y=0 — the "0" floor of
// Paradise City is buried under hills and floats high over valleys.
//
// Two information sources we can use without WORLDCOL collision data loaded:
//
//   1. Each `Portal.position` is a Vector3 (V12) / Vector4 (V4/V6) anchor
//      at an edge midpoint with a real-world Y. Portals describe AI
//      connections and are placed by the original level designers, so their
//      Y is essentially a sample of the ground at that section's edges.
//
//   2. Sections without portals (rare; usually termini) can borrow Y from
//      whichever neighbour they connect to via the section graph
//      (`linkSection` indices). One BFS pass propagates known Ys outward
//      until every reachable section has a value.
//
// Anything left unresolved (an isolated section with no portals AND no
// portal-linked neighbours) falls back to 0 — same behaviour as before #27.
//
// Pure module: no React, no THREE. The overlay turns the resolver output
// into a per-section Y array once per data change and reads from it inside
// `buildBatchedSections`. WORLDCOL raycast is deferred — see issue #27.

import type {
	AISection,
	LegacyAISection,
	ParsedAISectionsV12,
	LegacyAISectionsData,
} from './aiSections';

// =============================================================================
// V12 — section graph + per-section portal Y
// =============================================================================

/**
 * Mean Y of a section's portal anchors, or `null` when the section has no
 * portals to sample. Each portal sits on an edge midpoint with a designer-
 * placed world Y, so averaging them gives a reasonable single Y for the
 * section's floor — junction-type sections with portals at varying heights
 * land at the average, which beats picking an arbitrary one.
 */
export function meanPortalY(section: AISection): number | null {
	if (section.portals.length === 0) return null;
	let sum = 0;
	for (const p of section.portals) sum += p.position.y;
	return sum / section.portals.length;
}

/**
 * Resolve a per-section Y for every section in the model. Two passes:
 *
 *   1. Seed: every section with at least one portal gets `meanPortalY(s)`.
 *   2. Propagate: walk the inbound-link map. Any section that didn't seed
 *      picks up the mean of every already-resolved section that points at
 *      it via `linkSection`, repeated until no new sections resolve.
 *
 * The propagation uses the *inbound* edges (sections whose portals link
 * INTO the unresolved one), not outbound — a portal-less section has no
 * outbound edges of its own to walk, but its neighbours may still link
 * back into it.
 *
 * Sections that are still unresolved after propagation terminates (an
 * isolated component with no portal anywhere on it) land at the supplied
 * `fallback` (defaults to 0 — matches pre-#27 rendering).
 *
 * Returned Float32Array is parallel to `model.sections` — `result[i]` is the
 * Y to use when rendering section `i`. Cheap to compute once per data change
 * (~O(numSections + numPortals)) and trivial to memoise.
 */
export function resolveSectionYs(
	model: ParsedAISectionsV12,
	fallback: number = 0,
): Float32Array {
	const N = model.sections.length;
	const out = new Float32Array(N);
	const resolved = new Uint8Array(N);

	// Build the inbound-link adjacency once: `inbound[i]` is the list of
	// section indices whose portals point AT i. The portal-less side of an
	// AI connection (rare, but happens at terminator sections) has no
	// outbound edges of its own to walk; we still need to reach it via the
	// portals on its neighbours pointing inward.
	const inbound: number[][] = new Array(N);
	for (let i = 0; i < N; i++) inbound[i] = [];
	for (let i = 0; i < N; i++) {
		for (const p of model.sections[i].portals) {
			const nb = p.linkSection;
			if (nb >= 0 && nb < N && nb !== i) inbound[nb].push(i);
		}
	}

	// Seed pass.
	for (let i = 0; i < N; i++) {
		const y = meanPortalY(model.sections[i]);
		if (y !== null) {
			out[i] = y;
			resolved[i] = 1;
		}
	}

	// Propagation pass — fixed-point iteration over the inbound edges.
	// Each iteration tries to resolve every still-unresolved section by
	// averaging its inbound resolved neighbours' Y values. We stop when an
	// iteration resolves nothing new. With N sections the loop runs at
	// most O(diameter) times, so an explicit termination check beats a
	// frontier-queue here (the queue would also work — both are linear in
	// total edges visited).
	let progressed = true;
	while (progressed) {
		progressed = false;
		for (let i = 0; i < N; i++) {
			if (resolved[i]) continue;
			const ins = inbound[i];
			if (ins.length === 0) continue;
			let sum = 0;
			let count = 0;
			for (const src of ins) {
				if (resolved[src]) {
					sum += out[src];
					count++;
				}
			}
			if (count > 0) {
				out[i] = sum / count;
				resolved[i] = 1;
				progressed = true;
			}
		}
	}

	// Anything still unresolved falls back. Float32Array zero-inits, so
	// the `fallback === 0` case needs no extra work.
	if (fallback !== 0) {
		for (let i = 0; i < N; i++) {
			if (!resolved[i]) out[i] = fallback;
		}
	}
	return out;
}

// =============================================================================
// Legacy V4/V6 — same algorithm against the parallel-array storage
// =============================================================================

/**
 * Mean Y of a legacy section's portal anchors. Legacy portals carry the
 * height in `midPosition.y` (Vector4 with the W lane being structural
 * padding). Returns null when the section has no portals to sample.
 */
export function meanLegacyPortalY(section: LegacyAISection): number | null {
	if (section.portals.length === 0) return null;
	let sum = 0;
	for (const p of section.portals) sum += p.midPosition.y;
	return sum / section.portals.length;
}

/**
 * Legacy V4/V6 sibling of {@link resolveSectionYs}. Same two-pass seed +
 * BFS-propagation algorithm, just sourcing portal Ys from `midPosition.y`
 * (Vector4 with the W lane as structural padding) instead of V12's
 * `position.y` (Vector3).
 */
export function resolveLegacySectionYs(
	model: LegacyAISectionsData,
	fallback: number = 0,
): Float32Array {
	const N = model.sections.length;
	const out = new Float32Array(N);
	const resolved = new Uint8Array(N);

	const inbound: number[][] = new Array(N);
	for (let i = 0; i < N; i++) inbound[i] = [];
	for (let i = 0; i < N; i++) {
		for (const p of model.sections[i].portals) {
			const nb = p.linkSection;
			if (nb >= 0 && nb < N && nb !== i) inbound[nb].push(i);
		}
	}

	for (let i = 0; i < N; i++) {
		const y = meanLegacyPortalY(model.sections[i]);
		if (y !== null) {
			out[i] = y;
			resolved[i] = 1;
		}
	}

	let progressed = true;
	while (progressed) {
		progressed = false;
		for (let i = 0; i < N; i++) {
			if (resolved[i]) continue;
			const ins = inbound[i];
			if (ins.length === 0) continue;
			let sum = 0;
			let count = 0;
			for (const src of ins) {
				if (resolved[src]) {
					sum += out[src];
					count++;
				}
			}
			if (count > 0) {
				out[i] = sum / count;
				resolved[i] = 1;
				progressed = true;
			}
		}
	}

	if (fallback !== 0) {
		for (let i = 0; i < N; i++) {
			if (!resolved[i]) out[i] = fallback;
		}
	}
	return out;
}

// **Cascade** for AI sections — the only expansion of its kind in the editor.
//
// Cascade lives ABOVE `transform()` because it changes the REF LIST, not the
// maths: "the gizmo moves what you selected; the modifier extends to connected
// geometry" (ADR-0009). The overlay calls this against the PRE-GESTURE model,
// hands the widened list to `transform()`, and everything downstream — pivot,
// dedupe, compose order, reference identity — is unchanged.
//
// Exactly ONE hop. Chasing a neighbour's other portals does not terminate on
// cyclic neighbour graphs, and deciding which of N's corners are shared with
// N's OTHER neighbours has no good answer; two-hop drift is the user's call to
// fix. Cascades INTO another Selection member are skipped: that member already
// moves under its own ref, and cascading would move it twice.
//
// Two behaviour changes fall out of doing this as ref expansion rather than as
// a bespoke op, and both are deliberate:
//
//   * cascade no longer drops `dy`. The old `translateSectionWithLinks` had no
//     `dy` parameter at all, so a cascade-on vertical drag left mirror portals
//     behind at the old height. They now follow.
//   * cascaded slots orbit the SHARED pivot rather than the source section's
//     own corner centroid. For a single cascaded section those differ, because
//     the shared pivot is the median over corners *and* portals.

import type { AISection, ParsedAISectionsV12, Portal } from '../../aiSections';
import { aiSectionRefKey, type AISectionRef } from './aiSections';

/** Coincidence tolerance for mirror-portal and shared-corner matching. Portal
 *  pairs are authored at one shared world coordinate, so anything beyond a
 *  float-noise epsilon is a different join. */
const POSITION_EPS = 1e-3;

const approx = (a: number, b: number) => Math.abs(a - b) < POSITION_EPS;

/**
 * Find the neighbour's REVERSE portal for `srcPortal`: the one pointing back
 * at `srcIdx` whose pre-gesture anchor is coincident with the source anchor.
 * Both tests matter — a pair of sections can be joined through two separate
 * edges, and `linkSection` alone would pick the wrong one.
 */
function findMirrorPortal(target: AISection, srcIdx: number, srcPortal: Portal): number {
	return target.portals.findIndex(
		(p) =>
			p.linkSection === srcIdx &&
			approx(p.position.x, srcPortal.position.x) &&
			approx(p.position.y, srcPortal.position.y) &&
			approx(p.position.z, srcPortal.position.z),
	);
}

/**
 * Widen a Selection with its one-hop cascade partners.
 *
 * For every whole-section ref in `refs`, and every portal on that section
 * pointing at a section OUTSIDE the Selection:
 *
 *   * the neighbour's matching reverse portal joins the Selection — anchor and
 *     both endpoints of each of its boundary lines, so the pair stays welded
 *     under a rotate as well as a translate;
 *   * every neighbour corner coincident with one of the source portal's
 *     boundary-line endpoints joins too, so the shared edge travels while the
 *     neighbour's other edges (and the joins through them) stay put.
 *
 * Sub-entity refs cascade to nothing: a lone corner or portal anchor drag is
 * the "tear it off the join" gesture, which is what makes fixing a bad weld
 * possible at all.
 *
 * Returns the input array by reference when nothing cascaded, so the caller's
 * memo chain does not churn on every drag frame.
 */
export function expandAISectionsCascade(
	model: ParsedAISectionsV12,
	refs: readonly AISectionRef[],
): readonly AISectionRef[] {
	const selectedSections = new Set<number>();
	for (const ref of refs) {
		if (ref.kind === 'section') selectedSections.add(ref.sectionIdx);
	}
	if (selectedSections.size === 0) return refs;

	const seen = new Set<string>();
	for (const ref of refs) seen.add(aiSectionRefKey(ref));
	const added: AISectionRef[] = [];
	const push = (ref: AISectionRef) => {
		const k = aiSectionRefKey(ref);
		if (seen.has(k)) return;
		seen.add(k);
		added.push(ref);
	};

	for (const srcIdx of selectedSections) {
		const src = model.sections[srcIdx];
		if (!src) continue;
		for (const srcPortal of src.portals) {
			const targetIdx = srcPortal.linkSection;
			if (targetIdx === srcIdx) continue;
			if (targetIdx < 0 || targetIdx >= model.sections.length) continue;
			if (selectedSections.has(targetIdx)) continue;
			const target = model.sections[targetIdx];

			const mirrorIdx = findMirrorPortal(target, srcIdx, srcPortal);
			if (mirrorIdx >= 0) {
				push({ kind: 'portal', sectionIdx: targetIdx, portalIdx: mirrorIdx });
				const mirrorLines = target.portals[mirrorIdx].boundaryLines;
				for (let lineIdx = 0; lineIdx < mirrorLines.length; lineIdx++) {
					push({ kind: 'boundaryLineEndpoint', sectionIdx: targetIdx, portalIdx: mirrorIdx, lineIdx, end: 0 });
					push({ kind: 'boundaryLineEndpoint', sectionIdx: targetIdx, portalIdx: mirrorIdx, lineIdx, end: 1 });
				}
			}

			// Shared corners are identified on PRE-gesture geometry: the source
			// portal's boundary-line endpoints are the shared edge, so any
			// neighbour corner sitting on one of them belongs to the join.
			for (let cornerIdx = 0; cornerIdx < target.corners.length; cornerIdx++) {
				const c = target.corners[cornerIdx];
				const onSharedEdge = srcPortal.boundaryLines.some(
					(bl) =>
						(approx(c.x, bl.verts.x) && approx(c.y, bl.verts.y)) ||
						(approx(c.x, bl.verts.z) && approx(c.y, bl.verts.w)),
				);
				if (onSharedEdge) push({ kind: 'corner', sectionIdx: targetIdx, cornerIdx });
			}
		}
	}

	if (added.length === 0) return refs;
	return [...refs, ...added];
}

// Bulk-transform: multi-Selection rigid translate + yaw rotate (issue #74)
// plus the cascade-on multi-section variants (issue #75).
//
// Cardinality ≥ 2 entry points for the unified Bulk-transform gizmo. The
// single-entity siblings live in `translateRigid.ts` (no cascade) and
// `translateLinks.ts` (cascade-on); these ops compose the same per-section
// fix-ups across an arbitrary refs list.
//
// Rigid-body interpretation (load-bearing): every spatial coordinate in
// every selected entity orbits the single bulk pivot. See CONTEXT.md /
// "Bulk transform" + "Pivot" and ADR-0009 / ADR-0010 / ADR-0011 for the
// design constraints. The discriminated `AISectionEntityRef` union below is
// the carrier the caller passes; sub-entity refs leave the rest of their
// section structurally identical.

import type {
	AISection,
	ParsedAISectionsV12,
} from '../aiSections';
import { applyLinkFixUp, applyRotateLinkFixUp } from './translateLinks';

// =============================================================================
// Bulk-transform: cascade-on multi-Selection (issue #75)
// =============================================================================

/**
 * Cascade-on translate of a multi-section **Selection** by an XZ offset.
 * Layered on top of {@link translateSectionWithLinks}: each selected section
 * is translated with the one-hop cascade rule, but cascades INTO other
 * Selection members are skipped — the inside of the Selection moves as one
 * rigid body, and only OUTSIDE neighbours get their reverse portals + shared
 * corners dragged along (per the issue #75 acceptance criterion "cascade
 * applied to every Selection-boundary portal/corner").
 *
 * Why we can't just call `translateSectionWithLinks` per member: cascading
 * into another Selection member would double-translate that member (once by
 * its own gizmo translate, once by the cascade from the previous member).
 * The inside-Selection cascade is also redundant — both members move by the
 * same delta, so their shared boundary stays coincident either way.
 *
 * Algorithm:
 *   1. Build a set of cascade-target indices = the Selection's complement,
 *      restricted to neighbours of any Selection member.
 *   2. For each Selection member: apply the rigid translate to the source,
 *      then for each of its portals pointing at a target NOT in the
 *      Selection, apply the same one-hop fix-up `applyLinkFixUp` uses
 *      (translate the reverse portal + shared corners).
 *   3. Selection-internal portals get their `position` and `boundaryLines`
 *      translated as part of the rigid move on the source side; the matching
 *      reverse portal on the OTHER Selection member is similarly translated
 *      by its own pass, so the pair stays coherent without explicit cascade.
 *
 * Returns the original `model` reference when `(dx, dz) === (0, 0)` so
 * byte-for-byte BND2 writeback is preserved on a no-op gesture.
 *
 * Layered on top of issue #74's bulk path — when #74 lands and the bulk
 * Selection has its own carrier, this op consumes the same `readonly
 * number[]` of section indices. Today's caller is issue #75's cascade-on
 * path for single-section selections too (selectedIndices = [i]); behaviour
 * matches `translateSectionWithLinks` exactly in that single-member case.
 *
 * @throws RangeError if any index in `selectedIndices` is out of range.
 */
export function translateSelectionWithLinks(
	model: ParsedAISectionsV12,
	selectedIndices: readonly number[],
	offset: { x: number; z: number },
): ParsedAISectionsV12 {
	if (selectedIndices.length === 0) return model;
	for (const idx of selectedIndices) {
		if (idx < 0 || idx >= model.sections.length) {
			throw new RangeError(`section index ${idx} out of range [0, ${model.sections.length})`);
		}
	}
	if (offset.x === 0 && offset.z === 0) return model;

	const dx = offset.x;
	const dz = offset.z;
	const selectedSet = new Set<number>(selectedIndices);

	// Per-section update accumulator (same shape as the single-section op).
	const updates = new Map<number, AISection>();

	// Pass 1 — rigid-translate every selected section. This is the "inside
	// the Selection moves as one block" pass; outside cascade lands in pass 2.
	for (const idx of selectedSet) {
		const src = model.sections[idx];
		const srcTranslated: AISection = {
			...src,
			corners: src.corners.map((c) => ({ x: c.x + dx, y: c.y + dz })),
			portals: src.portals.map((p) => ({
				...p,
				position: { x: p.position.x + dx, y: p.position.y, z: p.position.z + dz },
				boundaryLines: p.boundaryLines.map((bl) => ({
					verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
				})),
			})),
			noGoLines: src.noGoLines.map((bl) => ({
				verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
			})),
		};
		updates.set(idx, srcTranslated);
	}

	// Pass 2 — cascade into outside neighbours. We walk every Selection
	// member's ORIGINAL portals (not the post-translate ones — `oldSrcPortal`
	// in `applyLinkFixUp` references pre-translate positions for the lookup
	// of coincident reverse portals + shared corners).
	for (const idx of selectedSet) {
		const src = model.sections[idx];
		for (const oldPortal of src.portals) {
			const targetIdx = oldPortal.linkSection;
			if (targetIdx === idx) continue;
			if (targetIdx < 0 || targetIdx >= model.sections.length) continue;
			// Skip cascades INTO another Selection member — that member's
			// rigid translate from pass 1 already covers the shared edge.
			if (selectedSet.has(targetIdx)) continue;

			const current = updates.get(targetIdx) ?? model.sections[targetIdx];
			const fixed = applyLinkFixUp(current, idx, oldPortal, dx, dz);
			if (fixed !== current) updates.set(targetIdx, fixed);
		}
	}

	const sections = model.sections.map((s, i) => updates.get(i) ?? s);
	return { ...model, sections };
}

/**
 * Cascade-on yaw rotate of a multi-section **Selection** by `theta` radians
 * around `pivot` (the Selection's median XZ, per CONTEXT.md / "Pivot"). The
 * yaw-axis sibling of {@link translateSelectionWithLinks}: every selected
 * section rotates as a rigid body around the shared pivot, and for any
 * portal on a Selection member pointing OUTSIDE the Selection, the reverse
 * portal + shared corners on the outside neighbour rotate around the same
 * pivot. Selection-internal portals are covered by the rigid-pass on both
 * member sides — they move together so their shared edge stays coincident.
 *
 * Returns the original `model` reference when `theta === 0` so byte-for-byte
 * BND2 writeback is preserved on a no-op gesture.
 *
 * @throws RangeError if any index in `selectedIndices` is out of range.
 */
export function rotateSelectionWithLinksYaw(
	model: ParsedAISectionsV12,
	selectedIndices: readonly number[],
	pivot: { x: number; z: number },
	theta: number,
): ParsedAISectionsV12 {
	if (selectedIndices.length === 0) return model;
	for (const idx of selectedIndices) {
		if (idx < 0 || idx >= model.sections.length) {
			throw new RangeError(`section index ${idx} out of range [0, ${model.sections.length})`);
		}
	}
	if (theta === 0) return model;

	const cx = pivot.x;
	const cz = pivot.z;
	const cosT = Math.cos(theta);
	const sinT = Math.sin(theta);
	const rotXZ = (x: number, z: number): { x: number; z: number } => {
		const ox = x - cx;
		const oz = z - cz;
		return {
			x: ox * cosT - oz * sinT + cx,
			z: ox * sinT + oz * cosT + cz,
		};
	};

	const selectedSet = new Set<number>(selectedIndices);
	const updates = new Map<number, AISection>();

	// Pass 1 — rigid yaw rotate of every Selection member around the
	// shared pivot. All members spin lockstep so their relative geometry
	// is preserved.
	for (const idx of selectedSet) {
		const src = model.sections[idx];
		updates.set(idx, {
			...src,
			corners: src.corners.map((c) => {
				const r = rotXZ(c.x, c.y);
				return { x: r.x, y: r.z };
			}),
			portals: src.portals.map((p) => {
				const rPos = rotXZ(p.position.x, p.position.z);
				return {
					...p,
					position: { x: rPos.x, y: p.position.y, z: rPos.z },
					boundaryLines: p.boundaryLines.map((bl) => {
						const rStart = rotXZ(bl.verts.x, bl.verts.y);
						const rEnd = rotXZ(bl.verts.z, bl.verts.w);
						return { verts: { x: rStart.x, y: rStart.z, z: rEnd.x, w: rEnd.z } };
					}),
				};
			}),
			noGoLines: src.noGoLines.map((bl) => {
				const rStart = rotXZ(bl.verts.x, bl.verts.y);
				const rEnd = rotXZ(bl.verts.z, bl.verts.w);
				return { verts: { x: rStart.x, y: rStart.z, z: rEnd.x, w: rEnd.z } };
			}),
		});
	}

	// Pass 2 — cascade into outside neighbours via per-member portals
	// pointing OUTSIDE the Selection. Same shape as the single-section
	// rotate cascade, just iterated over the Selection.
	for (const idx of selectedSet) {
		const src = model.sections[idx];
		for (const oldPortal of src.portals) {
			const targetIdx = oldPortal.linkSection;
			if (targetIdx === idx) continue;
			if (targetIdx < 0 || targetIdx >= model.sections.length) continue;
			if (selectedSet.has(targetIdx)) continue;

			const current = updates.get(targetIdx) ?? model.sections[targetIdx];
			const fixed = applyRotateLinkFixUp(current, idx, oldPortal, rotXZ);
			if (fixed !== current) updates.set(targetIdx, fixed);
		}
	}

	const sections = model.sections.map((s, i) => updates.get(i) ?? s);
	return { ...model, sections };
}


// =============================================================================
// Bulk-transform: multi-Selection rigid translate + yaw rotate
// =============================================================================
//
// The multi-Selection slice of **Bulk transform** (issue #74, CONTEXT.md /
// "Bulk transform", ADR-0009 / ADR-0010 / ADR-0011) lets the marquee pick
// several whole AI sections (and/or sub-entities like portals and line
// endpoints under the inspector) and treats the whole bunch as one rigid
// body. The single-entity ops above (`translateSectionRigid`,
// `rotateSectionAroundCentroidYaw`) handle cardinality 1; the bulk ops
// below handle cardinality ≥ 2.
//
// Entity references are a discriminated union — a flat list of "which
// spatial thing in the model to move." A whole-section ref pulls the
// section's entire corners + portal anchors + portal-BL endpoints + no-go
// endpoints through the transform. Sub-entity refs (portal anchor, boundary
// line endpoint, no-go line endpoint) move only the single spatial datum
// they address; the surrounding section is otherwise untouched.
//
// Rigid-body interpretation (load-bearing): every spatial coordinate in
// every selected entity orbits the single bulk pivot. We do NOT treat each
// whole-section as having an independent centre — the bulk is one rigid
// body, period. This preserves relative distances within the bulk
// (acceptance criterion: "yaw-rotating the bulk rotates every selected
// entity around the pivot as a rigid body — each section's relative
// geometry preserved"). Letting each section spin around its own centre
// would translate sections without rotating their geometry, breaking the
// rigid-body invariant on inter-section distances.
//
// No cascade (ADR-0009): the only things that move are the entities
// explicitly named in the refs list. Outside neighbours of any selected
// section stay completely put — their reverse-portal anchors will be left
// "stale" relative to the moved portals, which is the documented v1
// trade-off.

/** Discriminated reference to a single spatial datum inside a V12 AI sections
 *  model. The multi-Selection bulk transform takes an array of these. */
export type AISectionEntityRef =
	/** The whole section — corners, portal positions, portal BL endpoints,
	 *  and no-go line endpoints all move together. */
	| { kind: 'section'; sectionIdx: number }
	/** A single portal's 3D anchor (`position`). Portal boundary lines and
	 *  the parent section's corners stay put. */
	| { kind: 'portal'; sectionIdx: number; portalIdx: number }
	/** One endpoint (start or end) of a portal's boundary line. `end = 0`
	 *  addresses `(verts.x, verts.y)`; `end = 1` addresses `(verts.z, verts.w)`. */
	| { kind: 'boundaryLineEndpoint'; sectionIdx: number; portalIdx: number; lineIdx: number; end: 0 | 1 }
	/** One endpoint (start or end) of a no-go line, indexed the same as boundary lines. */
	| { kind: 'noGoLineEndpoint'; sectionIdx: number; lineIdx: number; end: 0 | 1 };

/**
 * Median (per-component) of every spatial point the bulk Selection
 * addresses. The result is in display coordinates — `{x, y, z}` where
 * `y` is the editor's vertical (yaw axis).
 *
 * - Whole sections contribute every corner (`(x, sectionY, z)` — corners
 *   are XZ-packed Vector2 so we read the section's Y from the supplied
 *   `sectionY` resolver) plus every portal position.
 * - Portal refs contribute the portal position.
 * - Boundary/no-go line endpoint refs contribute the endpoint at
 *   `(x, sectionY, z)`.
 *
 * Median (not centroid) so a tight cluster + a few outliers anchors near
 * the cluster — matches the spec's "median of all selected positions"
 * (CONTEXT.md / "Pivot"). Returns `null` when the refs list is empty or
 * every ref points at an out-of-range entity.
 */
export function bulkSelectionPivot(
	model: ParsedAISectionsV12,
	refs: readonly AISectionEntityRef[],
	sectionY: (sectionIdx: number) => number,
): { x: number; y: number; z: number } | null {
	const xs: number[] = [];
	const ys: number[] = [];
	const zs: number[] = [];
	for (const ref of refs) {
		const sec = model.sections[ref.sectionIdx];
		if (!sec) continue;
		const y = sectionY(ref.sectionIdx);
		if (ref.kind === 'section') {
			for (const c of sec.corners) {
				xs.push(c.x); ys.push(y); zs.push(c.y);
			}
			for (const p of sec.portals) {
				xs.push(p.position.x); ys.push(p.position.y); zs.push(p.position.z);
			}
			continue;
		}
		if (ref.kind === 'portal') {
			const p = sec.portals[ref.portalIdx];
			if (!p) continue;
			xs.push(p.position.x); ys.push(p.position.y); zs.push(p.position.z);
			continue;
		}
		if (ref.kind === 'boundaryLineEndpoint') {
			const p = sec.portals[ref.portalIdx];
			const bl = p?.boundaryLines[ref.lineIdx];
			if (!bl) continue;
			if (ref.end === 0) { xs.push(bl.verts.x); ys.push(y); zs.push(bl.verts.y); }
			else { xs.push(bl.verts.z); ys.push(y); zs.push(bl.verts.w); }
			continue;
		}
		if (ref.kind === 'noGoLineEndpoint') {
			const bl = sec.noGoLines[ref.lineIdx];
			if (!bl) continue;
			if (ref.end === 0) { xs.push(bl.verts.x); ys.push(y); zs.push(bl.verts.y); }
			else { xs.push(bl.verts.z); ys.push(y); zs.push(bl.verts.w); }
			continue;
		}
	}
	if (xs.length === 0) return null;
	return { x: median(xs), y: median(ys), z: median(zs) };
}

function median(values: number[]): number {
	const sorted = values.slice().sort((a, b) => a - b);
	const n = sorted.length;
	if (n === 0) return 0;
	const mid = n >> 1;
	return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Group refs by section index so we build each updated section in one pass.
// Multiple sub-entity refs into the same section share a bucket and are
// applied together; sections with no refs of any kind keep their original
// reference (the section-by-section map below returns `sec` untouched).
type SectionRefBucket = {
	wholeSection: boolean;
	portalIdxs: Set<number>;
	/** Bitmask: 1 = start endpoint selected, 2 = end endpoint selected, 3 = both.
	 *  Keyed by `${portalIdx}/${lineIdx}` so a (portalIdx, lineIdx, end) triple
	 *  collapses to one bucket entry. */
	blEndpoints: Map<string, number>;
	noGoEndpoints: Map<number, number>;
};

function bucketRefs(refs: readonly AISectionEntityRef[]): Map<number, SectionRefBucket> {
	const map = new Map<number, SectionRefBucket>();
	for (const ref of refs) {
		let bucket = map.get(ref.sectionIdx);
		if (!bucket) {
			bucket = {
				wholeSection: false,
				portalIdxs: new Set(),
				blEndpoints: new Map(),
				noGoEndpoints: new Map(),
			};
			map.set(ref.sectionIdx, bucket);
		}
		if (ref.kind === 'section') {
			bucket.wholeSection = true;
		} else if (ref.kind === 'portal') {
			bucket.portalIdxs.add(ref.portalIdx);
		} else if (ref.kind === 'boundaryLineEndpoint') {
			const key = `${ref.portalIdx}/${ref.lineIdx}`;
			const mask = (bucket.blEndpoints.get(key) ?? 0) | (ref.end === 0 ? 1 : 2);
			bucket.blEndpoints.set(key, mask);
		} else {
			const mask = (bucket.noGoEndpoints.get(ref.lineIdx) ?? 0) | (ref.end === 0 ? 1 : 2);
			bucket.noGoEndpoints.set(ref.lineIdx, mask);
		}
	}
	return map;
}

/**
 * Translate every entity in the multi-Selection by the same `(dx, dy, dz)`
 * offset, treating the bulk as one rigid body. No cascade — outside
 * neighbours stay put (ADR-0009).
 *
 * Whole-section refs translate the section's corners + every portal anchor
 * + every portal boundary-line endpoint + every no-go line endpoint. Y
 * shifts the portal anchor heights only (corners and line endpoints are
 * XZ-packed — ADR-0011).
 *
 * Sub-entity refs move only the addressed spatial datum:
 *   - portal: the Vector3 `position` (full 3D).
 *   - boundaryLineEndpoint / noGoLineEndpoint: the XZ pair only (no Y).
 *
 * Returns the original `model` reference on a (0, 0, 0) offset OR an empty
 * refs list so byte-for-byte BND2 writeback is preserved on a no-op gesture.
 */
export function bulkTranslateEntities(
	model: ParsedAISectionsV12,
	refs: readonly AISectionEntityRef[],
	offset: { x: number; y: number; z: number },
): ParsedAISectionsV12 {
	const dx = offset.x;
	const dy = offset.y;
	const dz = offset.z;
	if (dx === 0 && dy === 0 && dz === 0) return model;
	if (refs.length === 0) return model;

	const buckets = bucketRefs(refs);
	let anyChange = false;
	const nextSections = model.sections.map((sec, sectionIdx) => {
		const bucket = buckets.get(sectionIdx);
		if (!bucket) return sec;

		// Whole-section ref: translate everything spatial in this section.
		if (bucket.wholeSection) {
			anyChange = true;
			return {
				...sec,
				corners: sec.corners.map((c) => ({ x: c.x + dx, y: c.y + dz })),
				portals: sec.portals.map((p) => ({
					...p,
					position: { x: p.position.x + dx, y: p.position.y + dy, z: p.position.z + dz },
					boundaryLines: p.boundaryLines.map((bl) => ({
						verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
					})),
				})),
				noGoLines: sec.noGoLines.map((bl) => ({
					verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
				})),
			};
		}

		// Sub-entity refs only — touch the specific portals / endpoints, leave
		// every other field of this section structurally identical (=== equal).
		let sectionTouched = false;

		const nextPortals = sec.portals.map((p, pi) => {
			const portalSelected = bucket.portalIdxs.has(pi);
			const blMask = (li: number) => bucket.blEndpoints.get(`${pi}/${li}`) ?? 0;
			let portalTouched = false;
			let position = p.position;
			if (portalSelected) {
				position = { x: p.position.x + dx, y: p.position.y + dy, z: p.position.z + dz };
				portalTouched = true;
			}
			const nextBls = p.boundaryLines.map((bl, li) => {
				const m = blMask(li);
				if (m === 0) return bl;
				portalTouched = true;
				const startSelected = (m & 1) !== 0;
				const endSelected = (m & 2) !== 0;
				return {
					verts: {
						x: startSelected ? bl.verts.x + dx : bl.verts.x,
						y: startSelected ? bl.verts.y + dz : bl.verts.y,
						z: endSelected ? bl.verts.z + dx : bl.verts.z,
						w: endSelected ? bl.verts.w + dz : bl.verts.w,
					},
				};
			});
			if (!portalTouched) return p;
			sectionTouched = true;
			return { ...p, position, boundaryLines: nextBls };
		});

		const nextNoGo = sec.noGoLines.map((bl, li) => {
			const m = bucket.noGoEndpoints.get(li) ?? 0;
			if (m === 0) return bl;
			sectionTouched = true;
			const startSelected = (m & 1) !== 0;
			const endSelected = (m & 2) !== 0;
			return {
				verts: {
					x: startSelected ? bl.verts.x + dx : bl.verts.x,
					y: startSelected ? bl.verts.y + dz : bl.verts.y,
					z: endSelected ? bl.verts.z + dx : bl.verts.z,
					w: endSelected ? bl.verts.w + dz : bl.verts.w,
				},
			};
		});

		if (!sectionTouched) return sec;
		anyChange = true;
		return { ...sec, portals: nextPortals, noGoLines: nextNoGo };
	});

	if (!anyChange) return model;
	return { ...model, sections: nextSections };
}

/**
 * Rotate every entity in the multi-Selection around the same world-space
 * `pivot` by `theta` radians of yaw (around world +Y). Treats the bulk as
 * one rigid body — every selected spatial coordinate orbits the single
 * pivot, so relative distances within the bulk are preserved exactly.
 *
 * Whole-section refs rotate the section's corners + every portal anchor
 * (XZ rotated, Y untouched) + every portal boundary-line endpoint + every
 * no-go line endpoint. Sub-entity refs rotate only the addressed coordinate.
 *
 * Yaw direction follows the right-hand rule with thumb along world +Y, so
 * positive `theta` rotates +X towards +Z — same convention as
 * `rotateSectionAroundCentroidYaw` and three.js's `Object3D.rotation.y`.
 *
 * Returns the original `model` reference on `theta === 0` OR an empty refs
 * list so byte-for-byte BND2 writeback is preserved on a no-op gesture.
 */
export function bulkRotateEntitiesYaw(
	model: ParsedAISectionsV12,
	refs: readonly AISectionEntityRef[],
	pivot: { x: number; z: number },
	theta: number,
): ParsedAISectionsV12 {
	if (theta === 0) return model;
	if (refs.length === 0) return model;

	const cosT = Math.cos(theta);
	const sinT = Math.sin(theta);
	const cx = pivot.x;
	const cz = pivot.z;

	const rotXZ = (x: number, z: number): { x: number; z: number } => {
		const ox = x - cx;
		const oz = z - cz;
		return {
			x: ox * cosT - oz * sinT + cx,
			z: ox * sinT + oz * cosT + cz,
		};
	};

	const buckets = bucketRefs(refs);
	let anyChange = false;
	const nextSections = model.sections.map((sec, sectionIdx) => {
		const bucket = buckets.get(sectionIdx);
		if (!bucket) return sec;

		if (bucket.wholeSection) {
			anyChange = true;
			return {
				...sec,
				corners: sec.corners.map((corner) => {
					const r = rotXZ(corner.x, corner.y);
					return { x: r.x, y: r.z };
				}),
				portals: sec.portals.map((p) => {
					const rp = rotXZ(p.position.x, p.position.z);
					return {
						...p,
						position: { x: rp.x, y: p.position.y, z: rp.z },
						boundaryLines: p.boundaryLines.map((bl) => {
							const rs = rotXZ(bl.verts.x, bl.verts.y);
							const re = rotXZ(bl.verts.z, bl.verts.w);
							return { verts: { x: rs.x, y: rs.z, z: re.x, w: re.z } };
						}),
					};
				}),
				noGoLines: sec.noGoLines.map((bl) => {
					const rs = rotXZ(bl.verts.x, bl.verts.y);
					const re = rotXZ(bl.verts.z, bl.verts.w);
					return { verts: { x: rs.x, y: rs.z, z: re.x, w: re.z } };
				}),
			};
		}

		let sectionTouched = false;

		const nextPortals = sec.portals.map((p, pi) => {
			const portalSelected = bucket.portalIdxs.has(pi);
			const blMask = (li: number) => bucket.blEndpoints.get(`${pi}/${li}`) ?? 0;
			let portalTouched = false;
			let position = p.position;
			if (portalSelected) {
				const rp = rotXZ(p.position.x, p.position.z);
				position = { x: rp.x, y: p.position.y, z: rp.z };
				portalTouched = true;
			}
			const nextBls = p.boundaryLines.map((bl, li) => {
				const m = blMask(li);
				if (m === 0) return bl;
				portalTouched = true;
				const startSelected = (m & 1) !== 0;
				const endSelected = (m & 2) !== 0;
				const rs = startSelected ? rotXZ(bl.verts.x, bl.verts.y) : { x: bl.verts.x, z: bl.verts.y };
				const re = endSelected ? rotXZ(bl.verts.z, bl.verts.w) : { x: bl.verts.z, z: bl.verts.w };
				return { verts: { x: rs.x, y: rs.z, z: re.x, w: re.z } };
			});
			if (!portalTouched) return p;
			sectionTouched = true;
			return { ...p, position, boundaryLines: nextBls };
		});

		const nextNoGo = sec.noGoLines.map((bl, li) => {
			const m = bucket.noGoEndpoints.get(li) ?? 0;
			if (m === 0) return bl;
			sectionTouched = true;
			const startSelected = (m & 1) !== 0;
			const endSelected = (m & 2) !== 0;
			const rs = startSelected ? rotXZ(bl.verts.x, bl.verts.y) : { x: bl.verts.x, z: bl.verts.y };
			const re = endSelected ? rotXZ(bl.verts.z, bl.verts.w) : { x: bl.verts.z, z: bl.verts.w };
			return { verts: { x: rs.x, y: rs.z, z: re.x, w: re.z } };
		});

		if (!sectionTouched) return sec;
		anyChange = true;
		return { ...sec, portals: nextPortals, noGoLines: nextNoGo };
	});

	if (!anyChange) return model;
	return { ...model, sections: nextSections };
}

/**
 * Compute the **effective** TransformAxes for a multi-Selection of AI section
 * entities. Per ADR-0011, every entity in this slice is XZ-packed (corners,
 * boundary lines, no-go lines) or has a single-axis yaw freedom (portal
 * anchors as 3D points still inherit the XZ-only rotate restriction because
 * the bulk's combined rotation has to apply uniformly to its XZ-packed
 * neighbours in the same bulk). So an AI-section-only bulk always reports
 * yaw-only — pitch/roll rings render disabled.
 *
 * Returns `null` for an empty refs list so the caller can fall back to
 * showing no gizmo. The function exists as a separate export so future
 * resource families (trigger boxes, static vehicles) can declare their own
 * per-entity-ref axes and have `intersectTransformAxes` AND them down.
 */
export function bulkAISectionsAxes(
	refs: readonly AISectionEntityRef[],
): { translate: { x: boolean; y: boolean; z: boolean }; rotate: { x: boolean; y: boolean; z: boolean } } | null {
	if (refs.length === 0) return null;
	// Every AI-section entity (whole section, portal, line endpoint) is in an
	// XZ-packed family — yaw-only. The intersection of all-yaw is yaw.
	return {
		translate: { x: true, y: true, z: true },
		rotate: { x: false, y: true, z: false },
	};
}

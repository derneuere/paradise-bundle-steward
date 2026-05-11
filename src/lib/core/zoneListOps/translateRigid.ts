// Zone-list rigid translate/rotate (single-entity Bulk-transform ops).
//
// Zone points live on the streaming PVS quad — four `Vec2Padded` entries per
// zone, addressed by `(zoneIdx, pointIdx)`. The padded `Vec2` keeps `_padA`
// and `_padB` as opaque f32 slots so byte-for-byte BND2 writeback survives
// any edit (the disk format defines a 16-byte stride per point, of which
// only the first 8 bytes are interpreted as `(x, z)` in editor-display
// coordinates — `Vec2Padded.y` holds the world Z, matching the AI-section
// convention).
//
// XZ-packed per ADR-0011: every gesture is yaw-only on the rotate axis;
// translate.y is dropped at the call site. The transformAxes profile lives
// in `./transformAxes`; these ops accept only the XZ delta to make the
// no-Y contract explicit at the type level.

import type { ParsedZoneList, Zone } from '../zoneList';

/**
 * Translate one zone point by an XZ offset — no cascade. Touches only the
 * single `Vec2Padded` addressed by `(zoneIdx, pointIdx)`; the padded slots
 * (`_padA`, `_padB`) on that point are preserved verbatim, and every other
 * point + every other zone in the model stays structurally identical
 * (===-equal) so React memoisation along the spine survives.
 *
 * Returns the original `model` reference when `(dx, dz) === (0, 0)` so
 * byte-for-byte BND2 writeback is preserved on a no-op gesture.
 *
 * @throws RangeError if `zoneIdx` or `pointIdx` is out of range.
 */
export function translateZonePointRigid(
	model: ParsedZoneList,
	zoneIdx: number,
	pointIdx: number,
	offset: { x: number; z: number },
): ParsedZoneList {
	if (zoneIdx < 0 || zoneIdx >= model.zones.length) {
		throw new RangeError(`zoneIdx ${zoneIdx} out of range [0, ${model.zones.length})`);
	}
	const src = model.zones[zoneIdx];
	if (pointIdx < 0 || pointIdx >= src.points.length) {
		throw new RangeError(`pointIdx ${pointIdx} out of range [0, ${src.points.length})`);
	}
	const dx = offset.x;
	const dz = offset.z;
	if (dx === 0 && dz === 0) return model;

	const next: Zone = {
		...src,
		points: src.points.map((p, i) =>
			i === pointIdx
				? { ...p, x: p.x + dx, y: p.y + dz }
				: p,
		),
	};
	const zones = model.zones.map((z, i) => (i === zoneIdx ? next : z));
	return { ...model, zones };
}

/**
 * Translate every point of one zone (a "whole-zone" Selection) by the same
 * XZ offset. Equivalent to calling {@link translateZonePointRigid} four
 * times, but produces fewer intermediate objects on the array spine.
 *
 * Returns the original `model` reference when `(dx, dz) === (0, 0)`.
 *
 * @throws RangeError if `zoneIdx` is out of range.
 */
export function translateZoneRigid(
	model: ParsedZoneList,
	zoneIdx: number,
	offset: { x: number; z: number },
): ParsedZoneList {
	if (zoneIdx < 0 || zoneIdx >= model.zones.length) {
		throw new RangeError(`zoneIdx ${zoneIdx} out of range [0, ${model.zones.length})`);
	}
	const dx = offset.x;
	const dz = offset.z;
	if (dx === 0 && dz === 0) return model;

	const src = model.zones[zoneIdx];
	const next: Zone = {
		...src,
		points: src.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dz })),
	};
	const zones = model.zones.map((z, i) => (i === zoneIdx ? next : z));
	return { ...model, zones };
}

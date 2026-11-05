// The IK step: tag points follow their two sensors, driven points re-solve
// as a rigid two-bone chain hanging off two tag points, and the results are
// packed into the 128 skin rows the body mesh reads by blend index.

import type { Vec3 } from '../deformationSpec';
import { add, dot, normalize, scale, sub, PartState, type SimState } from './state';
import { IK_RATES, SILL_PARTS, SKINNING_CLAMP_MARGIN } from './tables';

const EPS = 1.1920929e-7;

function tagTarget(s: SimState, i: number): Vec3 {
	const t = s.spec.tagPoints[i];
	const a = s.sensors[t.deformationSensorA] ?? t.initialPosition;
	const b = s.sensors[t.deformationSensorB] ?? t.initialPosition;
	return add(scale(add(a, t.offsetFromA), t.weightA), scale(add(b, t.offsetFromB), t.weightB));
}

// The side a driven point sits on, relative to its A-B axis at rest; the
// solve never lets it cross to the other side.
export function drivenNormal(s: SimState, i: number): Vec3 {
	const d = s.spec.drivenPoints[i];
	const a = s.spec.tagPoints[d.tagPointIndexA]?.initialPosition;
	const b = s.spec.tagPoints[d.tagPointIndexB]?.initialPosition;
	if (!a || !b) return [0, 0, 0];
	const u = normalize(sub(b, a));
	const w = sub(d.initialPos, a);
	const n = sub(w, scale(u, dot(w, u)));
	return n.every((v) => Math.abs(v) <= EPS) ? n : normalize(n);
}

function solveDriven(s: SimState, i: number): void {
	const d = s.spec.drivenPoints[i];
	const ends: [Vec3 | undefined, number][] = [[s.tags[d.tagPointIndexA], d.distanceFromA], [s.tags[d.tagPointIndexB], d.distanceFromB]];
	let pos = s.driven[i];
	const n = s.drivenNormal[i];
	for (const [end, dist] of ends) {
		if (!end) continue;
		let v = sub(pos, end);
		v = sub(v, scale(n, Math.min(dot(n, v), 0)));
		pos = add(end, scale(normalize(v), dist));
	}
	s.driven[i] = pos;
}

export function updateIK(s: SimState): void {
	for (const rate of IK_RATES) {
		for (let i = 0; i < s.tags.length; i++) {
			const target = tagTarget(s, i);
			s.tags[i] = add(s.tags[i], scale(sub(target, s.tags[i]), rate));
		}
		for (let i = 0; i < s.driven.length; i++) solveDriven(s, i);
	}
}

// Rows: the leading run of skinned tag points, then each IK part's driven
// points in part order. A detached part's rows are left as they were (the
// part is drawn by its own free-body transform); hinged parts still skin.
export function updateSkinRows(s: SimState): void {
	const rows = s.rows;
	let row = 0;
	const put = (delta: Vec3) => {
		if (row < 128) rows.set([delta[0], delta[1], delta[2], 0], row * 4);
		row++;
	};
	for (let i = 0; i < s.tags.length && s.spec.tagPoints[i].skinnedPoint; i++) {
		put(sub(s.tags[i], s.spec.tagPoints[i].initialPosition));
	}
	s.spec.ikParts.forEach((part, p) => {
		if (s.partState[p] === PartState.Detached) { row += part.numberOfDrivenPoints; return; }
		for (let k = 0; k < part.numberOfDrivenPoints; k++) {
			const i = part.startIndexOfDrivenPoints + k;
			let pos = s.driven[i];
			if (SILL_PARTS.has(part.partType)) pos = clampToBox(pos, s);
			put(sub(pos, s.spec.drivenPoints[i].initialPos));
		}
	});
}

function clampToBox(p: Vec3, s: SimState): Vec3 {
	return [0, 1, 2].map((k) => Math.min(Math.max(p[k], s.aabb.min[k] - SKINNING_CLAMP_MARGIN[k]), s.aabb.max[k] + SKINNING_CLAMP_MARGIN[k])) as Vec3;
}

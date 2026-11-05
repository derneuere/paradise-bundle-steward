// Window glass. Each pane is watched through its four corner points: a tag
// point or a driven point per corner (the pane's skinToControlPoint flag picks
// which; the parser still calls the flags `bytes58`). Once the corners have
// been pushed far enough from rest the pane cracks, further and it smashes;
// a pane never heals except on a reset. Runs after the IK step, so it sees
// this step's dents.
//
// The test sums the squared displacement of the four corners against fixed
// thresholds (4 x 1 mm² to crack, 4 x 5 cm² to smash: an RMS corner shift
// past 1 mm cracks, past 5 cm smashes). An intact pane hit hard enough skips
// straight to smashed. While a pane stays cracked it re-reports every IK
// step with a fresh crack amount (from its most-moved corner); a smash
// reports once.

import type { Vec3 } from '../deformationSpec';
import { add, dot, length, sub, type SimState } from './state';
import { GlassState, type GlassEvent } from './events';
import { mul3 } from './parts';

export const CRACK_SUM_SQ = 0.001 * 0.001 * 4;
export const SMASH_SUM_SQ = 0.05 * 0.05 * 4;
const CRACK_START = 0.001;
const CRACK_SPAN = 0.049;

export type PaneState = { state: GlassState; crack: number };

export const freshPanes = (s: Pick<SimState, 'spec'>): PaneState[] =>
	s.spec.glassPanes.map(() => ({ state: GlassState.Intact, crack: 0 }));

// Live and rest position of one pane corner (handling frame).
function cornerPoint(s: SimState, pane: number, corner: number): { live: Vec3; rest: Vec3 } | null {
	const g = s.spec.glassPanes[pane];
	const i = g.cornerTagIndices[corner];
	if (g.bytes58[corner]) {
		const spec = s.spec.tagPoints[i];
		return spec && s.tags[i] ? { live: s.tags[i], rest: spec.initialPosition } : null;
	}
	const spec = s.spec.drivenPoints[i];
	return spec && s.driven[i] ? { live: s.driven[i], rest: spec.initialPos } : null;
}

// 0 at 1 mm of corner travel, easing out to 1 at 5 cm.
export function crackAmount(maxCornerShift: number): number {
	const t = Math.min(Math.max((maxCornerShift - CRACK_START) / CRACK_SPAN, 0), 1);
	return 1 - (1 - t) * (1 - t);
}

export function updateGlass(s: SimState): void {
	s.spec.glassPanes.forEach((g, p) => {
		const pane = s.glass[p];
		const points = [0, 1, 2, 3].map((k) => cornerPoint(s, p, k));
		if (points.some((c) => !c)) return;
		let sum = 0, peak = 0;
		for (const c of points) {
			const d = sub(c!.live, c!.rest);
			sum += dot(d, d);
			peak = Math.max(peak, length(d));
		}
		let changed: boolean;
		if (pane.state !== GlassState.Smashed && sum > SMASH_SUM_SQ) { pane.state = GlassState.Smashed; changed = true; }
		else if (pane.state === GlassState.Intact && sum > CRACK_SUM_SQ) { pane.state = GlassState.Cracked; changed = true; }
		else changed = pane.state === GlassState.Cracked;
		if (!changed) return;
		const crack = pane.state === GlassState.Cracked ? crackAmount(peak) : 0;
		// What the renderer shows only ever grows.
		if (pane.state === GlassState.Cracked) pane.crack = Math.min(Math.max(pane.crack, crack), 1);
		const toWorld = (v: Vec3) => add(s.carPos, mul3(s.carRot, v));
		s.events.glass.push({
			pane: p, partType: g.partType, state: pane.state as GlassEvent['state'], crack,
			corners: points.map((c, k) => toWorld(add(c!.live, [g.matrix[k][0], g.matrix[k][1], g.matrix[k][2]]))) as GlassEvent['corners'],
			normal: mul3(s.carRot, [g.plane[0], g.plane[1], g.plane[2]]),
			carVel: [...s.carVel] as Vec3,
		});
	});
}

// Bit per pane render slot (body-part type - 16): the meshes a smashed pane
// draws with carry the same bit in their mesh flags.
export function smashedPaneBits(s: SimState): number {
	let bits = 0;
	s.spec.glassPanes.forEach((g, p) => {
		const slot = g.partType - 16;
		if (s.glass[p].state === GlassState.Smashed && slot >= 0 && slot < 8) bits |= 1 << slot;
	});
	return bits;
}

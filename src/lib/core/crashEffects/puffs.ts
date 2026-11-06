// Dust and smoke puffs: soft camera-facing sprites that drift with a drag
// ramp, rise slowly, spin, and grow / change colour start -> mid -> end over
// their life. Closed-form, like the sparks.

import type { Vec3 } from '../deformationSpec';
import { dragDistance } from './random';
import type { PuffModel } from './tables';

export type Puff = {
	model: PuffModel;
	birth: number;
	life: number;
	p0: Vec3;
	v: Vec3;
	sizeScale: number;
	spin: number;     // rad/s
	angle0: number;
};

export type PuffLook = { pos: Vec3; size: number; angle: number; rgba: [number, number, number, number] };

export function makePuff(model: PuffModel, p0: Vec3, v: Vec3, sizeScale: number, time: number, index: number, spin: number, angle0: number): Puff {
	return { model, birth: time, life: model.life * model.lifeScale[index & 3], p0, v, sizeScale, spin, angle0 };
}

// Piecewise-linear start -> mid -> end, with mid at `midTime` of the life.
function track(u: number, mid: number, a: number, b: number, c: number): number {
	if (u <= mid) return mid > 0 ? a + (b - a) * (u / mid) : b;
	return b + (c - b) * Math.min((u - mid) / (1 - mid), 1);
}

export function puffLook(p: Puff, t: number): PuffLook {
	const m = p.model;
	const u = Math.min(Math.max(t / p.life, 0), 1);
	const d = dragDistance(t, m.drag);
	const [c0, c1, c2] = m.colour;
	return {
		pos: [p.p0[0] + p.v[0] * d, p.p0[1] + p.v[1] * d + m.rise * t * t, p.p0[2] + p.v[2] * d],
		size: track(u, m.midTime, m.size[0], m.size[1], m.size[2]) * p.sizeScale,
		angle: p.angle0 + p.spin * t,
		rgba: [0, 1, 2, 3].map((k) => track(u, m.midTime, c0[k], c1[k], c2[k])) as PuffLook['rgba'],
	};
}

// Parts knocked clean off: a box at the panel's centre of mass, launched
// with the car's motion, that tumbles, bounces off the ground and the
// obstacle and comes to rest lying on a face.

import { describe, expect, it } from 'vitest';
import type { IKPart, Vec3 } from '../../deformationSpec';
import { cross } from '../state';
import { hasFixture, loadCar } from '../../vehicleSim/__tests__/carFixture';
import { rotationMatrix, toWorldDir, updateWorldInertia } from '../../vehicleSim/body';
import { lowestGap, makeLooseWheel } from '../freeParts';
import { detachPart } from '../parts';
import { partBox, partInertia } from '../partBox';
import { meshToWorld } from '../pose';
import { mul3 } from '../rotation';
import { applyImpact, createCrashSim, stepCrashSim } from '../sim';
import { add, PartState, type FreePart, type SimState } from '../state';
import { makeSim } from './fixture';

const DOOR = 1, TRIM = 2;
const close = (a: readonly number[], b: readonly number[], d = 9) => b.forEach((x, i) => expect(a[i]).toBeCloseTo(x, d));

// Gives a part a real bounding box: eight corners spanning lo..hi in its own
// frame, no skinning.
function setBox(part: IKPart, lo: Vec3, hi: Vec3): void {
	let k = 0;
	for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
		part.cornerSkin[k++] = { vertex: [x, y, z, 0], weights: [0, 0, 0], boneIndices: [0, 0, 0] };
	}
	const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
	part.centerSkin = { vertex: [c[0], c[1], c[2], 0], weights: [0, 0, 0], boneIndices: [0, 0, 0] };
	part.jointSkin = { ...part.centerSkin };
}

function knockOff(s: SimState, p: number): FreePart {
	s.latch[0] = 900;
	detachPart(s, p, -1);
	expect(s.partState[p]).toBe(PartState.Detached);
	return s.free.get(p)!;
}

const upAlignment = (f: FreePart, s: SimState, p: number) => {
	const box = partBox(s, p);
	return Math.max(...box.axes.map((a) => Math.abs(mul3(f.rotation, a)[1])));
};

describe('part box', () => {
	it('spans the bounding-box points, centred on them, with a 5 cm floor on every half side', () => {
		const sim = makeSim(), s = sim.state;
		setBox(s.spec.ikParts[DOOR], [0.95, 0.2, 1.4], [1.05, 0.8, 2.2]);
		const box = partBox(s, DOOR);
		close(box.centre, [1, 0.5, 1.8], 6);
		close(box.half, [0.05, 0.3, 0.4], 6);
		const bare = partBox(s, TRIM);   // all ten points at its origin
		close(bare.half, [0.05, 0.05, 0.05], 9);
	});

	it('follows the dent: skinned points move with their part\'s tag points', () => {
		const sim = makeSim(), s = sim.state, part = s.spec.ikParts[DOOR];
		setBox(part, [0.95, 0.2, 1.4], [1.05, 0.8, 2.2]);
		for (const c of part.cornerSkin) {
			if (c.vertex[2] > 2) { c.weights = [0, 1, 0]; c.boneIndices = [0, 1, 0]; }
		}
		s.tags[3] = add(s.tags[3], [0, 0, -0.2]);   // the door's second tag (bone 1)
		const box = partBox(s, DOOR);
		close(box.half, [0.05, 0.3, 0.3], 6);
		close(box.centre, [1, 0.5, 1.7], 6);
	});

	it('mirrors a left-handed orientation into a right-handed box of the same size', () => {
		const sim = makeSim(), s = sim.state, part = s.spec.ikParts[DOOR];
		setBox(part, [0.95, 0.2, 1.4], [1.05, 0.8, 2.2]);
		part.orientation = [[-1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
		const box = partBox(s, DOOR);
		close(box.half, [0.05, 0.3, 0.4], 6);
		const [x, y, z] = box.axes;
		expect(cross(x, y)[0] * z[0] + cross(x, y)[1] * z[1] + cross(x, y)[2] * z[2]).toBeGreaterThan(0.99);
	});

	it('weighs 100 kg with a solid box\'s inertia, times 1.2, plus 0.2', () => {
		const sim = makeSim(), s = sim.state;
		setBox(s.spec.ikParts[DOOR], [0.95, 0.2, 1.4], [1.05, 0.8, 2.2]);
		const { invInertia, inertiaRatio } = partInertia(partBox(s, DOOR));
		const I = (a: number, b: number) => ((a * a + b * b) / 3) * 100 * 1.2 + 0.2;
		expect(1 / invInertia[0]).toBeCloseTo(I(0.3, 0.4), 6);
		expect(1 / invInertia[4]).toBeCloseTo(I(0.05, 0.4), 6);
		expect(1 / invInertia[8]).toBeCloseTo(I(0.05, 0.3), 6);
		expect(inertiaRatio).toBeCloseTo(I(0.3, 0.4) / 100, 9);
	});
});

describe('knocked-off part', () => {
	it('leaves at its centre of mass with the car\'s spin, its arm crossed with the spin in the car\'s own axes', () => {
		const sim = makeSim(), s = sim.state, b = s.body;
		setBox(s.spec.ikParts[TRIM], [0.4, 0.1, 2.1], [0.6, 0.3, 2.3]);
		const yaw = Math.PI / 2;
		b.axes = [[Math.cos(yaw), 0, -Math.sin(yaw)], [0, 1, 0], [Math.sin(yaw), 0, Math.cos(yaw)]];
		updateWorldInertia(b);
		b.v = [3, 0, 10];
		b.w = [0.5, 2, 1];
		s.spec.ikParts[TRIM].graphicsTransform[3] = [0.5, 0.2, 2.2, 1];
		const f = knockOff(s, TRIM);
		close(f.spin, b.w);
		const arm: Vec3 = [0.5 - s.com[0], 0.2 - s.com[1], 2.2 - s.com[2]];
		close(f.vel, add(b.v, cross(b.w, arm)));
		const rotatedArm = add(b.v, cross(b.w, toWorldDir(b, arm)));
		expect(Math.hypot(f.vel[0] - rotatedArm[0], f.vel[1] - rotatedArm[1], f.vel[2] - rotatedArm[2])).toBeGreaterThan(0.1);
		close(f.pos, meshToWorld(s, partBox(s, TRIM).centre));
		close(f.rotation, rotationMatrix(b));
	});

	it('tumbles to rest flat on the ground, its lowest corner on the road, and then lies still', () => {
		const sim = makeSim(), s = sim.state;
		setBox(s.spec.ikParts[TRIM], [0.2, 0.1, 1.6], [0.8, 0.14, 2.4]);
		const f = knockOff(s, TRIM);
		f.vel = [2, 4, 1];
		f.spin = [3, 1, 2];
		let frozenAt = -1;
		for (let i = 0; i < 1200 && frozenAt < 0; i++) {
			stepCrashSim(sim);
			if (f.frozen) frozenAt = i;
		}
		expect(frozenAt).toBeGreaterThan(0);
		expect(Math.abs(lowestGap(f))).toBeLessThan(1e-3);
		expect(upAlignment(f, s, TRIM)).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
		const pose = [...f.pos, ...f.rotation];
		for (let i = 0; i < 60; i++) stepCrashSim(sim);
		close([...f.pos, ...f.rotation], pose, 12);
		close(f.spin, [0, 0, 0]);
	});

	it('bounces off the wall instead of passing through it', () => {
		const sim = makeSim(), s = sim.state;
		setBox(s.spec.ikParts[TRIM], [0.4, 0.1, 2.1], [0.6, 0.3, 2.3]);
		const f = knockOff(s, TRIM);
		const wallZ = f.pos[2] + 1;
		s.obstacle = { kind: 'wall', point: [0, 0, wallZ], normal: [0, 0, 1], poleAxis: [0, 1, 0], poleRadius: 0 };
		f.vel = [0, 2, 25];
		let deepest = 0;
		for (let i = 0; i < 240; i++) {
			stepCrashSim(sim);
			for (const p of f.points) deepest = Math.max(deepest, add(f.pos, mul3(f.rotation, p))[2] - wallZ);
		}
		expect(deepest).toBeLessThan(0.02);
		expect(f.pos[2]).toBeLessThan(wallZ);
	});

	it('is cut back to 4 rad/s once it spins faster than 5, and to 30 m/s at most', () => {
		const sim = makeSim(), s = sim.state;
		const f = knockOff(s, TRIM);
		f.pos = [0, 50, 0];
		f.spin = [0, 6, 0];
		f.vel = [80, 0, 0];
		stepCrashSim(sim);
		expect(Math.hypot(...f.spin)).toBeCloseTo(4 * 0.995, 6);
		expect(Math.hypot(...f.vel)).toBeCloseTo(30, 6);
	});
});

describe('loose wheel', () => {
	it('rolls and bounces to rest on its tyre', () => {
		const sim = makeSim(), s = sim.state;
		const w = makeLooseWheel(0, 0.33, 0.12, rotationMatrix(s.body), [0, 1, 0], [6, 0, 2], [5, 0, 0]);
		s.looseWheels.push(w);
		for (let i = 0; i < 1800 && !w.frozen; i++) stepCrashSim(sim);
		expect(w.frozen).toBe(true);
		expect(Math.abs(lowestGap(w))).toBeLessThan(1e-3);
	});
});

describe.skipIf(!hasFixture('PUSSC01'))('PUSSC01 into a wall at 180 km/h', () => {
	it('throws its loose parts onto the road, where each comes to rest lying on a face', () => {
		const { spec, vault } = loadCar('PUSSC01');
		const sim = createCrashSim(spec, { vault });
		const sh = spec.carModelSpaceToHandlingBodySpace[3];
		const front = Math.max(...spec.tagPoints.map((t) => t.initialPosition[2]));
		applyImpact(sim, { pointMesh: [-sh[0], 0.5 - sh[1], front - sh[2]], direction: [0, 0, -1], speed: 50 });
		for (let i = 0; i < 60 * 8; i++) stepCrashSim(sim);
		const s = sim.state;
		expect(s.free.size).toBeGreaterThan(0);
		for (const [p, f] of s.free) {
			expect(f.frozen).toBe(true);
			expect(Math.abs(lowestGap(f))).toBeLessThan(1e-3);
			expect(upAlignment(f, s, p)).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
		}
	});
});

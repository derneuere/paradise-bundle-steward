import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { applyImpact, createCrashSim, resetCrashSim, stepCrashSim } from '../sim';
import { applySensorImpulse } from '../sensors';
import { updateIK, updateSkinRows } from '../ik';
import { checkForDetachment, updateHinges } from '../parts';
import { PartState } from '../state';
import { makeSim, makeSpec } from './fixture';

const DT = 1 / 60;
const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], digits));
const hitFront = (magnitude: number, closingSpeed = 10, invMass = 1 / 1000) =>
	({ sensor: 0, direction: [0, 0, -1] as Vec3, magnitude, closingSpeed, invMass, dt: DT });

describe('sensor crush', () => {
	it('moves the hit sensor by absorption x impulse x inverse mass x dt', () => {
		const sim = makeSim();
		// Level 0 of the normal table absorbs 0.98 regardless of speed.
		applySensorImpulse(sim.state, hitFront(1000));
		close(sim.state.sensors[0], [0, 0.5, 2 - 0.98 * 1000 * (1 / 1000) * DT]);
	});

	it('passes half the absorbed impulse down the chain at full strength', () => {
		const sim = makeSim();
		applySensorImpulse(sim.state, hitFront(1000));
		const passed = 0.98 * 1000 * 0.5;
		expect(sim.state.sensors[1][2]).toBeCloseTo(1 - passed * 0.98 * (1 / 1000) * DT, 6);
	});

	it('stops at the per-direction crush budget', () => {
		const sim = makeSim();
		for (let i = 0; i < 50; i++) applySensorImpulse(sim.state, hitFront(1e6));
		expect(2 - sim.state.sensors[0][2]).toBeCloseTo(0.3, 6); // directionParams[-Z] = 0.3
	});

	it('hands what the sensor did not absorb to the car body once the chain ends there', () => {
		const sim = makeSim();
		const arrivals = applySensorImpulse(sim.state, hitFront(1000));
		expect(arrivals).toHaveLength(1);
		expect(arrivals[0].d).toBe(5);   // -Z
		expect(arrivals[0].rem).toBeCloseTo(1000 * (1 - 0.98), 9);
	});

	it('latches the biggest impulse each sensor felt', () => {
		const sim = makeSim();
		applySensorImpulse(sim.state, hitFront(800));
		applySensorImpulse(sim.state, hitFront(300));
		expect(sim.state.latch[0]).toBe(800);
	});
});

describe('IK and skin rows', () => {
	it('puts tag points exactly on their sensor-driven target and re-solves driven points A then B', () => {
		const sim = makeSim();
		sim.state.sensors[0] = [0, 0.5, 1.8];
		updateIK(sim.state);
		close(sim.state.tags[0], [0, 0.5, 2.1]);
		// The solve snaps to bone A, then to bone B, so only the B length is exact.
		const d = sim.state.driven[0], spec = sim.state.spec.drivenPoints[0];
		expect(Math.hypot(...[0, 1, 2].map((k) => d[k] - sim.state.tags[1][k]))).toBeCloseTo(spec.distanceFromB, 6);
		expect(d[1]).toBeGreaterThan(0.5); // stays on its own side of the A-B axis
	});

	it('packs skinned tags first, then each part\'s driven points; detached parts keep stale rows', () => {
		const sim = makeSim();
		sim.state.sensors[0] = [0, 0.5, 1.9];
		updateIK(sim.state);
		updateSkinRows(sim.state);
		close(Array.from(sim.rows.slice(0, 3)), [0, 0, -0.1]);           // tag 0
		const skinned = 5;                                              // tags 0..4 skinned, wheel tags not
		expect(sim.rows[skinned * 4 + 2]).toBeLessThan(0);              // shell's driven point moved back
		const before = Array.from(sim.rows);
		sim.state.partState[0] = PartState.Detached;
		sim.state.sensors[0] = [0, 0.5, 1.7];
		updateIK(sim.state);
		updateSkinRows(sim.state);
		expect(sim.rows[skinned * 4 + 2]).toBe(before[skinned * 4 + 2]);
	});
});

describe('detachment', () => {
	it('hinges a part on its jointed tag once a tag moves past its threshold', () => {
		const sim = makeSim();
		sim.state.sensors[0] = [0, 0.5, 1.9];
		updateIK(sim.state);
		checkForDetachment(sim.state);
		expect(sim.state.partState[1]).toBe(PartState.Hinged);
		expect(sim.state.hinges.get(1)?.tag).toBe(2);
	});

	it('knocks off a joint-less part only when the impulse sits in its band', () => {
		const sim = makeSim();
		sim.state.sensors[0] = [0, 0.5, 1.9];
		updateIK(sim.state);
		sim.state.latch[0] = 5000;              // trim is toughened: band [500, 1200]
		checkForDetachment(sim.state);
		expect(sim.state.partState[2]).toBe(PartState.AttachedIK);
		sim.state.latch[0] = 900;
		checkForDetachment(sim.state);
		expect(sim.state.partState[2]).toBe(PartState.Detached);
	});

	it('never detaches the root (no mesh) and leaves undeformed parts alone', () => {
		const sim = makeSim();
		sim.state.latch[1] = 900;
		updateIK(sim.state);
		checkForDetachment(sim.state);
		expect(sim.state.partState[3]).not.toBe(PartState.Detached);
		expect(sim.state.partState[1]).toBe(PartState.AttachedIK);
	});

	it('lets gravity close a hinge whose lever points up and swing open one that hangs down', () => {
		const sim = makeSim();
		sim.state.hinges.set(1, { joint: 0, tag: 2, rot: -0.5, vel: 0, storedVel: [0, 0, 0], pen: [0, 0, 0], contact: null, limitStress: 0 });
		const joint = sim.state.spec.ikParts[1].jointSpecs[0];
		joint.defaultDirection = [0, 1, 0, 0];
		for (let i = 0; i < 120; i++) updateHinges(sim.state, DT);
		expect(sim.state.hinges.get(1)!.rot).toBeCloseTo(0, 3);
		joint.defaultDirection = [0, -1, 0, 0];
		for (let i = 0; i < 240; i++) updateHinges(sim.state, DT);
		expect(sim.state.hinges.get(1)!.rot).toBeCloseTo(-joint.maxJointAngle, 3);
	});
});

describe('crash run', () => {
	it('drives into a wall, crushes the nose within budget, comes to rest upright, and resets cleanly', () => {
		const sim = createCrashSim(makeSpec());
		applyImpact(sim, { pointMesh: [0, 0.5, 2.4], direction: [0, 0, -1], speed: 30, forceCrash: true });
		for (let i = 0; i < 60 * 12 && !sim.state.run!.end; i++) stepCrashSim(sim);
		const run = sim.state.run!;
		expect(run.crash).toBe('forced');
		// The toy nose absorbs 98 % of every contact, so the car leans on the
		// wall until the crash damping has bled its speed; it is all but
		// still when the crash clock (or freezing) ends the run.
		expect(['clock', 'frozen']).toContain(run.end);
		expect(Math.hypot(...sim.state.body.v)).toBeLessThan(0.1);
		const crush = 2 - sim.state.sensors[0][2];
		expect(crush).toBeGreaterThan(0.05);
		expect(crush).toBeLessThanOrEqual(0.3 + 1e-9);
		expect(sim.state.body.axes[1][1]).toBeGreaterThan(0.99);   // still upright
		expect(Math.max(...Array.from(sim.rows).map(Math.abs))).toBeGreaterThan(0);
		resetCrashSim(sim);
		expect(Array.from(sim.rows).every((v) => v === 0)).toBe(true);
		close(sim.state.sensors[0], [0, 0.5, 2]);
		expect(sim.state.obstacle).toBeNull();
		expect(sim.state.run).toBeNull();
		expect(sim.state.body.v).toEqual([0, 0, 0]);
	});

	it('is deterministic', () => {
		const run = () => {
			const sim = createCrashSim(makeSpec());
			applyImpact(sim, { pointMesh: [0.3, 0.5, 2.4], direction: [0, 0, -1], speed: 25, obstacle: 'pole', forceCrash: true });
			for (let i = 0; i < 90; i++) stepCrashSim(sim);
			return Array.from(sim.rows);
		};
		const rows = run();
		expect(rows.some((x) => x !== 0)).toBe(true);
		expect(run()).toEqual(rows);
	});
});

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { applyImpact, createCrashSim, resetCrashSim, stepCrashSim } from '../sim';
import { applySensorImpulse } from '../sensors';
import { updateIK, updateSkinRows } from '../ik';
import { checkForDetachment, updateHinges } from '../parts';
import { PartState } from '../state';
import { makeSpec } from './fixture';

const DT = 1 / 60;
const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], digits));
const hitFront = (magnitude: number, closingSpeed = 10, invMass = 1 / 1000) =>
	({ sensor: 0, direction: [0, 0, -1] as Vec3, magnitude, closingSpeed, invMass, dt: DT });

describe('sensor crush', () => {
	it('moves the hit sensor by absorption x impulse x inverse mass x dt', () => {
		const sim = createCrashSim(makeSpec());
		// Level 0 of the normal table absorbs 0.98 regardless of speed.
		applySensorImpulse(sim.state, hitFront(1000));
		close(sim.state.sensors[0], [0, 0.5, 2 - 0.98 * 1000 * (1 / 1000) * DT]);
	});

	it('passes half the absorbed impulse down the chain at full strength', () => {
		const sim = createCrashSim(makeSpec());
		applySensorImpulse(sim.state, hitFront(1000));
		const passed = 0.98 * 1000 * 0.5;
		expect(sim.state.sensors[1][2]).toBeCloseTo(1 - passed * 0.98 * (1 / 1000) * DT, 6);
	});

	it('stops at the per-direction crush budget', () => {
		const sim = createCrashSim(makeSpec());
		for (let i = 0; i < 50; i++) applySensorImpulse(sim.state, hitFront(1e6));
		expect(2 - sim.state.sensors[0][2]).toBeCloseTo(0.3, 6); // directionParams[-Z] = 0.3
	});

	it('returns what the sensor did not absorb as the impulse on the car body', () => {
		const sim = createCrashSim(makeSpec());
		const rest = applySensorImpulse(sim.state, hitFront(1000));
		close(rest, [0, 0, -1000 * (1 - 0.98)], 6);
	});

	it('latches the biggest impulse each sensor felt', () => {
		const sim = createCrashSim(makeSpec());
		applySensorImpulse(sim.state, hitFront(800));
		applySensorImpulse(sim.state, hitFront(300));
		expect(sim.state.latch[0]).toBe(800);
	});
});

describe('IK and skin rows', () => {
	it('puts tag points exactly on their sensor-driven target and re-solves driven points A then B', () => {
		const sim = createCrashSim(makeSpec());
		sim.state.sensors[0] = [0, 0.5, 1.8];
		updateIK(sim.state);
		close(sim.state.tags[0], [0, 0.5, 2.1]);
		// The solve snaps to bone A, then to bone B, so only the B length is exact.
		const d = sim.state.driven[0], spec = sim.state.spec.drivenPoints[0];
		expect(Math.hypot(...[0, 1, 2].map((k) => d[k] - sim.state.tags[1][k]))).toBeCloseTo(spec.distanceFromB, 6);
		expect(d[1]).toBeGreaterThan(0.5); // stays on its own side of the A-B axis
	});

	it('packs skinned tags first, then each part\'s driven points; detached parts keep stale rows', () => {
		const sim = createCrashSim(makeSpec());
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
		const sim = createCrashSim(makeSpec());
		sim.state.sensors[0] = [0, 0.5, 1.9];
		updateIK(sim.state);
		checkForDetachment(sim.state);
		expect(sim.state.partState[1]).toBe(PartState.Hinged);
		expect(sim.state.hinges.get(1)?.tag).toBe(2);
	});

	it('knocks off a joint-less part only when the impulse sits in its band', () => {
		const sim = createCrashSim(makeSpec());
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
		const sim = createCrashSim(makeSpec());
		sim.state.latch[1] = 900;
		updateIK(sim.state);
		checkForDetachment(sim.state);
		expect(sim.state.partState[3]).not.toBe(PartState.Detached);
		expect(sim.state.partState[1]).toBe(PartState.AttachedIK);
	});

	it('lets gravity close a hinge whose lever points up and swing open one that hangs down', () => {
		const sim = createCrashSim(makeSpec());
		sim.state.hinges.set(1, { joint: 0, tag: 2, rot: -0.5, vel: 0, storedVel: [0, 0, 0] });
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
	it('grinds into a wall, crushes the nose within budget, stops, and resets cleanly', () => {
		const sim = createCrashSim(makeSpec(), { attribs: { mass: 1500 } });
		applyImpact(sim, { pointMesh: [0, 0.5, 2.4], direction: [0, 0, -1], speed: 30 });
		// Level-0 sensors pass only 2 % of each impulse to the body, so the car
		// keeps grinding until the contact time runs out.
		for (let i = 0; i < 240; i++) stepCrashSim(sim);
		const crush = 2 - sim.state.sensors[0][2];
		expect(crush).toBeGreaterThan(0.05);
		expect(crush).toBeLessThanOrEqual(0.3 + 1e-9);
		expect(sim.state.carVel).toEqual([0, 0, 0]);
		expect(Math.max(...Array.from(sim.rows).map(Math.abs))).toBeGreaterThan(0);
		resetCrashSim(sim);
		expect(Array.from(sim.rows).every((v) => v === 0)).toBe(true);
		close(sim.state.sensors[0], [0, 0.5, 2]);
	});

	it('is deterministic', () => {
		const run = () => {
			const sim = createCrashSim(makeSpec(), { attribs: { mass: 1500 } });
			applyImpact(sim, { pointMesh: [0.3, 0.5, 2.4], direction: [0, 0, -1], speed: 25, obstacle: 'pole' });
			for (let i = 0; i < 60; i++) stepCrashSim(sim);
			return Array.from(sim.rows);
		};
		expect(run()).toEqual(run());
	});
});

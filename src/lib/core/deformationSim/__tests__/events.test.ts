import { describe, expect, it } from 'vitest';
import type { GlassPane, Vec3 } from '../../deformationSpec';
import { applyImpact, createCrashSim, GlassState, resetCrashSim, stepCrashSim } from '../sim';
import { checkForDetachment } from '../parts';
import { updateIK } from '../ik';
import { CRACK_SUM_SQ, crackAmount, smashedPaneBits, SMASH_SUM_SQ, updateGlass } from '../glass';
import { specToWorld } from '../pose';
import { makeSim, makeSpec, stepUntilHit } from './fixture';

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

describe('contact events', () => {
	it('records each solved contact with its point, normal, impulse and slide, cleared every step', () => {
		const sim = createCrashSim(makeSpec());
		applyImpact(sim, { pointMesh: [0, 0.5, 2.4], direction: [0, 0, -1], speed: 30 });
		stepUntilHit(sim);
		const c = sim.events.contacts.filter((x) => x.surface === 'obstacle');
		expect(c.length).toBeGreaterThan(0);
		expect(c[0].sensor).toBe(0);
		// Out of the wall toward the car: the car drives along +Z into it.
		expect(c[0].normal[2]).toBeCloseTo(-1, 6);
		expect(c[0].impulse).toBeGreaterThan(0);
		expect(c[0].closingSpeed).toBeGreaterThan(20);
		// Head-on: next to nothing slides across the face.
		expect(len(c[0].slide)).toBeLessThan(0.05 * c[0].closingSpeed);
		resetCrashSim(sim);
		stepCrashSim(sim);
		expect(sim.events.contacts).toEqual([]);
	});

	it('reports the slide across the surface on a glancing hit', () => {
		const sim = createCrashSim(makeSpec());
		applyImpact(sim, { pointMesh: [0, 0.5, 2.4], direction: [0, 0, -1], speed: 30, glance: 30 });
		stepUntilHit(sim);
		const c = sim.events.contacts.find((x) => x.surface === 'obstacle')!;
		expect(Math.abs(c.slide[0] * c.normal[0] + c.slide[1] * c.normal[1] + c.slide[2] * c.normal[2])).toBeLessThan(1e-9);  // no along-normal part
		expect(len(c.slide)).toBeGreaterThan(10);
		expect(c.scratch).toBeGreaterThan(0);
	});
});

describe('part events', () => {
	it("reports a part that came loose with its state, its origin in the world and that point's velocity", () => {
		const sim = makeSim();
		sim.state.body.v = [0, 0, 5];
		sim.state.sensors[0] = [0, 0.5, 1.9];
		updateIK(sim.state);
		checkForDetachment(sim.state);
		// The door's origin is the mesh origin, which stands above the ground.
		expect(sim.events.parts).toEqual([
			{ part: 1, gfx: 1, partType: 8, state: 'hinged', pos: specToWorld(sim.state, [0, 0, 0]), vel: [0, 0, 5] },
		]);
		expect(sim.events.parts[0].pos[1]).toBeGreaterThan(0);
	});
});

// One pane whose corners are the shell nose, the door, the trim (tags) and
// the shell's driven point.
function glassSim() {
	const spec = makeSpec();
	const pane: GlassPane = {
		plane: [0, 0, 1, 0],
		matrix: [[0.01, 0, 0, 0], [0, 0.02, 0, 0], [0, 0, 0.03, 0], [0, 0, 0, 0]],
		cornerTagIndices: [0, 3, 4, 0], bytes58: [1, 1, 1, 0],
		short5C: 0, short5E: 0, short60: 0, partType: 20,
	};
	spec.glassPanes = [pane];
	return makeSim({ spec });
}

describe('glass', () => {
	it('cracks once the corners move past 1 mm RMS and smashes past 5 cm', () => {
		const sim = glassSim();
		const s = sim.state;
		updateGlass(s);
		expect(s.glass[0].state).toBe(GlassState.Intact);
		expect(sim.events.glass).toEqual([]);
		// Only the first corner moves: its squared shift is the whole sum.
		s.tags[0] = [0, 0.5, 2.3 - Math.sqrt(CRACK_SUM_SQ) * 1.01];
		updateGlass(s);
		expect(s.glass[0].state).toBe(GlassState.Cracked);
		expect(sim.events.glass[0]).toMatchObject({ pane: 0, partType: 20, state: GlassState.Cracked });
		s.tags[0] = [0, 0.5, 2.3 - Math.sqrt(SMASH_SUM_SQ) * 1.01];
		updateGlass(s);
		expect(s.glass[0].state).toBe(GlassState.Smashed);
		expect(sim.events.glass[1]).toMatchObject({ state: GlassState.Smashed, crack: 0 });
	});

	it('jumps straight from intact to smashed, reports a smash once and never heals', () => {
		const sim = glassSim();
		const s = sim.state;
		s.tags[3] = [1, 0.5, 2.2 - 0.2];
		updateGlass(s);
		updateGlass(s);
		s.tags[3] = [1, 0.5, 2.2];
		updateGlass(s);
		expect(sim.events.glass.map((e) => e.state)).toEqual([GlassState.Smashed]);
		expect(s.glass[0].state).toBe(GlassState.Smashed);
	});

	it('re-reports a cracked pane every update and keeps the biggest crack', () => {
		const sim = glassSim();
		const s = sim.state;
		s.tags[4] = [0.5, 0.2, 2.2 - 0.02];
		updateGlass(s);
		s.tags[4] = [0.5, 0.2, 2.2 - 0.005];
		updateGlass(s);
		const cracks = sim.events.glass.map((e) => e.crack);
		expect(cracks).toHaveLength(2);
		expect(cracks[0]).toBeCloseTo(crackAmount(0.02), 9);
		expect(cracks[1]).toBeCloseTo(crackAmount(0.005), 9);
		expect(s.glass[0].crack).toBeCloseTo(crackAmount(0.02), 9);
	});

	it('reads a driven point for a corner whose flag is clear', () => {
		const sim = glassSim();
		const s = sim.state;
		s.driven[0] = [0, 0.8 + 0.2, 1.75];
		updateGlass(s);
		expect(s.glass[0].state).toBe(GlassState.Smashed);
	});

	it('eases the crack amount from 0 at 1 mm to 1 at 5 cm', () => {
		expect(crackAmount(0.0005)).toBe(0);
		expect(crackAmount(0.001)).toBe(0);
		expect(crackAmount(0.001 + 0.049 / 2)).toBeCloseTo(0.75, 9);
		expect(crackAmount(0.2)).toBe(1);
	});

	it('places the event corners at live point + corner offset in the world, and flags the pane slot', () => {
		const sim = glassSim();
		const s = sim.state;
		s.body.pos = [s.body.pos[0] + 10, s.body.pos[1], s.body.pos[2]];
		s.tags[3] = [1, 0.5, 2.0];
		updateGlass(s);
		const e = sim.events.glass[0];
		const [x, y, z] = specToWorld(s, [0, 0, 0]);
		expect(e.corners[0]).toEqual([x + 0.01, y + 0.5, z + 2.3]);
		expect(e.corners[1]).toEqual([x + 1, y + 0.5 + 0.02, z + 2.0]);
		expect(e.normal).toEqual([0, 0, 1]);
		expect(smashedPaneBits(s)).toBe(1 << 4);
	});

	it('runs inside a crash step after the IK update', () => {
		const sim = glassSim();
		applyImpact(sim, { pointMesh: [0, 0.5, 2.4], direction: [0, 0, -1], speed: 40, forceCrash: true });
		let broke = false;
		for (let i = 0; i < 120; i++) { stepCrashSim(sim); broke ||= sim.events.glass.length > 0; }
		expect(broke).toBe(true);
		expect(sim.state.glass[0].state).not.toBe(GlassState.Intact);
	});
});

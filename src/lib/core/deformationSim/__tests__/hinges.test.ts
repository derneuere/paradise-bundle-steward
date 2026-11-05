// Hinged panels: what their box meets in the world, when their joint breaks
// and the panel flies off, the random hinging a spinning wreck causes, and
// an invincible car keeping every part.

import { describe, expect, it } from 'vitest';
import type { IKPart, Vec3 } from '../../deformationSpec';
import { velocityAt } from '../../vehicleSim/body';
import { breakHinge, jointBreaks, updateHinges } from '../hinges';
import { updateIK } from '../ik';
import { boxCorners, partBox } from '../partBox';
import { checkForDetachment, detachPart, updateSpinningDetachment } from '../parts';
import { meshToWorld } from '../pose';
import { add, PartState, type SimState } from '../state';
import { AbsorptionSet } from '../tables';
import { makeSim } from './fixture';

const DT = 1 / 60;
const DOOR = 1, DOOR_HINGE_TAG = 2;
const close = (a: readonly number[], b: readonly number[], d = 9) => b.forEach((x, i) => expect(a[i]).toBeCloseTo(x, d));

function setBox(part: IKPart, lo: Vec3, hi: Vec3): void {
	let k = 0;
	for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
		part.cornerSkin[k++] = { vertex: [x, y, z, 0], weights: [0, 0, 0], boneIndices: [0, 0, 0] };
	}
}

function hingedDoor(opts: { rot?: number; stress?: number; threshold?: number } = {}): SimState {
	const s = makeSim().state;
	setBox(s.spec.ikParts[DOOR], [0.95, 0.2, 1.4], [1.05, 0.8, 2.2]);
	if (opts.threshold !== undefined) s.spec.ikParts[DOOR].jointSpecs[0].jointDetachThreshold = opts.threshold;
	detachPart(s, DOOR, DOOR_HINGE_TAG);
	const h = s.hinges.get(DOOR)!;
	h.rot = opts.rot ?? -0.5;
	h.limitStress = opts.stress ?? 0;
	return s;
}

describe('a new hinge', () => {
	it('starts closed and still, its anchor at rest', () => {
		const s = makeSim().state;
		s.body.v = [0, 0, 20];
		detachPart(s, DOOR, DOOR_HINGE_TAG);
		const h = s.hinges.get(DOOR)!;
		expect([h.rot, h.vel, ...h.storedVel, h.limitStress]).toEqual([0, 0, 0, 0, 0, 0]);
	});
});

describe('hinged panel contacts', () => {
	it('measures how far the car\'s motion drives the panel\'s box into the road, and the joint stress from it', () => {
		const s = hingedDoor({ rot: 0 });
		const box = partBox(s, DOOR);
		const low = () => Math.min(...boxCorners(box).map((c) => meshToWorld(s, add(box.centre, c))[1]));
		s.body.pos[1] -= low() - 0.02;      // the door's lowest corner 2 cm above the road
		updateHinges(s, DT);                // remembers this pose
		s.body.pos[1] -= 0.05;              // the car sinks 5 cm
		updateHinges(s, DT);
		const h = s.hinges.get(DOOR)!;
		close(h.pen, [0, -0.03, 0], 6);
		expect(h.limitStress).toBeCloseTo(0.06, 6);
		expect(h.contact).not.toBeNull();
	});

	it('finds nothing when the panel stays clear of the world', () => {
		const s = hingedDoor();
		updateHinges(s, DT);
		updateHinges(s, DT);
		const h = s.hinges.get(DOOR)!;
		expect([...h.pen, h.limitStress]).toEqual([0, 0, 0, 0]);
		expect(h.contact).toBeNull();
	});
});

describe('joint breaking', () => {
	it('breaks when 1.5 x the joint stress beats the threshold, the panel leaving with its centre\'s velocity and the car\'s spin', () => {
		const s = hingedDoor({ stress: 0.6, threshold: 0.8 });
		s.body.w = [0, 1.5, 0];
		s.body.v = [0, 0, 8];
		const box = partBox(s, DOOR);
		expect(jointBreaks(s, DOOR)).toBe(true);
		checkForDetachment(s);
		expect(s.partState[DOOR]).toBe(PartState.Detached);
		expect(s.hinges.has(DOOR)).toBe(false);
		const f = s.free.get(DOOR)!;
		close(f.spin, s.body.w);
		close(f.vel, velocityAt(s.body, f.pos));
		close(f.origin, box.centre);
		expect(s.events.parts.at(-1)?.state).toBe('detached');
	});

	it('holds below the stress, below 30 % open, and on a joint whose threshold is -0.9 or less', () => {
		expect(jointBreaks(hingedDoor({ stress: 0.5, threshold: 0.8 }), DOOR)).toBe(false);
		expect(jointBreaks(hingedDoor({ stress: 5, threshold: 0.8, rot: -0.2 }), DOOR)).toBe(false);
		expect(jointBreaks(hingedDoor({ stress: 50, threshold: -0.9 }), DOOR)).toBe(false);
	});

	it('breaks on the car\'s speed along the hinge axis only while something presses along that axis', () => {
		const s = hingedDoor({ threshold: 0.8 });
		s.body.v = [0, 2.5, 0];   // the door's hinge axis is the car's up: 0.4 x 2.5 = 1.0
		const h = s.hinges.get(DOOR)!;
		h.pen = [0.02, 0, 0];
		expect(jointBreaks(s, DOOR)).toBe(false);
		h.pen = [0, -0.02, 0];
		expect(jointBreaks(s, DOOR)).toBe(true);
	});

	it('never breaks a bonnet, and holds a toughened panel outside its impulse band', () => {
		const bonnet = hingedDoor({ stress: 5 });
		bonnet.spec.ikParts[DOOR].partType = 3;
		expect(jointBreaks(bonnet, DOOR)).toBe(false);
		const wing = hingedDoor({ stress: 5 });
		wing.spec.ikParts[DOOR].partType = 26;
		expect(jointBreaks(wing, DOOR)).toBe(false);
		wing.latch[0] = 800;
		expect(jointBreaks(wing, DOOR)).toBe(true);
		wing.latch[0] = 1300;
		expect(jointBreaks(wing, DOOR)).toBe(false);
	});

	it('is not asked of a car that has shed its 20 parts', () => {
		const s = hingedDoor({ stress: 5 });
		s.physicalParts = 20;
		checkForDetachment(s);
		expect(s.partState[DOOR]).toBe(PartState.Hinged);
		breakHinge(s, DOOR);
		expect(s.free.has(DOOR)).toBe(true);
	});
});

describe('spinning wreck', () => {
	const spin = (w: Vec3, seconds: number, crashing = true) => {
		const sim = makeSim({ crashing }), s = sim.state;
		s.body.w = w;
		let hingedAt = -1;
		for (let i = 0; i < seconds * 60 && hingedAt < 0; i++) {
			updateSpinningDetachment(s, DT);
			if (s.partState[DOOR] === PartState.Hinged) hingedAt = i;
		}
		return { s, hingedAt };
	};

	it('hinges an attached jointed panel once it has spun long enough, the same way every run', () => {
		const a = spin([0, 8, 0], 4), b = spin([0, 8, 0], 4);
		expect(a.hingedAt).toBeGreaterThan(80);
		expect(a.hingedAt).toBe(b.hingedAt);
		expect(a.s.hinges.get(DOOR)?.tag).toBe(DOOR_HINGE_TAG);
		expect(a.s.spinSum).toBe(0);
	});

	it('needs about 4.9 rad/s of spin held, and a crash', () => {
		expect(spin([3, 1, 0.5], 20).hingedAt).toBe(-1);
		expect(spin([0, 8, 0], 20, false).hingedAt).toBe(-1);
		expect(spin([0, 8, 0], 1, false).s.spinSum).toBe(0);
	});
});

describe('invincible car', () => {
	it('sheds nothing, however hard it is hit', () => {
		const sim = makeSim(), s = sim.state;
		s.absorptionSet = AbsorptionSet.Invincible;
		s.sensors[0] = [0, 0.5, 1.9];
		updateIK(s);
		s.latch[0] = 900;
		checkForDetachment(s);
		expect(s.partState.filter((x) => x === PartState.Hinged || x === PartState.Detached)).toEqual([]);
		s.absorptionSet = AbsorptionSet.Normal;
		checkForDetachment(s);
		expect(s.partState[DOOR]).toBe(PartState.Hinged);
	});
});

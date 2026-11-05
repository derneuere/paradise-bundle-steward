// Panels leaving the car: the detachment test run before every IK step, the
// joint test for panels already hanging on a hinge, and the random hinging a
// spinning wreck causes. A hinged panel stays in the car's frame
// (hinges.ts); a part knocked clean off is a loose body in the world
// (freeParts.ts). At most 20 parts per car come loose, hinged ones included.

import type { Vec3 } from '../deformationSpec';
import { rotationMatrix, velocityAt } from '../vehicleSim/body';
import { launchVelocity, makeFreePart } from './freeParts';
import { breakHinge, jointBreaks, peakImpulse } from './hinges';
import { partBox } from './partBox';
import { meshShift, meshToWorld } from './pose';
import { RANDOM_SEED, randomUInt } from './random';
import { add, sub, PartState, type SimState } from './state';
import {
	AbsorptionSet, MAX_IMPULSE_FOR_DETACHMENT, MAX_IMPULSE_FOR_DETACHMENT_TOUGH, MAX_PHYSICAL_PARTS,
	MIN_IMPULSE_FOR_DETACHMENT, TOUGHENED_PARTS,
} from './tables';

export { hingePoint, updateHinges } from './hinges';
export { updateFreeParts } from './freeParts';
export { jointRotation, poseMatrix } from './rotation';

const NEVER_DETACH_SQUARED = 9995;
const BANDED_TYPES = new Set([1, 2, 3]);
const EXHAUSTS = new Set([84, 85]);
// The spin sum (|wx| + |wy| + |wz| integrated while crashing, losing 1 % a
// step) at which a spinning wreck hinges one more panel: about 4.9 rad/s held.
const SPIN_SUM_FOR_DETACHMENT = 8;
const SPIN_SUM_DECAY = 0.99;
const SPIN_PART_DRAWS = 20;

export function initialPartState(s: SimState, p: number): PartState {
	const part = s.spec.ikParts[p];
	const tags = s.spec.tagPoints.slice(part.startIndexOfTagPoints, part.startIndexOfTagPoints + part.numberOfTagPoints);
	return tags.some((t) => t.fDetachThresholdSquared < NEVER_DETACH_SQUARED) ? PartState.AttachedIK : PartState.NonDetachable;
}

// The loose-part bookkeeping a fresh car starts with.
export const initialLooseState = (): Pick<SimState, 'spinSum' | 'random' | 'wheelTwistLimit' | 'brokenWheels' | 'looseWheels' | 'prevCar'> => ({
	spinSum: 0, random: RANDOM_SEED, wheelTwistLimit: [0, 0, 0, 0], brokenWheels: 0, looseWheels: [], prevCar: null,
});

// A part comes loose once one of its tag points has been pushed further than
// its detach threshold. If it has a jointed tag it hinges on the least
// deformed one, otherwise it flies off. Bumpers, the bonnet and parts with
// no joint also need the impulse that hit them to sit in the detach band.
// A hinged panel is asked whether its joint breaks (unless it is the car's
// last exhaust). An invincible car sheds nothing.
export function checkForDetachment(s: SimState): void {
	if (s.physicalParts >= MAX_PHYSICAL_PARTS || s.absorptionSet === AbsorptionSet.Invincible || !s.spec.ikParts.length) return;
	s.spec.ikParts.forEach((part, p) => {
		if (s.partState[p] === PartState.Hinged) {
			if (EXHAUSTS.has(part.partType) && s.attachedExhausts <= 1) return;
			if (!jointBreaks(s, p)) return;
			breakHinge(s, p);
			s.spinSum = 0;
			s.partState[p] = PartState.Detached;
			if (EXHAUSTS.has(part.partType)) s.attachedExhausts--;
			return;
		}
		if (s.partState[p] !== PartState.AttachedIK) return;
		let largest = -Infinity, smallest = Infinity, candidate = -1;
		for (let k = 0; k < part.numberOfTagPoints; k++) {
			const i = part.startIndexOfTagPoints + k;
			const spec = s.spec.tagPoints[i];
			const d = sub(s.tags[i], spec.initialPosition);
			const excess = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] - spec.fDetachThresholdSquared;
			largest = Math.max(largest, excess);
			if (excess < smallest && spec.jointIndex !== -1) { smallest = excess; candidate = k; }
		}
		if (largest <= 0) return;
		if (candidate === -1 || BANDED_TYPES.has(part.partType)) {
			const peak = peakImpulse(s, p);
			const max = TOUGHENED_PARTS.has(part.partType) ? MAX_IMPULSE_FOR_DETACHMENT_TOUGH : MAX_IMPULSE_FOR_DETACHMENT;
			if (!(MIN_IMPULSE_FOR_DETACHMENT <= peak && peak <= max)) return;
		}
		detachPart(s, p, candidate === -1 ? -1 : part.startIndexOfTagPoints + candidate);
	});
}

// Hinges the part on `hingeTag` (a spec tag index), or with -1 knocks it off.
// A knocked-off part leaves with the car's velocity plus the car's spin
// across the arm to the part's origin, and the car's spin. A new hinge starts
// closed and still.
export function detachPart(s: SimState, p: number, hingeTag: number): void {
	const part = s.spec.ikParts[p];
	const hinge = hingeTag !== -1;
	if (s.physicalParts >= MAX_PHYSICAL_PARTS) return;
	s.spinSum = 0;
	if (part.partGraphics === -1) return;
	if (s.attachedExhausts <= 1 && EXHAUSTS.has(part.partType) && !hinge) return;
	s.physicalParts++;
	const origin: Vec3 = [part.graphicsTransform[3][0], part.graphicsTransform[3][1], part.graphicsTransform[3][2]];
	const pos = meshToWorld(s, origin), vel = velocityAt(s.body, pos);
	s.events.parts.push({ part: p, gfx: part.partGraphics, partType: part.partType, state: hinge ? 'hinged' : 'detached', pos, vel });
	if (hinge) {
		s.partState[p] = PartState.Hinged;
		s.hinges.set(p, {
			joint: s.spec.tagPoints[hingeTag].jointIndex, tag: hingeTag, rot: 0, vel: 0, storedVel: [0, 0, 0],
			pen: [0, 0, 0], contact: null, limitStress: 0,
		});
		return;
	}
	s.partState[p] = PartState.Detached;
	if (EXHAUSTS.has(part.partType)) s.attachedExhausts--;
	const box = partBox(s, p);
	const arm = sub(add(origin, meshShift(s.spec)), s.com);
	s.free.set(p, makeFreePart(box, rotationMatrix(s.body), meshToWorld(s, box.centre), launchVelocity(s.body.v, s.body.w, arm), [...s.body.w] as Vec3));
}

// The (k+1)-th part still attached that has joints, or -1.
function attachedJointedPart(s: SimState, k: number): number {
	for (let p = 0; p < s.spec.ikParts.length; p++) {
		if (s.partState[p] === PartState.AttachedIK && s.spec.ikParts[p].jointSpecs.length && k-- === 0) return p;
	}
	return -1;
}

// While crashing, the car's spin adds up; past the threshold a random
// attached jointed panel is hinged on a random joint, and the sum restarts.
export function updateSpinningDetachment(s: SimState, dt: number): void {
	if (!s.vehicle.crashing) { s.spinSum = 0; return; }
	const w = s.body.w;
	s.spinSum = (s.spinSum + (Math.abs(w[0]) + Math.abs(w[1]) + Math.abs(w[2])) * dt) * SPIN_SUM_DECAY ** (dt * 60);
	if (!(s.spinSum > SPIN_SUM_FOR_DETACHMENT)) return;
	const p = attachedJointedPart(s, randomUInt(s) % SPIN_PART_DRAWS);
	if (p === -1) return;
	const part = s.spec.ikParts[p];
	const joint = randomUInt(s) % part.jointSpecs.length;
	for (let k = 0; k < part.numberOfTagPoints; k++) {
		const i = part.startIndexOfTagPoints + k;
		if (s.spec.tagPoints[i].jointIndex === joint) { detachPart(s, p, i); break; }
	}
	s.spinSum = 0;
}

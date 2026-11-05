// The wheels follow the body's deformation: on every step the car dents,
// each wheel still on the car is seated on its tag point (its hub takes the
// tag's x and z and keeps its own suspension height), so a crushed nose
// pushes the front wheels back with it. While the car is crashing:
//
// - a wheel whose tag has been pushed past its detach threshold is twisted:
//   it locks (spin 0) and gets a random twist limit up to 1.57 rad;
// - a twisted wheel leans by 8 x (offset^2 - threshold^2), up to its limit;
//   pushed past the limit while the car still moves faster than 8.94 m/s
//   (20 mph), it comes off and rolls away on its own: a loose wheel with the
//   car's velocity and the wheel's spin about the axle.

import { rotationMatrix, toWorld, toWorldDir } from '../vehicleSim/body';
import { makeLooseWheel } from './freeParts';
import { randomFloat } from './random';
import { dot, sub, type SimState } from './state';

const MAX_TWIST_ANGLE = 1.57;
const MIN_SPEED_FOR_DETACH = 8.9408;
const TWIST_GAIN = 8;

export function updateWheelTags(s: SimState): void {
	const v = s.vehicle;
	s.spec.wheels.forEach((spec, i) => {
		const w = v.wheels[i], t = spec.iValue;
		if (!w || w.detached || t < 0 || t >= s.tags.length) return;
		const tag = s.tags[t], tagSpec = s.spec.tagPoints[t];
		w.pos[0] = tag[0] - s.com[0];
		w.pos[2] = tag[2] - s.com[2];
		if (!v.crashing) return;
		const d = sub(tag, tagSpec.initialPosition);
		const past = dot(d, d) - tagSpec.fDetachThresholdSquared;
		if (!w.twisted) {
			if (past > 0) {
				w.twisted = true;
				w.omega = 0;
				s.wheelTwistLimit[i] = randomFloat(s) * MAX_TWIST_ANGLE;
				s.brokenWheels++;
			}
			return;
		}
		const amount = past * TWIST_GAIN, limit = s.wheelTwistLimit[i];
		w.twistAmount = Math.min(Math.max(amount, 0), limit);
		if (!(amount > limit && v.speedMag > MIN_SPEED_FOR_DETACH)) return;
		w.detached = true;
		const side = w.pos[0] > 0 ? 1 : -1;
		s.looseWheels.push(makeLooseWheel(
			i, spec.direction[1] / 2, spec.direction[0] / 2, rotationMatrix(s.body), toWorld(s.body, w.pos),
			s.body.v, toWorldDir(s.body, [side * w.omega, 0, 0]),
		));
	});
}

// The steering rack: the pad's steering value slews toward its target at a
// speed-dependent rate and sets the front wheels' angle, nothing else (the
// tyres turn that into force). The lock angle shrinks with speed from
// MaxAngle at 30 mph toward MinAngle near MaxSpeed. The drift-only parts
// (drift steer scale) are inert because this port never enters a drift.

import type { Vec3 } from '../deformationSpec';
import { add, cross, dot, normalize, scale } from '../deformationSim/state';
import type { VehicleState } from './vehicleState';

const DEG = 0.01745329238474369;
const RAD = 57.295780181884766;
const HALF_DEG = 0.5 * DEG;
const LOW_SPEED_MPH = 30;
const OVERSTEER = 1.5;

// At rotated about Up by `angle` (right-hand rule, so a positive angle turns
// At toward Right). The wheel angle is minus the steering, so positive
// steering turns the front wheels toward the car's left.
export function steeredDirection(up: Vec3, at: Vec3, angle: number): Vec3 {
	const s = Math.sin(angle), c = Math.cos(angle);
	return add(add(scale(at, c), scale(cross(up, at), s)), scale(up, (1 - c) * dot(up, at)));
}

// The widest angle a sliding rear allows the fronts to chase the slide.
function maxAngleDuringDrift(v: VehicleState): number {
	const b = v.body, u = normalize(b.v);
	const along = Math.min(Math.max(dot(u, b.axes[2]), -1), 1);
	const r = Math.min(Math.acos(along) * Math.abs(v.steering) * 1.5, v.params.steering.maxAngleDeg * DEG);
	return dot(u, b.axes[0]) < 0 ? -r : r;
}

export function updateSteering(v: VehicleState, steeringIn: number, gas: number, dt: number): void {
	const st = v.params.steering;
	const maxRad = st.maxAngleDeg * DEG;
	v.prevSteering = v.steering;
	let eff = v.speedMph;
	if (!(-5 > eff && v.handBrake)) eff = Math.abs(eff) * (gas * 0.1 + 0.9);
	const rearSliding = v.wheels[2].broken && v.wheels[3].broken;
	const driftMax = maxAngleDuringDrift(v);
	const side = dot(v.body.v, v.body.axes[0]);
	const current = v.maxSteerDeg * DEG;
	let maxDeg: number;
	if (rearSliding && Math.abs(driftMax) > Math.abs(current) && 0 > side * steeringIn) {
		maxDeg = Math.min(current + HALF_DEG, Math.abs(driftMax)) * RAD;
	} else if (Math.abs(current) > Math.abs(maxRad)) {
		maxDeg = (current - HALF_DEG) * RAD;
	} else if (LOW_SPEED_MPH > eff) {
		maxDeg = st.maxAngleDeg;
	} else {
		const maxSpeed = v.params.base.maxSpeedMph;
		const t1 = Math.pow(1 / (maxSpeed + 1), 0.1);
		const inner = (eff - LOW_SPEED_MPH) * (maxSpeed / (maxSpeed - LOW_SPEED_MPH)) + 1;
		const t2 = Math.pow(1 / inner, 0.1);
		const frac = Math.min(Math.max((t2 - t1) / (1 - t1), 0), 1);
		maxDeg = (st.maxAngleDeg - st.minAngleDeg) * frac + st.minAngleDeg;
	}
	v.maxSteerDeg = maxDeg;

	const deficit = maxDeg - Math.abs(v.steerAngle) * RAD;
	let step = st.reactionPerSec * dt * Math.exp(deficit / maxDeg) * maxDeg;
	step = Math.min(Math.max(step, -st.minAngleDeg), st.minAngleDeg) / maxDeg;
	const prev = v.prevSteering;
	const returning = prev > 0 ? prev > steeringIn : steeringIn > prev;
	if (returning) step *= st.straightReactionBias;
	const delta = Math.min(Math.max(steeringIn - prev, -step), step);
	v.prevSteering = prev + delta;
	v.steering = Math.min(Math.max(v.prevSteering, -1), 1);
	v.steerAngle = v.steering * -(OVERSTEER * maxDeg * DEG);
}

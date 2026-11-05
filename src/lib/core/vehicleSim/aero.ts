// Aerodynamics: a speed-squared "downforce" that only widens the tyres'
// friction cone, an extra push into the road while sliding or airborne, and a
// speed-squared linear drag on the ground. The game's own unit mixes (m/s
// over mph in the airborne ratio) are kept.

import { dot, length, normalize, scale } from '../deformationSim/state';
import { addForceAt, addWorldForce } from './body';
import type { VehicleState } from './vehicleState';

const EPS = 1.1920928955078125e-7;

// 0.5 * 6.1 * 1.225 * |v|^2 * lift coefficient.
export function downForce(v: VehicleState): number {
	return 0.5 * 6.1 * 1.225 * dot(v.body.v, v.body.v) * v.params.base.downForceLiftCo;
}

// Driving only. Airborne: a pull down scaled by planar speed. On the ground:
// world-down downforce scaled by how far the car is pitched or sliding, so
// close to zero in a straight line on the flat.
export function updateDownForce(v: VehicleState): void {
	const b = v.body, base = v.params.base;
	if (v.hasAir) {
		const planar = Math.hypot(b.v[0], b.v[2]);
		const ratio = Math.max(0.3, planar / base.maxSpeedMph) / 0.3;
		addForceAt(b, [0, -v.params.mass * base.downForce * ratio, 0], 'world', [0, 0, 0], 'body');
		return;
	}
	let s = 1;
	if (Math.abs(b.v[0]) > EPS || Math.abs(b.v[1]) > EPS || Math.abs(b.v[2]) > EPS) {
		s = 20 * (Math.abs(b.axes[2][1]) + Math.abs(dot(normalize(b.v), b.axes[0])));
	}
	addWorldForce(b, [0, -downForce(v) * s, 0]);
}

// F = -d |v| v, driving and on the ground only; a surface's own drag adds in
// when all four wheels are down.
export function applyLinearDrag(v: VehicleState): void {
	const b = v.body, P = v.params;
	let d = P.base.linearDrag;
	if (v.allWheelsOnGround) {
		const surf = v.wheels.reduce((s, w) => s + w.contact.surface.linearDrag, 0) / 4;
		d += surf * P.base.surfaceDrag;
	}
	const speed = length(b.v);
	if (Math.abs(speed) > EPS) addWorldForce(b, scale(b.v, -d * speed));
}

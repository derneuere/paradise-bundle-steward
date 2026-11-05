// A stand-in for the contact side, just enough to crash a car into a post: a
// row of probe points across the car's nose against the post's flat front
// face (a square post, half-width `half`, its face at z = `face`). Contacts
// are predictive, like the game's swept sensor spheres: a probe that will
// reach the face within the step is in contact, and its impulse lets it
// arrive at the face but not pass it. It follows the step's hook contract;
// the real contact rules (sensor spheres, crush, friction) live with the
// deformation sim.

import type { Vec3 } from '../../deformationSpec';
import { dot } from '../../deformationSim/state';
import { drain, invEffectiveMass, toBodyDir, toWorld, translate, velocityAt } from '../body';
import { applyContactImpulse, type ArmContact } from '../crash';
import type { StepHooks } from '../step';
import type { VehicleState } from '../vehicleState';

const N: Vec3 = [0, 0, -1];

export function postHooks(post: { x: number; face: number; half: number }) {
	let contacts: ArmContact[] = [];
	const probes = (v: VehicleState): Vec3[] => {
		const { min, max } = v.params.aabb;
		return [0, 0.25, 0.5, 0.75, 1].map((t) => toWorld(v.body, [min[0] + 0.1 + t * (max[0] - min[0] - 0.2), 0, max[2] - 0.1]));
	};
	const inBand = (v: VehicleState, p: Vec3) => Math.abs(p[0] - post.x) < post.half && v.body.pos[2] < post.face;
	const hooks: StepHooks = {
		generateContacts: (v, _w, dt) => {
			contacts = probes(v).filter((p) => inBand(v, p) && p[2] + Math.max(velocityAt(v.body, p)[2], 0) * dt >= post.face)
				.map((p) => ({ pointA: p, pointB: [p[0], p[1], post.face] as Vec3, normal: N }));
		},
		crashArmContacts: () => contacts,
		updateContacts: (v, dt) => {
			for (const c of contacts) {
				const vn = dot(velocityAt(v.body, c.pointA), N);
				const allowed = -Math.max(post.face - c.pointA[2], 0) / dt;
				if (vn >= allowed) continue;
				const j = (allowed - vn) / invEffectiveMass(v.body, c.pointA, N);
				applyContactImpulse(v, toBodyDir(v.body, [0, 0, -j]), c.pointA, true, N);
				drain(v.body, dt);
			}
		},
		penetration: (v) => {
			const deepest = Math.max(0, ...probes(v).filter((p) => inBand(v, p)).map((p) => p[2] - post.face));
			if (deepest > 0) translate(v.body, [0, 0, -deepest]);
		},
	};
	return hooks;
}

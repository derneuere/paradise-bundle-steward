// One 60 Hz frame for the race car, in the game's order. Run it at exactly
// dt = 1/60: several rules are per step, not per second, and the tyre model
// is explicit and stiff.
//
//   A  hooks.generateContacts     world contacts from the START pose
//   B  traction lines             cast from the START pose
//   E  crash arm                  on hooks.crashArmContacts(); a crash entry
//                                 changes v and w HERE, before any force
//   G  vehicle update             wheel flags reset, above-ground ray,
//                                 traction points, then driving or crashing
//   H  hooks.updateContacts       contact impulses into the body; then drain
//   J  integrate                  gravity, then the pose (skipped when frozen)
//   K  post-simulation            traction lines re-cast from the NEW pose
//                                 (hits replace contacts, misses keep them),
//                                 then the suspension post-step
//   L  hooks.penetration          position-only correction
//   M  crash clock                ends the crash (the preview just stops)
//
// HOOK CONTRACT (the contact side implements these; all optional):
//
// Frames and units. World is +Y up, metres, m/s, kg, N, seconds. The body's
// origin is the CENTRE OF MASS, not the deformation spec's origin: a spec
// point p_spec sits at body-frame p_body = p_spec - params.comSpec, and at
// world toWorld(body, p_body) = body.pos + R * p_body, R's columns being
// body.axes (Right, Up, At). Impulses are N*s, world unless a call says body.
//
// generateContacts(v, world, dt)        step A, first thing in the frame.
//   Read the start pose (body.pos/axes/v/w) and the world; build and keep
//   this frame's contacts. Must not touch the body or vehicle state.
// crashArmContacts(v) -> ArmContact[]   step E, right after B.
//   The ordered world contacts the crash arm reads (the game keeps at most 5,
//   earliest first): pointA on the car, pointB on the world, normal out of
//   the world into the car, all world frame. Read-only.
// updateContacts(v, dt)                 step H, after the vehicle update.
//   The body's accumulators are empty and v.numWorldCollisions has just been
//   reset to 0 (so during G it still held last frame's count, as in the
//   game). Push each contact's impulse with applyContactImpulse (crash.ts:
//   counts world collisions, resets the wall timer, applies the knock rules)
//   or straight into the body with addImpulseAt/addWorldImpulse/
//   addWorldAngImpulse; read point velocity with velocityAt and effective
//   mass with invEffectiveMass. The game drains after each contact; the hook
//   may call drain(body, dt) freely, and the step drains once more after it.
//   v.crashing tells which rules apply. May grow v.aabb (the deformable box,
//   body frame). Must not move the pose or integrate.
// penetration(v, dt)                    step L, after integrate + post-sim.
//   Move body.pos only (translate); never v, w or the axes.

import { dot, scale } from '../deformationSim/state';
import { drain, integrate, toBody } from './body';
import { setCrashing, tickCrashClock, worldCrashArm, CRASH_THRESHOLDS, type ArmContact, type CrashKind, type CrashThresholds } from './crash';
import { addTractionPoint, calculateWheelPlane, castTractionLines, resetWheelFlags, setAboveGround, type LineHit, type World } from './ground';
import { postSimSuspension } from './suspension';
import { updateVehicle } from './vehicle';
import type { Controls, VehicleState } from './vehicleState';

export const DT = 1 / 60;

export type StepHooks = {
	generateContacts?: (v: VehicleState, world: World, dt: number) => void;
	crashArmContacts?: (v: VehicleState) => readonly ArmContact[];
	updateContacts?: (v: VehicleState, dt: number) => void;
	penetration?: (v: VehicleState, dt: number) => void;
};

export type StepOptions = {
	thresholds?: CrashThresholds;
	shortCrash?: boolean;
};

export type StepResult = { crashed: CrashKind | null; crashOver: boolean };

export function stepVehicle(v: VehicleState, world: World, dt: number, ctl: Controls, hooks: StepHooks = {}, opts: StepOptions = {}): StepResult {
	const b = v.body;
	hooks.generateContacts?.(v, world, dt);
	const lines = castTractionLines(v, world);

	let crashed: CrashKind | null = null;
	if (!v.crashing) {
		const crash = (c: ArmContact, kind: CrashKind) => {
			setCrashing(v, scale(c.normal, -1), toBody(b, c.pointA), opts.shortCrash);
			crashed = kind;
		};
		const ordered = hooks.crashArmContacts?.(v) ?? [];
		for (const c of ordered) {
			const kind = worldCrashArm(v, c, dt, opts.thresholds ?? CRASH_THRESHOLDS).kind;
			if (kind) { crash(c, kind); break; }
		}
	}

	resetWheelFlags(v);
	setAboveGround(v, world.aboveGround(b.pos));
	lines.forEach((hit, i) => { if (hit) addTractionPoint(v, i, hit); });
	updateVehicle(v, ctl, dt);

	v.numWorldCollisions = 0;
	hooks.updateContacts?.(v, dt);
	drain(b, dt);

	if (!v.frozen) integrate(b, dt);

	postSimTractionLines(v, world, dt);
	postSimSuspension(v, dt);
	hooks.penetration?.(v, dt);

	let crashOver = false;
	if (v.crashing && v.crashClock) crashOver = tickCrashClock(v.crashClock, v.speedMph, b.w, dt);
	return { crashed, crashOver };
}

// The player's lines again from where the body ended up, the start lifted by
// this step's sink so a fast-falling car still finds the road it sank into.
function postSimTractionLines(v: VehicleState, world: World, dt: number): void {
	const up = v.body.axes[1];
	const sink = -dot(v.body.v, up);
	const hits: (LineHit | null)[] = castTractionLines(v, world, sink > 0 ? scale(up, sink * dt) : [0, 0, 0]);
	hits.forEach((hit, i) => { if (hit) addTractionPoint(v, i, hit); });
	calculateWheelPlane(v);
}


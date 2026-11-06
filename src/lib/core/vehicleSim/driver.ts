// The Crash Preview's driver. The game has no cruise control: it starts a car
// by setting its velocity (resetVehicle, which also spins the wheels up and
// picks the gear) and the player drives it with the throttle pinned. At
// MaxSpeed the engine cut holds the car there; below it the car keeps
// accelerating, so the impact speed is the start speed plus whatever the
// run-up adds. During a crash the game keeps reading the pad (the engine sees
// half the gas); holding the throttle keeps the wreck from ever freezing,
// releasing it lets the wreck freeze a second after it goes quiet.

import type { Vec3 } from '../deformationSpec';
import { normalize } from '../deformationSim/state';
import type { VehicleParams } from './params';
import { resetVehicle } from './vehicle';
import { NO_INPUT, type Controls, type VehicleState } from './vehicleState';

export const FULL_THROTTLE: Controls = { ...NO_INPUT, gas: 1 };

export type CrashInput = 'hold' | 'release';

export const crashControls = (driving: Controls, mode: CrashInput): Controls =>
	mode === 'hold' ? driving : NO_INPUT;

// Centre-of-mass height that puts the highest-riding axle's tyres on flat
// ground; the springs settle the rest within a few steps.
export const restHeight = (p: VehicleParams) => Math.max(...p.wheels.map((w) => w.radius - w.streamed[1]));

// Where the springs hold the car on flat ground: both axles' hubs at their
// streamed height, one tyre radius above the road. A car whose axles ride at
// different heights or on different tyres sits pitched; `pitch` turns the
// nose up (radians, about the car's right axis).
export function restPose(p: VehicleParams): { height: number; pitch: number } {
	const f = p.wheels[0], r = p.wheels[2];
	const dy = f.streamed[1] - r.streamed[1], dz = f.streamed[2] - r.streamed[2];
	let th = 0;
	for (let i = 0; i < 20; i++) {
		const g = dy * Math.cos(th) + dz * Math.sin(th) - (f.radius - r.radius);
		th -= g / (-dy * Math.sin(th) + dz * Math.cos(th));
	}
	return { height: f.radius - f.streamed[1] * Math.cos(th) - f.streamed[2] * Math.sin(th), pitch: th };
}

// Body axes (Right, Up, At) for a car heading along world +z, nose `pitch`
// radians up.
export const pitchedAxes = (pitch: number): [Vec3, Vec3, Vec3] =>
	[[1, 0, 0], [0, Math.cos(pitch), -Math.sin(pitch)], [0, Math.sin(pitch), Math.cos(pitch)]];

// Start the car moving at `speed` m/s along its heading, level with the
// ground.
export function startAtSpeed(v: VehicleState, speed: number): void {
	const at = v.body.axes[2];
	const dir = normalize([at[0], 0, at[2]]);
	resetVehicle(v, [dir[0] * speed, 0, dir[2] * speed]);
}

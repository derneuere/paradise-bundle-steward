// The Crash Preview's run: the car starts on its wheels at rest height on
// flat ground, facing world +z at the origin, and meets an obstacle placed in
// the world so that the hit point picked on the car (at rest, before the run)
// is what reaches it. How the car gets there depends on where the hit is:
//
// - drive: a hit on the front (its outward normal within 60° of the nose).
//   The car is started at the chosen speed along its heading, the way the
//   game spawns a moving car (resetVehicle), and drives the run-up with the
//   throttle pinned (a quarter second of travel, at least 1.5 m), so it
//   arrives a little faster than it started. The glance turns the obstacle's
//   face away from square to the car's travel.
// - slide: a side or rear hit, which no car drives into nose first. The car
//   is launched sideways (or backwards) along the hit direction off the
//   pedals, 0.3 m from the obstacle, so its tyres barely act before it
//   arrives; the glance turns the obstacle as above.
// - roof: a hit on top. The car starts upside down just above the ground,
//   sliding forward, and lands on its roof; there is no obstacle.
//
// The game decides the rest. Its crash test runs on each step's contacts: a
// head-on hit at 40.5 m/s or more of closing, a side hit at 50 m/s at the
// point, or a car rolled over onto upward-facing ground crashes; anything less
// is a knock, and the car keeps driving. A forced run crashes on the first
// obstacle contact instead, as the game's debug "force crash" does. Once the
// car has met the obstacle (or crashed), the pedals do what `crashInput` says:
// released (the default), the wreck freezes a second after it goes quiet;
// held, it keeps driving and only the crash clock (4 to 11.5 s) ends it. The
// run ends when the crash clock runs out, when the car freezes, or after 20 s.

import type { Vec3 } from '../deformationSpec';
import { toWorld, toWorldDir, updateWorldInertia } from '../vehicleSim/body';
import type { CrashKind } from '../vehicleSim/crash';
import { crashControls, FULL_THROTTLE, pitchedAxes, restPose, startAtSpeed, type CrashInput } from '../vehicleSim/driver';
import { flatGround } from '../vehicleSim/ground';
import { stepVehicle, type StepHooks } from '../vehicleSim/step';
import { resetVehicle } from '../vehicleSim/vehicle';
import { createVehicle, MPS_TO_MPH, NO_INPUT, type Controls } from '../vehicleSim/vehicleState';
import { clearContacts, collisionSpheres } from './contacts';
import { meshShift } from './pose';
import { updateDeformedBox } from './sensors';
import { add, dot, length, normalize, scale, sub, type Obstacle, type SimState } from './state';
import { GROUND_Y } from './world';

export type Launch = 'drive' | 'slide' | 'roof';
export type RunEnd = 'clock' | 'frozen' | 'timeout';

export type Impact = {
	pointMesh: Vec3;        // the picked point on the body, mesh frame
	direction: Vec3;        // unit, into the car at that point (the surface's inward normal), mesh frame
	speed: number;          // start speed, m/s
	obstacle?: 'wall' | 'pole';
	// Degrees the obstacle's face is turned off square to the car's travel.
	glance?: number;
	forceCrash?: boolean;
	crashInput?: CrashInput;
};

export type CrashRun = {
	launch: Launch;
	driving: Controls;          // the pedals before the car meets the obstacle
	crashInput: CrashInput;
	forceCrash: boolean;
	startSpeed: number;
	touched: boolean;           // the car has met the obstacle
	impactSpeed: number;        // the car's speed at its first obstacle contact
	closingSpeed: number;       // the car's speed into the obstacle's face then
	crash: CrashKind | null;    // why the game crashed the car, null for a knock
	crashSpeed: number;         // the car's speed when it crashed
	elapsed: number;
	end: RunEnd | null;
};

const WORLD = flatGround(GROUND_Y);
const FRONT_COS = 0.5;
const ROOF_UP = 0.8;
const RUN_UP_TIME = 0.25;
const MIN_RUN_UP = 1.5;
const SLIDE_GAP = 0.3;
const CLEARANCE = 0.1;
const ROOF_DROP = 0.2;
const POLE_RADIUS = 0.15;
const MAX_RUN_TIME = 20;

const rotateY = (v: Vec3, deg: number): Vec3 => {
	const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
	return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
};
const flat = (v: Vec3): Vec3 => normalize([v[0], 0, v[2]]);

export function launchFor(outward: Vec3): Launch {
	if (outward[1] > ROOF_UP) return 'roof';
	const h = flat(outward);
	return length(h) === 0 || h[2] >= FRONT_COS ? 'drive' : 'slide';
}

// A fresh vehicle (wheels, engine and timers at rest) in the car's rest pose
// at the origin; the deformation (sensors, parts, glass) is kept.
export function placeAtRest(s: SimState): void {
	const P = s.vehicle.params, rest = restPose(P);
	s.vehicle = createVehicle(P, [0, GROUND_Y + rest.height, 0]);
	s.body = s.vehicle.body;
	s.body.axes = pitchedAxes(rest.pitch);
	updateWorldInertia(s.body);
	updateDeformedBox(s);
}

function placeUpsideDown(s: SimState): void {
	const b = s.body;
	b.axes = [[-1, 0, 0], [0, -1, 0], [0, 0, 1]];
	updateWorldInertia(b);
	b.pos = [0, GROUND_Y, 0];
	const lowest = Math.min(...collisionSpheres(s).map(({ centre, radius }) => centre[1] - radius));
	b.pos = [0, GROUND_Y - lowest + ROOF_DROP, 0];
}

// The plane offset (along `facing`) that puts the picked point `travel`
// metres from the wall along the car's travel `u`, with every collision
// sphere at least CLEARANCE short of it.
function wallAt(s: SimState, picked: Vec3, u: Vec3, facing: Vec3, travel: number): Obstacle {
	let d = dot(add(picked, scale(u, travel)), facing);
	for (const { centre, radius } of collisionSpheres(s)) d = Math.max(d, dot(centre, facing) + radius + CLEARANCE);
	const t = (d - dot(picked, facing)) / dot(u, facing);
	return { kind: 'wall', point: add(picked, scale(u, t)), normal: facing, poleAxis: [0, 1, 0], poleRadius: POLE_RADIUS };
}

// A vertical pole whose face meets the picked point after `travel` metres,
// moved on in 5 cm steps until no collision sphere starts against it.
function poleAt(s: SimState, picked: Vec3, u: Vec3, facing: Vec3, travel: number): Obstacle {
	const spheres = collisionSpheres(s);
	let point = add(picked, scale(u, travel));
	for (let i = 0; i < 400; i++) {
		const axis = add(point, scale(facing, POLE_RADIUS));
		const clear = spheres.every(({ centre, radius }) => length(flat3(sub(centre, axis))) >= radius + POLE_RADIUS + CLEARANCE);
		if (clear) break;
		point = add(point, scale(u, 0.05));
	}
	return { kind: 'pole', point, normal: facing, poleAxis: [0, 1, 0], poleRadius: POLE_RADIUS };
}
const flat3 = (v: Vec3): Vec3 => [v[0], 0, v[2]];

// Starts a run: the car (in its current deformed shape) is put back at rest
// at the origin, set moving, and the obstacle is placed in front of the hit.
export function startRun(s: SimState, impact: Impact): CrashRun {
	placeAtRest(s);
	clearContacts(s);
	const outward = normalize(scale(impact.direction, -1));
	const launch = launchFor(outward);
	const b = s.body;
	const pickedBody = sub(add(impact.pointMesh, meshShift(s.spec)), s.com);
	const glance = impact.glance ?? 0;
	s.obstacle = null;
	if (launch === 'roof') {
		placeUpsideDown(s);
		resetVehicle(s.vehicle, [0, 0, impact.speed]);
	} else if (launch === 'drive') {
		startAtSpeed(s.vehicle, impact.speed);
		const u: Vec3 = [0, 0, 1];
		const travel = Math.max(MIN_RUN_UP, impact.speed * RUN_UP_TIME);
		s.obstacle = place(s, impact.obstacle, toWorld(b, pickedBody), u, rotateY(u, glance), travel);
	} else {
		const u = flat(toWorldDir(b, flat(outward)));
		resetVehicle(s.vehicle, scale(u, impact.speed));
		s.obstacle = place(s, impact.obstacle, toWorld(b, pickedBody), u, rotateY(u, glance), SLIDE_GAP);
	}
	updateDeformedBox(s);
	// The speeds the vehicle caches at the end of each update, as a car that
	// had been moving like this would hold them; the contact checks of the
	// first step read them.
	const v = s.vehicle;
	v.speedMag = length(b.v);
	v.speedMph = dot(b.v, b.axes[2]) * MPS_TO_MPH;
	s.run = {
		launch, driving: launch === 'drive' ? FULL_THROTTLE : NO_INPUT,
		crashInput: impact.crashInput ?? 'release', forceCrash: impact.forceCrash ?? false, startSpeed: impact.speed,
		touched: false, impactSpeed: 0, closingSpeed: 0, crash: null, crashSpeed: 0, elapsed: 0, end: null,
	};
	return s.run;
}

const place = (s: SimState, kind: Impact['obstacle'], picked: Vec3, u: Vec3, facing: Vec3, travel: number) =>
	(kind === 'pole' ? poleAt : wallAt)(s, picked, u, facing, travel);

// One step of the run through the vehicle's frame (see vehicleSim/step.ts),
// with the contact side as its hooks.
export function stepRun(s: SimState, run: CrashRun, hooks: StepHooks, dt: number): void {
	const v = s.vehicle;
	const ctl = v.crashing || run.touched ? crashControls(run.driving, run.crashInput) : run.driving;
	const startVel = v.body.v;
	const r = stepVehicle(v, WORLD, dt, ctl, hooks, { forceCrash: run.forceCrash });
	run.elapsed += dt;
	if (r.crashed) {
		run.crash = r.crashed;
		run.crashSpeed = v.speedOnLastCrashMph / MPS_TO_MPH;
	}
	for (const c of s.events.contacts) {
		if (c.surface !== 'obstacle' || run.touched) continue;
		run.touched = true;
		run.impactSpeed = length(startVel);
		run.closingSpeed = Math.max(-dot(c.normal, startVel), 0);
	}
	if (r.crashOver) run.end = 'clock';
	else if (v.frozen) run.end = 'frozen';
	else if (run.elapsed >= MAX_RUN_TIME) run.end = 'timeout';
}

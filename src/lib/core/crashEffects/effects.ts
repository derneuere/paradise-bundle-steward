// Crash particle effects, driven by the crash simulator's per-step events the
// way the game drives its own: call stepCrashEffects right after every
// stepCrashSim. Everything lives in the simulator's world frame and draws
// only from one seeded random stream, so a crash replays identically.
//
// What fires when (all only while the car is crashing, not on a knock):
// - a spark shower from a contact sliding faster than 15 mph across the
//   surface (head-on hits throw none), at most one per 0.02 - 0.15 s;
// - a debris burst from any contact, at most every 0.18 s, sized by the car's
//   speed (nothing below 5 m/s);
// - dust from the contact point, 2.5 puffs per metre the car travels while
//   touching the obstacle above 5 m/s;
// - a trail of debris, glass bits and smoke shed along the car's path above
//   8 m/s;
// - a shower of glass pieces from each window that smashes (a crack throws
//   nothing).
// A part coming off fires nothing of its own: the part is the debris.

import type { Vec3 } from '../deformationSpec';
import type { CrashSim, GlassEvent } from '../deformationSim';
import { GlassState } from '../deformationSim';
import { add, cross, length, scale, sub } from '../deformationSim/state';
import { mul3 } from '../deformationSim/parts';
import { AbsorptionSet } from '../deformationSim/tables';
import { makeDebris, stepDebris, upCone, type Debris, type Plane } from './debris';
import { makePuff, type Puff } from './puffs';
import { Pool } from './pool';
import { makeRng, type Rng } from './random';
import { spawnShower, type Spark } from './sparks';
import {
	AI_TRAIL, BURST, BURST_BOX, BURST_CONE, BURST_COOLDOWN, BURST_ORIGIN_LIFT, burstScale, DEBRIS_KINDS, DEBRIS_PRESETS,
	DebrisKind, DUST, DUST_BOX, DUST_INHERIT, DUST_MIN_SPEED, DUST_PER_METRE, DUST_SIZE, DUST_VELOCITY, GLASS_INHERIT,
	GLASS_OUTWARD, GLASS_PER_SQ_M, GLASS_RADIAL, GLASS_SIZE, GLASS_SPEED_CAP, PLAYER_TRAIL, SMOKE,
	SPARK_COOLDOWN, SPARK_MIN_SLIDE, TRAIL_INHERIT, TRAIL_SPEED, TRAIL_SPREAD,
} from './tables';

export type CrashEffects = {
	readonly seed: number;
	rng: Rng;
	time: number;            // simulator seconds since the effects started
	paint: Vec3;             // the car's paint, for paint-coloured debris
	sparks: Pool<Spark>;
	debris: Pool<Debris>[];  // by DebrisKind
	dust: Pool<Puff>;
	smoke: Pool<Puff>;
	counter: number;         // particles spawned so far (picks per-index variants)
	debrisSpawned: number[]; // pieces spawned so far, by DebrisKind
	sparkCooldown: number;
	burstCooldown: number;
	dustCarry: number;
	trailCarry: number[];
	obstacle: unknown;       // the impact the particles belong to
	carPos: Vec3;
	groundY: number;
};

export function createCrashEffects(seed = 1): CrashEffects {
	return {
		seed, rng: makeRng(seed), time: 0, paint: [0.8, 0.2, 0.17],
		sparks: new Pool(4000),
		debris: DEBRIS_KINDS.map((k) => new Pool<Debris>(DEBRIS_PRESETS[k].budget)),
		dust: new Pool(DUST.budget), smoke: new Pool(SMOKE.budget),
		counter: 0, debrisSpawned: DEBRIS_KINDS.map(() => 0), sparkCooldown: 0, burstCooldown: 0, dustCarry: 0, trailCarry: PLAYER_TRAIL.map(() => 0),
		obstacle: null, carPos: [0, 0, 0], groundY: 0,
	};
}

export function resetCrashEffects(fx: CrashEffects): void {
	Object.assign(fx, { ...createCrashEffects(fx.seed), paint: fx.paint });
}

const U = (rng: Rng, r: readonly [number, number]) => rng.range(r[0], r[1]);
const inBox = (rng: Rng, min: Vec3, max: Vec3): Vec3 => [rng.range(min[0], max[0]), rng.range(min[1], max[1]), rng.range(min[2], max[2])];

export function stepCrashEffects(fx: CrashEffects, sim: CrashSim, dt: number): void {
	const s = sim.state, ev = sim.events, rng = fx.rng;
	fx.time += dt;
	fx.sparkCooldown = Math.max(fx.sparkCooldown - dt, 0);
	fx.burstCooldown = Math.max(fx.burstCooldown - dt, 0);
	fx.groundY = s.carPos[1] + sim.groundMesh + sim.meshShift[1];
	if (s.obstacle !== fx.obstacle) startImpact(fx, sim);

	// Contacts are sized by the speed the car hit with; anything thrown off
	// inherits the velocity it has once the step's contacts are resolved, so
	// nothing is flung through the obstacle the car just stopped against.
	const speed = length(ev.car.vel), vel = s.carVel, moving = length(vel);
	// The simulated car rests on its body's collision spheres rather than on
	// wheels, so its ground contacts would scrape on every hit; only the
	// obstacle's contacts throw effects.
	const hits = ev.contacts.filter((c) => c.surface === 'obstacle');
	if (s.crashing) {
		for (const c of hits) {
			if (length(c.slide) > SPARK_MIN_SLIDE && fx.sparkCooldown <= 0) {
				fx.counter += spawnShower({ origin: c.point, normal: c.normal, slide: c.slide, time: fx.time, groundY: fx.groundY, counter: fx.counter }, rng, (k) => fx.sparks.add(k));
				fx.sparkCooldown = SPARK_COOLDOWN.base + rng.next() * SPARK_COOLDOWN.random;
			}
			if (fx.burstCooldown <= 0 && burstScale(speed) > 0.01) {
				burst(fx, add(c.point, scale(c.normal, BURST_ORIGIN_LIFT)), vel, burstScale(speed));
				fx.burstCooldown = BURST_COOLDOWN;
			}
		}
		if (hits.length && speed > DUST_MIN_SPEED) dust(fx, hits[0].point, vel, speed * dt);
		trail(fx, sim, moving, dt);
		for (const g of ev.glass) if (g.state === GlassState.Smashed) glassBurst(fx, g);
	}

	const planes = obstaclePlanes(fx, sim);
	for (const pool of fx.debris) {
		for (const d of pool.items) stepDebris(d, dt, planes, rng);
		pool.keep((d) => fx.time - d.birth < d.life);
	}
	fx.sparks.keep((k) => fx.time - k.birth < k.life);
	fx.dust.keep((p) => fx.time - p.birth < p.life);
	fx.smoke.keep((p) => fx.time - p.birth < p.life);
	fx.carPos = [...s.carPos] as Vec3;
}

// A new hit restarts the car's crash state; the particles already flying
// stay where they are relative to the car (the simulator re-places the car
// for every hit, so its world frame jumps).
function startImpact(fx: CrashEffects, sim: CrashSim): void {
	const s = sim.state;
	fx.obstacle = s.obstacle;
	if (!s.obstacle) { resetCrashEffects(fx); return; }
	const d = sub(sim.events.car.pos, fx.carPos);
	fx.sparkCooldown = 0;
	fx.burstCooldown = 0;
	fx.dustCarry = 0;
	fx.trailCarry.fill(0);
	if (d[0] === 0 && d[1] === 0 && d[2] === 0) return;
	for (const k of fx.sparks.items) { k.p0 = add(k.p0, d); k.bounceY += d[1]; }
	for (const pool of fx.debris) for (const p of pool.items) p.p = add(p.p, d);
	for (const p of [...fx.dust.items, ...fx.smoke.items]) p.p0 = add(p.p0, d);
}

function obstaclePlanes(fx: CrashEffects, sim: CrashSim): Plane[] {
	const planes: Plane[] = [{ point: [0, fx.groundY, 0], normal: [0, 1, 0] }];
	const o = sim.state.obstacle;
	if (o?.kind === 'wall') planes.push({ point: o.point, normal: scale(o.normal, -1) });
	return planes;
}

function addDebris(fx: CrashEffects, kind: DebrisKind, p: Vec3, v: Vec3, size: number): void {
	fx.debris[kind].add(makeDebris(kind, p, v, size, fx.time, fx.debrisSpawned[kind]++, fx.paint, fx.rng));
}

function burst(fx: CrashEffects, origin: Vec3, carVel: Vec3, k: number): void {
	const rng = fx.rng;
	for (const row of BURST) {
		const n = Math.trunc(row.count * k);
		for (let i = 0; i < n; i++) {
			const p = add(origin, inBox(rng, scale(BURST_BOX, -1), BURST_BOX));
			const v = add(scale(upCone(BURST_CONE.halfAngle, rng), U(rng, BURST_CONE.speed)), scale(carVel, U(rng, BURST_CONE.inherit)));
			addDebris(fx, row.kind, p, v, U(rng, row.size));
		}
	}
}

function dust(fx: CrashEffects, point: Vec3, carVel: Vec3, travelled: number): void {
	const rng = fx.rng;
	fx.dustCarry += DUST_PER_METRE * travelled;
	for (; fx.dustCarry >= 1; fx.dustCarry--) {
		const p = add(point, inBox(rng, DUST_BOX.min, DUST_BOX.max));
		const v = add(inBox(rng, DUST_VELOCITY.min, DUST_VELOCITY.max), scale(carVel, U(rng, DUST_INHERIT)));
		fx.dust.add(makePuff(DUST, p, v, U(rng, DUST_SIZE), fx.time, fx.counter++, rng.range(-DUST.spin, DUST.spin), rng.range(0, 2 * Math.PI)));
	}
}

function trail(fx: CrashEffects, sim: CrashSim, speed: number, dt: number): void {
	const s = sim.state, rng = fx.rng;
	const f = Math.min(Math.max((speed - TRAIL_SPEED[0]) / (TRAIL_SPEED[1] - TRAIL_SPEED[0]), 0), 1);
	if (f <= 0) return;
	const rows = s.absorptionSet === AbsorptionSet.AiCrashing ? AI_TRAIL : PLAYER_TRAIL;
	const toWorld = (v: Vec3) => add(s.carPos, mul3(s.carRot, v));
	const centre = toWorld(scale(add(s.aabb.min, s.aabb.max), 0.5));
	const step = scale(s.carVel, dt);
	rows.forEach((row, i) => {
		fx.trailCarry[i] += speed * dt * row.rate * f;
		for (; fx.trailCarry[i] >= 1; fx.trailCarry[i]--) {
			// Somewhere in the car's box, spread back along this step's travel.
			const spot = sub(toWorld(inBox(rng, s.aabb.min, s.aabb.max)), scale(step, rng.next()));
			const v = add(scale(sub(spot, centre), U(rng, TRAIL_SPREAD)), scale(s.carVel, U(rng, TRAIL_INHERIT)));
			const size = U(rng, row.size);
			if (row.kind === 'smoke') {
				fx.smoke.add(makePuff(SMOKE, spot, v, size, fx.time, fx.counter++, rng.range(-SMOKE.spin, SMOKE.spin), rng.range(0, 2 * Math.PI)));
			} else {
				addDebris(fx, row.kind, spot, v, size);
			}
		}
	});
}

export const paneArea = ([a, b, c, d]: GlassEvent['corners']): number =>
	(length(cross(sub(b, a), sub(c, a))) + length(cross(sub(c, a), sub(d, a)))) / 2;

// Pieces spread over the whole pane (bilinear in its corners), blown out
// along its normal hardest from the middle, flung away from its centre, and
// carried along with the car.
export function glassBurst(fx: CrashEffects, g: GlassEvent): void {
	const rng = fx.rng;
	const [A, B, C, D] = g.corners;
	const n = Math.ceil(paneArea(g.corners) * GLASS_PER_SQ_M);
	const centre = scale(add(add(A, B), add(C, D)), 0.25);
	const c = Math.min(length(g.carVel), GLASS_SPEED_CAP);
	const twist = add(sub(A, B), sub(C, D));
	for (let i = 0; i < n; i++) {
		const u = rng.next(), v = rng.next();
		const P = add(A, add(scale(sub(B, A), u), add(scale(sub(D, A), v), scale(twist, u * v))));
		const r = U(rng, GLASS_SIZE);
		const outward = rng.range(GLASS_OUTWARD.min[0] + GLASS_OUTWARD.min[1] * c, GLASS_OUTWARD.max[0] + GLASS_OUTWARD.max[1] * c);
		const share = U(rng, GLASS_INHERIT), radial = U(rng, GLASS_RADIAL);
		const vel = add(add(scale(g.normal, 16 * u * (1 - u) * v * (1 - v) * outward), scale(g.carVel, share)), scale(sub(P, centre), radial));
		addDebris(fx, DebrisKind.Glass, P, vel, r * r);
	}
}

// Spark showers. A crashing car's contact that slides across the surface
// throws 100 - 250 sparks from the contact point: they leave in the plane of
// the surface, mostly along the slide, keep part of the slide velocity, and
// anything heading into the surface is thrown back out three times as fast.
// No slide, no sparks: a straight head-on hit throws none.
//
// Each spark's flight is closed-form: launch velocity times a drag ramp
// (dragDistance) plus gravity, with one bounce off the ground baked in at
// spawn as a second vertical track (the drawn height is the higher of the
// two, so the spark follows the first until it reaches the ground).

import type { Vec3 } from '../deformationSpec';
import { add, cross, dot, length, normalize, scale, sub } from '../deformationSim/state';
import { dragDistance, type Rng } from './random';
import { CRASH_SHOWER, CRASH_SPARKS, SPARK_COUNT, SPARK_SIZE_FROM, SPARK_SIZE_SLOPE, type SparkController } from './tables';

export type Spark = {
	birth: number;
	life: number;
	p0: Vec3;
	v: Vec3;
	// The bounced vertical track: y = bounceY + bounceVy * drag + g t² / 2.
	bounceY: number;
	bounceVy: number;
	bounces: boolean;
	size: number;
	colour: number;  // index into CRASH_SPARKS.colours
};

const DEG = Math.PI / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

// Shower size 0..1 from the slide speed, before the random halving.
export const showerSize = (slideSpeed: number) => clamp01((slideSpeed - SPARK_SIZE_FROM) * SPARK_SIZE_SLOPE);

export type Shower = {
	origin: Vec3;
	normal: Vec3;   // out of the surface
	slide: Vec3;    // the contact's velocity across the surface
	time: number;   // now
	groundY: number;
	counter: number; // sparks spawned so far (picks colour / lifetime)
};

export function spawnShower(shower: Shower, rng: Rng, out: (spark: Spark) => void, ctl: SparkController = CRASH_SHOWER): number {
	const speed = length(shower.slide);
	const size = showerSize(speed) * (1 + rng.next()) / 2;
	const count = Math.trunc(size * SPARK_COUNT.perSize + SPARK_COUNT.base);
	const s = size * size;
	const pick = (r: [[number, number], [number, number]]) => rng.range(lerp(r[0][0], r[1][0], s), lerp(r[0][1], r[1][1], s));
	const x = normalize(shower.normal);
	const y = normalize(shower.slide);
	const z = cross(x, y);
	const rX = lerp(ctl.radiusX[0], ctl.radiusX[1], s), rYZ = lerp(ctl.radiusYZ[0], ctl.radiusYZ[1], s);
	const speedScale = Math.min(1, speed / ctl.speedThreshold);
	// The shower is spread back over the last step so it doesn't pop out as one sheet.
	const spacing = 1 / 60 / count;
	for (let k = 0; k < count; k++) {
		const L = pick(ctl.lateral) * DEG, F = pick(ctl.forward) * DEG;
		const sp = pick(ctl.speed) * speedScale, share = pick(ctl.inherit), sz = pick(ctl.size);
		const dir = add(scale(add(scale(x, Math.sin(L)), scale(y, Math.cos(L))), Math.cos(F)), scale(z, Math.sin(F)));
		let v = add(scale(dir, sp), scale(shower.slide, share));
		v = sub(v, scale(x, 2 * ctl.reflection * Math.min(dot(v, x), 0)));
		const p0 = add(shower.origin, add(scale(x, rng.range(-rX, rX)), add(scale(y, rng.range(-rYZ, rYZ)), scale(z, rng.range(-rYZ, rYZ)))));
		const index = shower.counter + k;
		out(makeSpark(p0, v, shower.time - k * spacing, sz, index & 3, shower.groundY));
	}
	return count;
}

export function makeSpark(p0: Vec3, v: Vec3, birth: number, size: number, colour: number, groundY: number): Spark {
	const spark: Spark = { birth, life: CRASH_SPARKS.lifetimes[colour], p0, v, bounceY: p0[1], bounceVy: v[1], bounces: false, size, colour };
	solveBounce(spark, p0[1] - groundY);
	return spark;
}

// Where the falling spark meets the ground, and the vertical track it takes
// from there: launched so that at the contact time it sits on the ground
// moving up at `bounce` times the speed it arrived with.
function solveBounce(spark: Spark, height: number): void {
	const { initial, terminal, duration } = CRASH_SPARKS.drag;
	const g = CRASH_SPARKS.gravity, nb = -CRASH_SPARKS.bounce;
	const delta = terminal - initial, vy = spark.v[1], y = spark.p0[1];
	const halfG = g / 2;
	const rampA = (delta * vy) / (duration * 2) + halfG;
	const rampB = vy * initial;
	const rampD = rampB * rampB - 4 * rampA * height;
	if (rampD >= 0) {
		const t = (-rampB - Math.sqrt(rampD)) / (rampA * 2);
		if (!(t > duration)) {
			const scaleAt = delta * t + duration * initial;
			spark.bounceVy = vy * nb + ((nb - 1) * t * duration * g) / scaleAt;
			const dv = vy - spark.bounceVy;
			spark.bounceY = y + dv * t * initial + (dv * delta * t * t) / (duration * 2);
			spark.bounces = true;
			return;
		}
	}
	const termB = vy * terminal;
	const termC = height - (delta * vy * duration) / 2;
	const termD = termB * termB - 4 * termC * halfG;
	if (termD >= 0) {
		const t = (-termB - Math.sqrt(termD)) / (halfG * 2);
		if (!(t < duration)) {
			spark.bounceVy = (((nb - 1) / terminal) * t) * g + vy * nb;
			spark.bounceY = y + ((delta * duration) / 2 - t * terminal) * (spark.bounceVy - vy);
			spark.bounces = true;
		}
	}
}

// Position `t` seconds after birth.
export function sparkPosition(spark: Spark, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
	const d = dragDistance(t, CRASH_SPARKS.drag);
	const fall = 0.5 * CRASH_SPARKS.gravity * t * t;
	out[0] = spark.p0[0] + spark.v[0] * d;
	out[2] = spark.p0[2] + spark.v[2] * d;
	const y = spark.p0[1] + spark.v[1] * d + fall;
	out[1] = spark.bounces ? Math.max(y, spark.bounceY + spark.bounceVy * d + fall) : y;
	return out;
}

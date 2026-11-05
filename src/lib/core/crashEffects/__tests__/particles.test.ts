import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { dot } from '../../deformationSim/state';
import { debrisColour, debrisFade, makeDebris, stepDebris, type Plane } from '../debris';
import { makePuff, puffLook } from '../puffs';
import { dragDistance, makeRng } from '../random';
import { makeSpark, showerSize, spawnShower, sparkPosition, type Spark } from '../sparks';
import { burstScale, CRASH_SPARKS, DebrisKind, DUST, SPARK_COUNT } from '../tables';

const DRAG = { initial: 1, terminal: 0.5, duration: 0.4 };

describe('drag ramp', () => {
	it('integrates a velocity scale ramping initial -> terminal, then holding', () => {
		expect(dragDistance(0, DRAG)).toBe(0);
		expect(dragDistance(0.2, DRAG)).toBeCloseTo(0.2 * 1 + (0.04 * -0.5) / 0.8, 12);
		expect(dragDistance(0.4, DRAG)).toBeCloseTo(0.4 * 0.75, 12);
		expect(dragDistance(1.4, DRAG)).toBeCloseTo(0.3 + 1 * 0.5, 12);
	});
});

describe('spark showers', () => {
	const shower = (slide: Vec3) => ({ origin: [0, 1, 0] as Vec3, normal: [0, 0, 1] as Vec3, slide, time: 10, groundY: 0, counter: 0 });

	it('sizes a shower from the slide speed: nothing at 10 mph, full past ~50 mph', () => {
		expect(showerSize(4.4694443)).toBe(0);
		expect(showerSize(15)).toBeCloseTo((15 - 4.4694443) * 0.0559353642, 9);
		expect(showerSize(40)).toBe(1);
	});

	it('throws 100 - 250 sparks off the surface, back-dated over one step', () => {
		const sparks: Spark[] = [];
		const n = spawnShower(shower([20, 0, 0]), makeRng(3), (s) => sparks.push(s));
		expect(n).toBe(sparks.length);
		expect(n).toBeGreaterThanOrEqual(100);
		expect(n).toBeLessThanOrEqual(Math.trunc(SPARK_COUNT.perSize + SPARK_COUNT.base));
		for (const s of sparks) {
			expect(dot(s.v, [0, 0, 1])).toBeGreaterThanOrEqual(0);
			expect(s.birth).toBeLessThanOrEqual(10);
			expect(s.birth).toBeGreaterThan(10 - 1 / 60);
			expect(s.life).toBe(CRASH_SPARKS.lifetimes[s.colour]);
		}
		// Mostly along the slide.
		const along = sparks.reduce((a, s) => a + s.v[0], 0) / n;
		expect(along).toBeGreaterThan(10);
	});

	it('is the same shower for the same seed', () => {
		const a: Spark[] = [], b: Spark[] = [];
		spawnShower(shower([15, 0, 3]), makeRng(9), (s) => a.push(s));
		spawnShower(shower([15, 0, 3]), makeRng(9), (s) => b.push(s));
		expect(a).toEqual(b);
	});

	it('starts at its spawn point and falls under gravity', () => {
		const s = makeSpark([0, 5, 0], [1, 0, 0], 0, 1, 0, -100);
		expect(sparkPosition(s, 0)).toEqual([0, 5, 0]);
		const p = sparkPosition(s, 0.2);
		expect(p[0]).toBeCloseTo(dragDistance(0.2, DRAG), 9);
		expect(p[1]).toBeCloseTo(5 - 0.5 * 9.81 * 0.04, 9);
	});

	it('bounces once off the ground at half the speed it lands with', () => {
		const s = makeSpark([0, 0.5, 0], [0, -2, 0], 0, 1, 0, 0);
		expect(s.bounces).toBe(true);
		let lowest = Infinity, landed = -1;
		// One bounce only: the spark would fall through on its second landing,
		// which its short life never reaches.
		for (let t = 0; t <= s.life; t += 0.001) {
			const y = sparkPosition(s, t)[1];
			lowest = Math.min(lowest, y);
			if (landed < 0 && y < 1e-3) landed = t;
		}
		expect(lowest).toBeGreaterThan(-1e-3);
		expect(landed).toBeGreaterThan(0);
		// Off the ground again afterwards.
		expect(sparkPosition(s, landed + 0.05)[1]).toBeGreaterThan(0.01);
		const h = 1e-5;
		const speed = (t: number) => (sparkPosition(s, t + h)[1] - sparkPosition(s, t - h)[1]) / (2 * h);
		const t = 0.18646;
		expect(speed(t + 0.002) / speed(t - 0.002)).toBeCloseTo(-0.5, 1);
	});
});

describe('debris', () => {
	const ground: Plane[] = [{ point: [0, 0, 0], normal: [0, 1, 0] }];

	it('keeps grey colours grey and darkens them 10 - 50 %', () => {
		const rng = makeRng(1);
		for (let i = 0; i < 20; i++) {
			const c = debrisColour([0.5, 0.5, 0.5], rng);
			expect(c[0]).toBeCloseTo(c[1], 12);
			expect(c[0]).toBeGreaterThanOrEqual(0.25);
			expect(c[0]).toBeLessThanOrEqual(0.45);
		}
	});

	it('pulls a paint colour 25 - 75 % of the way from its grey', () => {
		const c = debrisColour([1, 0, 0], { next: () => 0, range: (lo) => lo });
		const grey = 1 / 3;
		expect(c[0]).toBeCloseTo((grey + 0.25 * (1 - grey)) * 0.5, 12);
		expect(c[1]).toBeCloseTo((grey - 0.25 * grey) * 0.5, 12);
	});

	it('bounces off the ground 2 - 5 times, losing speed, then lies still', () => {
		const rng = makeRng(4);
		const d = makeDebris(DebrisKind.Dark, [0, 1, 0], [2, 3, 0], 0.1, 0, 0, [1, 0, 0], rng);
		expect(d.bouncesLeft).toBeGreaterThanOrEqual(2);
		expect(d.bouncesLeft).toBeLessThanOrEqual(5);
		const bounces = d.bouncesLeft;
		let ups = 0, lastVy = d.v[1];
		for (let i = 0; i < 2000 && !d.still; i++) {
			stepDebris(d, 1 / 60, ground, rng);
			if (lastVy < 0 && d.v[1] > 0) ups++;
			lastVy = d.v[1];
			expect(d.p[1]).toBeGreaterThanOrEqual(0);
		}
		expect(d.still).toBe(true);
		expect(ups).toBe(bounces - 1);
		expect(d.angle).toBeGreaterThan(0);
	});

	it('fades in over the preset time and out over the last 0.8 s', () => {
		const d = makeDebris(DebrisKind.Coloured, [0, 1, 0], [0, 0, 0], 0.1, 0, 0, [1, 0, 0], makeRng(1));
		expect(debrisFade(d, 0.05, 0.8)).toBeCloseTo(0.5, 9);
		expect(debrisFade(d, 0.5, 0.8)).toBe(1);
		expect(debrisFade(d, d.life - 0.4, 0.8)).toBeCloseTo(0.5, 9);
	});

	it('scales a burst by the car speed: none below 5 m/s, 0.61 at 25, full at 60', () => {
		expect(burstScale(5)).toBe(0);
		expect(burstScale(15)).toBeCloseTo(0.305, 9);
		expect(burstScale(25)).toBeCloseTo(0.61, 9);
		expect(burstScale(60)).toBeCloseTo(1, 9);
		expect(burstScale(90)).toBe(1);
	});
});

describe('puffs', () => {
	it('grows and changes colour start -> mid -> end and rises slowly', () => {
		const p = makePuff(DUST, [0, 0, 0], [0, 0, 0], 1, 0, 0, 0, 0);
		expect(puffLook(p, 0).size).toBe(1.5);
		expect(puffLook(p, 0.2 * p.life).size).toBeCloseTo(3.5, 9);
		expect(puffLook(p, p.life).size).toBeCloseTo(5, 9);
		expect(puffLook(p, 0.2 * p.life).rgba[3]).toBeCloseTo(0.3, 9);
		expect(puffLook(p, 1).pos[1]).toBeCloseTo(0.2, 9);
	});

	it('lives 2 s scaled by its index', () => {
		expect([0, 1, 2, 3].map((i) => makePuff(DUST, [0, 0, 0], [0, 0, 0], 1, 0, i, 0, 0).life)).toEqual([2, 1.6, 1.8, 1.4]);
	});
});

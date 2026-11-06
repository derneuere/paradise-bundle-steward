import { describe, expect, it } from 'vitest';
import type { GlassPane, Vec3 } from '../../deformationSpec';
import { applyImpact, createCrashSim, GlassState, resetCrashSim, stepCrashSim, type GlassEvent, type Impact } from '../../deformationSim';
import { makeSpec } from '../../deformationSim/__tests__/fixture';
import { createCrashEffects, glassBurst, paneArea, resetCrashEffects, stepCrashEffects } from '../effects';
import { DebrisKind, GLASS_PER_SQ_M } from '../tables';

const front: Impact = { pointMesh: [0, 0.5, 2.4], direction: [0, 0, -1], speed: 30, forceCrash: true };

// `steps` steps from the one the car first meets the obstacle in.
function run(impact: Impact, steps = 60, spec = makeSpec()) {
	const sim = createCrashSim(spec);
	const fx = createCrashEffects(7);
	applyImpact(sim, impact);
	let sparks = 0, debris = 0, dust = 0, smoke = 0;
	for (let i = 0; i < 600 && !(sim.state.run?.touched || sim.state.run?.crash); i++) {
		stepCrashSim(sim);
		stepCrashEffects(fx, sim, 1 / 60);
	}
	for (let i = 1; i < steps; i++) {
		stepCrashSim(sim);
		stepCrashEffects(fx, sim, 1 / 60);
		sparks = Math.max(sparks, fx.sparks.items.length);
		debris = Math.max(debris, fx.debris.reduce((a, p) => a + p.items.length, 0));
		dust = Math.max(dust, fx.dust.items.length);
		smoke = Math.max(smoke, fx.smoke.items.length);
	}
	return { sim, fx, sparks, debris, dust, smoke };
}

describe('crash effects', () => {
	it('throws no sparks on a straight head-on hit, but debris and dust', () => {
		// Slow enough that nothing slides across the wall at spark speed (a
		// faster hit turns the car and its nose slides).
		const r = run({ ...front, speed: 10 });
		expect(r.sparks).toBe(0);
		expect(r.debris).toBeGreaterThan(0);
		expect(r.dust).toBeGreaterThan(0);
	});

	it('throws sparks once the car slides along the wall', () => {
		const r = run({ ...front, glance: 30 });
		expect(r.sparks).toBeGreaterThanOrEqual(100);
		expect(r.smoke).toBeGreaterThan(0);
	});

	it('fires nothing on a knock below crash speed', () => {
		const r = run({ ...front, glance: 30, forceCrash: false });
		expect(r.sparks + r.debris + r.dust + r.smoke).toBe(0);
	});

	it('replays identically', () => {
		const a = run({ ...front, glance: 30 }, 30).fx, b = run({ ...front, glance: 30 }, 30).fx;
		expect(a.sparks.items).toEqual(b.sparks.items);
		expect(a.debris).toEqual(b.debris);
		expect(a.smoke.items).toEqual(b.smoke.items);
	});

	it("numbers each kind's pieces on their own, so their batch slots run 0, 1, 2 ... per kind", () => {
		const { fx } = run(front, 6);
		for (const k of [DebrisKind.Coloured, DebrisKind.Dark]) {
			const items = fx.debris[k].items;
			expect(items.length).toBeGreaterThan(1);
			expect(fx.debrisSpawned[k]).toBe(items.length);
			expect(items.map((d) => d.slot)).toEqual(items.map((_, i) => i & 31));
		}
		resetCrashEffects(fx);
		expect(fx.debrisSpawned.every((n) => n === 0)).toBe(true);
	});

	it('lets every particle run out its life', () => {
		const r = run({ ...front, speed: 12, glance: 30 }, 200);
		for (let i = 0; i < 600; i++) { stepCrashSim(r.sim); stepCrashEffects(r.fx, r.sim, 1 / 60); }
		expect(r.fx.sparks.items.length + r.fx.dust.items.length).toBe(0);
	});

	it('leaves flying particles where they are in the world when the next hit re-places the car', () => {
		const { sim, fx } = run(front, 20);
		const piece = fx.debris[DebrisKind.Dark].items[0];
		const was = [...piece.p];
		applyImpact(sim, { ...front, pointMesh: [0, 0.5, 2.6] });
		stepCrashSim(sim);
		stepCrashEffects(fx, sim, 1 / 60);
		// One step of its own motion apart.
		const moved = piece.p.map((v, k) => v - was[k]);
		expect(Math.hypot(...moved)).toBeLessThan(0.5);
	});

	it('clears everything on a reset', () => {
		const { sim, fx } = run({ ...front, glance: 30 }, 20);
		resetCrashSim(sim);
		stepCrashSim(sim);
		stepCrashEffects(fx, sim, 1 / 60);
		expect(fx.sparks.items.length + fx.debris.reduce((a, p) => a + p.items.length, 0)).toBe(0);
		resetCrashEffects(fx);
		expect(fx.time).toBe(0);
	});
});

describe('glass', () => {
	const pane: GlassEvent['corners'] = [[0, 0, 0], [1, 0, 0], [1, 0.5, 0], [0, 0.5, 0]];
	const smash: GlassEvent = { pane: 0, partType: 20, state: GlassState.Smashed, crack: 0, corners: pane, normal: [0, 0, 1], carVel: [0, 0, 10] };

	it('measures the pane as two triangles', () => {
		expect(paneArea(pane)).toBeCloseTo(0.5, 12);
	});

	it('bursts 320 pieces per square metre over the pane, carried with the car and blown outward', () => {
		const fx = createCrashEffects(2);
		glassBurst(fx, smash);
		const glass = fx.debris[DebrisKind.Glass].items;
		expect(glass).toHaveLength(Math.ceil(0.5 * GLASS_PER_SQ_M));
		for (const g of glass) {
			expect(g.p[0]).toBeGreaterThanOrEqual(0);
			expect(g.p[0]).toBeLessThanOrEqual(1);
			expect(g.p[1]).toBeLessThanOrEqual(0.5);
			expect(g.v[2]).toBeGreaterThanOrEqual(10 * 0.4);
		}
	});

	it('smashes a pane during a crash and throws its glass', () => {
		const spec = makeSpec();
		const glassPane: GlassPane = {
			plane: [0, 0, 1, 0], matrix: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
			cornerTagIndices: [0, 3, 4, 0], bytes58: [1, 1, 1, 0], short5C: 0, short5E: 0, short60: 0, partType: 20,
		};
		spec.glassPanes = [glassPane];
		const r = run({ ...front, speed: 60 }, 30, spec);
		expect(r.sim.state.glass[0].state).toBe(GlassState.Smashed);
		expect(r.fx.debris[DebrisKind.Glass].items.length).toBeGreaterThan(0);
	});
});

export type { Vec3 };

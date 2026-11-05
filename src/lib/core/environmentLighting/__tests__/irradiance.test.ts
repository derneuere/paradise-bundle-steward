import { describe, expect, it } from 'vitest';
import {
	evaluateIrradianceMatrices, evaluateIrradianceQuadrics, fillRigCoefficients,
	irradianceMatrices, packIrradianceQuadrics,
} from '../irradiance';
import { keyLightDirection } from '../sun';
import { RETAIL_DAYLIGHT_LOOK } from '../retailDaylight';
import type { EnvironmentLightingData, Vec3 } from '../../environmentSettings';

const c = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const uniformFill = (col: Vec3, scale: number): EnvironmentLightingData => ({
	mv3KeyLightColour: c(1, 1, 1), mv3SpecularColour: c(1, 1, 1),
	mv3KeyFillColour: col, mv3ShadowFillColour: col, mv3RightFillColour: col,
	mv3LeftFillColour: col, mv3UpFillColour: col, mv3DownFillColour: col,
	mfAmbientIrradianceScale: scale,
});

function randomUnit(seed: number): Vec3 {
	const a = Math.sin(seed * 12.9898) * 43758.5453;
	const b = Math.sin(seed * 78.233) * 12345.6789;
	const z = 2 * (a - Math.floor(a)) - 1;
	const t = 2 * Math.PI * (b - Math.floor(b));
	const r = Math.sqrt(1 - z * z);
	return { x: r * Math.cos(t), y: r * Math.sin(t), z };
}

describe('fill rig irradiance', () => {
	const dir = keyLightDirection();

	it('turns six equal fills into a constant irradiance of 1.5 × fill × scale', () => {
		const m = irradianceMatrices(dir, uniformFill(c(0.2, 0.4, 0.8), 0.5));
		for (let i = 0; i < 20; i++) {
			const e = evaluateIrradianceMatrices(m, randomUnit(i + 1));
			expect(e.x).toBeCloseTo(1.5 * 0.2 * 0.5, 5);
			expect(e.y).toBeCloseTo(1.5 * 0.4 * 0.5, 5);
			expect(e.z).toBeCloseTo(1.5 * 0.8 * 0.5, 5);
		}
	});

	it('scales linearly with mfAmbientIrradianceScale', () => {
		const L = RETAIL_DAYLIGHT_LOOK.lighting;
		const a = evaluateIrradianceMatrices(irradianceMatrices(dir, L), c(0, 1, 0));
		const b = evaluateIrradianceMatrices(irradianceMatrices(dir, { ...L, mfAmbientIrradianceScale: L.mfAmbientIrradianceScale * 2 }), c(0, 1, 0));
		expect(b.x).toBeCloseTo(a.x * 2, 9);
	});

	it('lights an upward normal with the down fill (sky) and a downward one with the up fill (ground)', () => {
		const sky = c(0.1, 0.3, 0.9);
		const ground = c(0.4, 0.3, 0.1);
		const L: EnvironmentLightingData = { ...uniformFill(c(0, 0, 0), 1), mv3DownFillColour: sky, mv3UpFillColour: ground };
		const m = irradianceMatrices(dir, L);
		const up = evaluateIrradianceMatrices(m, c(0, 1, 0));
		const down = evaluateIrradianceMatrices(m, c(0, -1, 0));
		expect(up.z).toBeGreaterThan(up.x);
		expect(down.x).toBeGreaterThan(down.z);
	});

	it('puts the key fill on the sun side and the shadow fill opposite', () => {
		const L: EnvironmentLightingData = { ...uniformFill(c(0, 0, 0), 1), mv3KeyFillColour: c(1, 1, 1) };
		const m = irradianceMatrices(dir, L);
		const towardSun = c(-dir.x, 0, -dir.z);
		const away = c(dir.x, 0, dir.z);
		const l = Math.hypot(towardSun.x, towardSun.z);
		const e1 = evaluateIrradianceMatrices(m, c(towardSun.x / l, 0, towardSun.z / l));
		const e2 = evaluateIrradianceMatrices(m, c(away.x / l, 0, away.z / l));
		expect(e1.x).toBeGreaterThan(e2.x);
	});

	it('has nine coefficients', () => {
		expect(fillRigCoefficients(dir, RETAIL_DAYLIGHT_LOOK.lighting)).toHaveLength(9);
	});
});

describe('packIrradianceQuadrics', () => {
	const m = irradianceMatrices(keyLightDirection(), RETAIL_DAYLIGHT_LOOK.lighting);
	const q = packIrradianceQuadrics(m);

	it('evaluates exactly like n^T M n for unit normals (the shader-side form)', () => {
		for (let i = 0; i < 50; i++) {
			const n = randomUnit(i + 100);
			const a = evaluateIrradianceMatrices(m, n);
			const b = evaluateIrradianceQuadrics(q, n);
			expect(b.x).toBeCloseTo(a.x, 10);
			expect(b.y).toBeCloseTo(a.y, 10);
			expect(b.z).toBeCloseTo(a.z, 10);
		}
	});

	it('lays out 16 floats per constant with A row 0 = constants and B row 3 = (0,0,0,1)', () => {
		expect(q.a).toHaveLength(16);
		expect(q.b).toHaveLength(16);
		expect(q.a[3]).toBe(0);
		expect(q.b.slice(12)).toEqual([0, 0, 0, 1]);
		for (let ch = 0; ch < 3; ch++) expect(q.a[ch]).toBeCloseTo(m[ch][15] + m[ch][10], 12);
	});
});

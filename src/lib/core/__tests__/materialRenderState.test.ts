// A technique's MaterialState on a three.js material: cull side (with the
// winding proven on a retail mesh), blending, depth and alpha-to-coverage.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { parseBundle } from '@/lib/core/bundle';
import { decodeAllRenderables } from '@/lib/core/renderableDecode';
import { applyMaterialState, sideForRasterizer, usesAlpha } from '@/lib/core/materialRenderState';
import { D3DBlend, D3DBlendOp, D3DComparison, D3DCull, type MaterialState, type RenderTargetBlend } from '@/lib/core/materialState';

const rt = (over: Partial<RenderTargetBlend> = {}): RenderTargetBlend => ({
	blendEnable: false, srcBlend: D3DBlend.ONE, destBlend: D3DBlend.ZERO, blendOp: D3DBlendOp.ADD,
	srcBlendAlpha: D3DBlend.ONE, destBlendAlpha: D3DBlend.ZERO, blendOpAlpha: D3DBlendOp.ADD, writeMask: 0xF, ...over,
});

function state(over: { rt0?: Partial<RenderTargetBlend>; a2c?: boolean; depthWrite?: boolean; depthFunc?: number; cull?: number; ccw?: boolean } = {}): MaterialState {
	return {
		blend: { renderTargets: [rt(over.rt0), ...Array.from({ length: 7 }, () => rt())], blendFactor: [1, 1, 1, 1], alphaToCoverage: over.a2c ?? false, independentBlend: false },
		depthStencil: { depthEnable: true, depthWrite: over.depthWrite ?? true, depthFunc: over.depthFunc ?? D3DComparison.LESS_EQUAL, stencilEnable: false },
		rasterizer: { fillMode: 3, cullMode: over.cull ?? D3DCull.BACK, frontCounterClockwise: over.ccw ?? true, depthBias: 0, slopeScaledDepthBias: 0 },
	};
}

const ALPHA_BLEND = { blendEnable: true, srcBlend: D3DBlend.SRC_ALPHA, destBlend: D3DBlend.INV_SRC_ALPHA };

describe('sideForRasterizer', () => {
	it('with counter-clockwise front faces, culling back keeps three.js front faces', () => {
		expect(sideForRasterizer(state({ cull: D3DCull.BACK }).rasterizer)).toBe(THREE.FrontSide);
		expect(sideForRasterizer(state({ cull: D3DCull.FRONT }).rasterizer)).toBe(THREE.BackSide);
		expect(sideForRasterizer(state({ cull: D3DCull.NONE }).rasterizer)).toBe(THREE.DoubleSide);
	});

	it('clockwise front faces flip the side', () => {
		expect(sideForRasterizer(state({ cull: D3DCull.BACK, ccw: false }).rasterizer)).toBe(THREE.BackSide);
		expect(sideForRasterizer(state({ cull: D3DCull.FRONT, ccw: false }).rasterizer)).toBe(THREE.FrontSide);
	});
});

describe('applyMaterialState', () => {
	it('an opaque state: not transparent, depth written, back faces culled', () => {
		const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, transparent: true });
		applyMaterialState(m, state());
		expect(m.transparent).toBe(false);
		expect(m.blending).toBe(THREE.NormalBlending);
		expect(m.alphaToCoverage).toBe(false);
		expect(m.depthWrite).toBe(true);
		expect(m.depthTest).toBe(true);
		expect(m.depthFunc).toBe(THREE.LessEqualDepth);
		expect(m.side).toBe(THREE.FrontSide);
	});

	it('a blended state: transparent with the game colour factors, canvas alpha kept opaque', () => {
		const m = new THREE.MeshStandardMaterial();
		applyMaterialState(m, state({ rt0: ALPHA_BLEND, cull: D3DCull.NONE }));
		expect(m.transparent).toBe(true);
		expect(m.blending).toBe(THREE.CustomBlending);
		expect([m.blendSrc, m.blendDst, m.blendEquation]).toEqual([THREE.SrcAlphaFactor, THREE.OneMinusSrcAlphaFactor, THREE.AddEquation]);
		expect([m.blendSrcAlpha, m.blendDstAlpha]).toEqual([THREE.OneFactor, THREE.OneMinusSrcAlphaFactor]);
		expect(m.side).toBe(THREE.DoubleSide);
	});

	it('maps every factor, op and depth function it knows', () => {
		const m = new THREE.ShaderMaterial();
		applyMaterialState(m, state({
			rt0: { blendEnable: true, srcBlend: D3DBlend.SRC_ALPHA_SAT, destBlend: D3DBlend.INV_DEST_COLOR, blendOp: D3DBlendOp.REV_SUBTRACT },
			depthFunc: D3DComparison.GREATER, depthWrite: false,
		}));
		expect([m.blendSrc, m.blendDst, m.blendEquation]).toEqual([THREE.SrcAlphaSaturateFactor, THREE.OneMinusDstColorFactor, THREE.ReverseSubtractEquation]);
		expect(m.depthFunc).toBe(THREE.GreaterDepth);
		expect(m.depthWrite).toBe(false);
	});

	it('alpha-to-coverage is the cut-out (the PC renderer has no alpha test)', () => {
		const m = new THREE.MeshStandardMaterial();
		applyMaterialState(m, state({ a2c: true }));
		expect(m.alphaToCoverage).toBe(true);
		expect(m.transparent).toBe(false);
	});

	it('no state leaves the material as built', () => {
		const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
		applyMaterialState(m, null);
		expect(m.side).toBe(THREE.DoubleSide);
	});
});

describe('usesAlpha', () => {
	it('is true for blended or coverage draws only', () => {
		expect(usesAlpha(state())).toBe(false);
		expect(usesAlpha(state({ rt0: ALPHA_BLEND }))).toBe(true);
		expect(usesAlpha(state({ a2c: true }))).toBe(true);
		expect(usesAlpha(null)).toBe(false);
	});
});

const FIXTURE = path.resolve(__dirname, '../../../../example/VEH_CARBRWDS_GR.BIN');

describe.skipIf(!fs.existsSync(FIXTURE))('retail winding', () => {
	it('triangles are counter-clockwise around their authored normals, so CULL_BACK is FrontSide', () => {
		const b = fs.readFileSync(FIXTURE);
		const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
		const { renderables } = decodeAllRenderables(ab, parseBundle(ab), new Map(), false, 'all');
		const a = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
		let ccw = 0, total = 0;
		for (const r of renderables) for (const m of r.meshes) {
			const pos = m.geometry.getAttribute('position'), nrm = m.geometry.getAttribute('normal'), idx = m.geometry.getIndex();
			if (!pos || !nrm || !idx) continue;
			for (let t = 0; t < idx.count; t += 3) {
				const [i0, i1, i2] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
				a.fromBufferAttribute(pos, i0);
				e1.fromBufferAttribute(pos, i1).sub(a);
				e2.fromBufferAttribute(pos, i2).sub(a);
				n.fromBufferAttribute(nrm, i0).add(a.fromBufferAttribute(nrm, i1)).add(a.fromBufferAttribute(nrm, i2));
				const d = e1.cross(e2).dot(n);
				if (d === 0) continue;
				total++;
				if (d > 0) ccw++;
			}
		}
		expect(total).toBeGreaterThan(10000);
		expect(ccw / total).toBeGreaterThan(0.97);
	});
});

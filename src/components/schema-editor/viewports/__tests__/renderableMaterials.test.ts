// The textured stand-ins honour what the Material resource says about itself:
// its technique's render state (blend, coverage, cull) and its own
// materialDiffuse (dark trim, tinted glass).

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
// The registry first: textureState's handler reads its enum at load.
import '@/lib/core/bundle';
import { buildTexturedMaterials } from '../renderableMaterials';
import type { DecodedRenderable } from '@/lib/core/renderableDecode';
import type { ResolvedMaterial } from '@/lib/core/materialChain';
import { D3DBlend, D3DBlendOp, D3DCull, type MaterialState } from '@/lib/core/materialState';
import { constantNameHash } from '@/lib/core/materialShaderConstants';

const rt = (blendEnable: boolean) => ({
	blendEnable, srcBlend: D3DBlend.SRC_ALPHA, destBlend: D3DBlend.INV_SRC_ALPHA, blendOp: D3DBlendOp.ADD,
	srcBlendAlpha: D3DBlend.SRC_ALPHA, destBlendAlpha: D3DBlend.INV_SRC_ALPHA, blendOpAlpha: D3DBlendOp.ADD, writeMask: 0xF,
});
const state = (blend: boolean, a2c: boolean, cull: number): MaterialState => ({
	blend: { renderTargets: [rt(blend), ...Array.from({ length: 7 }, () => rt(false))], blendFactor: [1, 1, 1, 1], alphaToCoverage: a2c, independentBlend: false },
	depthStencil: { depthEnable: true, depthWrite: true, depthFunc: 4, stencilEnable: false },
	rasterizer: { fillMode: 3, cullMode: cull, frontCounterClockwise: true, depthBias: 0, slopeScaledDepthBias: 0 },
});

const diffuse = (rgb: number[]) => [{ hash: constantNameHash('materialDiffuse'), values: [...rgb, 1] }];

function material(shaderName: string, over: Partial<ResolvedMaterial>): ResolvedMaterial {
	return {
		materialId: 1n, diffuse: null, normal: null, specular: null, emissive: null, ao: null, scratch: null,
		samplerState: null, materialStates: [], shaderConstants: [], diffuseFromSecondary: false, anyFromSecondary: false,
		crossBundleMisses: 0, shaderName, unclassified: [], ...over,
	};
}

function build(...mats: ResolvedMaterial[]) {
	const renderable = {
		resourceId: 1n, debugName: null, parsed: null,
		meshes: mats.map((rm, i) => ({ materialAssemblyId: BigInt(i + 1), resolvedMaterial: rm, geometry: new THREE.BufferGeometry(), meshFlags: 0 })),
	};
	// TODO(types): only the fields buildTexturedMaterials reads
	return buildTexturedMaterials([renderable as unknown as DecodedRenderable], false, null);
}

describe('buildTexturedMaterials', () => {
	it('a window blends double-sided, tinted by its materialDiffuse', () => {
		const m = build(material('Vehicle_Greyscale_Window_Textured', {
			materialStates: [state(true, false, D3DCull.NONE)], shaderConstants: diffuse([0, 0.28, 0.24]),
		})).get('1')!;
		expect(m.transparent).toBe(true);
		expect(m.side).toBe(THREE.DoubleSide);
		expect([m.color.r, m.color.g, m.color.b].map((v) => +v.toFixed(2))).toEqual([0, 0.28, 0.24]);
		expect(m.metalness).toBe(0);
	});

	it('dark trim stays dark: materialDiffuse beats the guessed colour', () => {
		const m = build(material('Vehicle_Opaque_PlasticMatt', {
			materialStates: [state(false, false, D3DCull.BACK)], shaderConstants: diffuse([0.1, 0.1, 0.1]),
		})).get('1')!;
		expect(m.color.r).toBeCloseTo(0.1);
		expect(m.transparent).toBe(false);
		expect(m.side).toBe(THREE.FrontSide);
	});

	it('a livery cut-out blends and covers by alpha, so its clear texels vanish', () => {
		const m = build(material('Vehicle_Livery_Alpha_CarGuts', { materialStates: [state(true, true, D3DCull.BACK)] })).get('1')!;
		expect(m.transparent).toBe(true);
		expect(m.alphaToCoverage).toBe(true);
	});

	it('without a MaterialState the old double-sided opaque default stands', () => {
		const m = build(material('Vehicle_Opaque_Metal_Textured', {})).get('1')!;
		expect(m.side).toBe(THREE.DoubleSide);
		expect(m.transparent).toBe(false);
	});
});

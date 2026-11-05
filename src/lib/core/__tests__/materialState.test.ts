// MaterialState (0xF): the D3D11-style blend / depth-stencil / rasterizer
// blocks a Material technique draws with, and how the Material lists one per
// technique.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBundle } from '@/lib/core/bundle';
import { getResourceBlocks } from '@/lib/core/resourceManager';
import { resolveMaterialTextures } from '@/lib/core/materialChain';
import { parseMaterialData } from '@/lib/core/material';
import { D3DBlend, D3DBlendOp, D3DComparison, D3DCull, isBlended, MATERIAL_STATE_TYPE_ID, parseMaterialState, unpackRenderTargetBlend } from '@/lib/core/materialState';
import { u64ToBigInt } from '@/lib/core/u64';

// Words of retail states, verbatim (the uninitialised bytes left as found);
// CUTOUT is a 1Bit state with the depth-write-off word some world states carry.
const WINDOW = '0c 48 88 7931498b 7931498a 7931498a 7931498a 7931498a 7931498a 7931498a 7931498a 3f800000 3f800000 3f800000 3f800000 5e0000 1 0 4 1 1 1 8 1 1 1 8 0 ffffffff ffffffff 101 1 0 0 3 1 1 0 0 0 10100 1 0 0 0 0 0 0';
const LIVERY = '0c 48 88 7931498b 7931498a 7931498a 7931498a 7931498a 7931498a 7931498a 7931498a 3f800000 3f800000 3f800000 3f800000 1 1 0 4 1 1 1 8 1 1 1 8 0 ffffffff ffffffff 101 1 0 0 3 3 1 0 0 0 10109 1 0 0 0 0 0 0';
const OPAQUE = '0c 48 88 79314844 7931498a 7931498a 7931498a 7931498a 7931498a 7931498a 7931498a 3f800000 3f800000 3f800000 3f800000 670000 1 0 4 1 1 1 8 1 1 1 8 0 ffffffff ffffffff 101 1 0 0 3 3 1 0 0 0 10178 1 0 0 0 0 0 0';
const CUTOUT = '0c 48 88 7931498a 7931498a 7931498a 7931498a 7931498a 7931498a 7931498a 7931498a 3f800000 3f800000 3f800000 3f800000 3860001 1 0 4 1 1 1 8 1 1 1 8 0 ffffffff ffffffff 1 1 0 0 3 1 1 0 0 0 10100 1 0 0 0 0 0 0';

function blob(words: string): Uint8Array {
	const w = words.split(' ').map((x) => parseInt(x, 16));
	const out = new Uint8Array(w.length * 4);
	const dv = new DataView(out.buffer);
	w.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true));
	return out;
}

describe('unpackRenderTargetBlend', () => {
	it('reads enable, factors, ops and write mask from the packed word', () => {
		expect(unpackRenderTargetBlend(0x7931498b)).toEqual({
			blendEnable: true,
			srcBlend: D3DBlend.SRC_ALPHA, destBlend: D3DBlend.INV_SRC_ALPHA, blendOp: D3DBlendOp.ADD,
			srcBlendAlpha: D3DBlend.SRC_ALPHA, destBlendAlpha: D3DBlend.INV_SRC_ALPHA, blendOpAlpha: D3DBlendOp.ADD,
			writeMask: 0xF,
		});
		const opaque = unpackRenderTargetBlend(0x79314844);
		expect([opaque.blendEnable, opaque.srcBlend, opaque.destBlend]).toEqual([false, D3DBlend.ONE, D3DBlend.ZERO]);
		expect(unpackRenderTargetBlend(0x0131498a).writeMask).toBe(0);
	});
});

describe('parseMaterialState', () => {
	it('decodes a window: alpha blended, depth written, no culling', () => {
		const s = parseMaterialState(blob(WINDOW));
		expect(isBlended(s)).toBe(true);
		expect(s.blend.alphaToCoverage).toBe(false);
		expect(s.blend.independentBlend).toBe(false);
		expect(s.blend.blendFactor).toEqual([1, 1, 1, 1]);
		expect(s.blend.renderTargets).toHaveLength(8);
		expect(s.blend.renderTargets.slice(1).every((rt) => !rt.blendEnable)).toBe(true);
		expect(s.depthStencil).toEqual({ depthFunc: D3DComparison.LESS_EQUAL, depthEnable: true, depthWrite: true, stencilEnable: false });
		expect(s.rasterizer).toEqual({ fillMode: 3, cullMode: D3DCull.NONE, frontCounterClockwise: true, depthBias: 0, slopeScaledDepthBias: 0 });
	});

	it('decodes a livery: blended with alpha-to-coverage, back faces culled', () => {
		const s = parseMaterialState(blob(LIVERY));
		expect(isBlended(s)).toBe(true);
		expect(s.blend.alphaToCoverage).toBe(true);
		expect(s.rasterizer.cullMode).toBe(D3DCull.BACK);
	});

	it('ignores the uninitialised high bytes of the bool words', () => {
		const s = parseMaterialState(blob(OPAQUE));
		expect(isBlended(s)).toBe(false);
		expect(s.blend.alphaToCoverage).toBe(false);
		const c = parseMaterialState(blob(CUTOUT));
		expect(c.blend.alphaToCoverage).toBe(true);
		expect(c.depthStencil.depthWrite).toBe(false);
		expect(c.depthStencil.depthEnable).toBe(true);
	});

	it('follows the header offsets rather than assuming them', () => {
		const moved = new Uint8Array(0xD0);
		const src = blob(WINDOW);
		moved.set(src.subarray(0, 0x0C));
		moved.set(src.subarray(0x0C), 0x1C);
		const dv = new DataView(moved.buffer);
		dv.setUint32(0, 0x1C, true); dv.setUint32(4, 0x58, true); dv.setUint32(8, 0x98, true);
		expect(parseMaterialState(moved)).toEqual(parseMaterialState(src));
	});

	it('rejects blocks outside the resource', () => {
		const bad = blob(WINDOW);
		new DataView(bad.buffer).setUint32(8, 0xB0, true);
		expect(() => parseMaterialState(bad)).toThrow(/rasterizer/);
		expect(() => parseMaterialState(new Uint8Array(8))).toThrow(/too small/);
	});
});

const FIXTURE = path.resolve(__dirname, '../../../../example/VEH_CARBRWDS_GR.BIN');

describe.skipIf(!fs.existsSync(FIXTURE))('retail vehicle material states', () => {
	const b = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE) : Buffer.alloc(0);
	const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
	const bundle = fs.existsSync(FIXTURE) ? parseBundle(ab) : null!;

	it('every state decodes with the 0x0C / 0x48 / 0x88 layout', () => {
		const states = bundle.resources.filter((r) => r.resourceTypeId === MATERIAL_STATE_TYPE_ID);
		expect(states.length).toBeGreaterThan(0);
		for (const r of states) {
			const raw = getResourceBlocks(ab, bundle, r)[0];
			expect(raw.byteLength).toBe(0xC0);
			const s = parseMaterialState(raw);
			expect(s.rasterizer.frontCounterClockwise).toBe(true);
			expect([D3DCull.NONE, D3DCull.BACK]).toContain(s.rasterizer.cullMode);
		}
	});

	it('a material lists one state per technique, in technique order', () => {
		const patterns = new Set<string>();
		for (const r of bundle.resources) {
			if (r.resourceTypeId !== 1) continue;
			const raw = getResourceBlocks(ab, bundle, r)[0];
			const rm = resolveMaterialTextures(ab, bundle, u64ToBigInt(r.resourceId), new Map())!;
			expect(rm.materialStates).toHaveLength(parseMaterialData(raw).numMaterialStates);
			patterns.add(rm.materialStates.map((s) =>
				(s && isBlended(s) ? 'blend' : 'opaque') + (s?.blend.alphaToCoverage ? '+a2c' : '') + (s?.rasterizer.cullMode === D3DCull.NONE ? '/2side' : '')).join(' '));
		}
		// Windows: Damaged and Default blend double-sided, the Z-only pass is opaque.
		expect(patterns).toContain('blend/2side blend/2side opaque');
		// Liveries and decals: cut out by coverage in the drawn techniques only.
		expect(patterns).toContain('blend+a2c blend+a2c opaque opaque');
		expect(patterns).toContain('opaque opaque opaque opaque');
	});
});

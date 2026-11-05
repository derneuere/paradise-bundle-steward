// The GraphicsSpec's shattered-glass table: 12-byte entries {model import
// index, body-part index, body-part type}, decoded into one cracked-window
// model per pane, placed on its body part.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBundle } from '@/lib/core/bundle';
import { extractResourceRaw } from '@/lib/core/registry';
import {
	GRAPHICS_SPEC_TYPE_ID, parseGraphicsSpec, parseGraphicsSpecData, resolveGraphicsSpecParts, resolveShatteredGlassParts,
} from '@/lib/core/graphicsSpec';
import { decodeShatteredGlass } from '@/lib/core/shatteredGlassDecode';
import { BundleError } from '@/lib/core/errors';

// A minimal GraphicsSpec header: 2 parts, 2 shattered-glass entries.
function syntheticHeader(glassCount = 2, glassPtr = 0x30): Uint8Array {
	const bytes = new Uint8Array(0x30 + 2 * 12 + 2 * 4 + 2 * 64);
	const dv = new DataView(bytes.buffer);
	const partsPtr = 0x30 + 2 * 12, locPtr = partsPtr + 8;
	dv.setUint32(0x00, 3, true);
	dv.setUint32(0x04, 2, true);
	dv.setUint32(0x08, partsPtr, true);
	dv.setUint32(0x0C, glassCount, true);
	dv.setUint32(0x10, glassPtr, true);
	dv.setUint32(0x14, locPtr, true);
	[[2, 1, 20], [3, 0, 16]].forEach(([model, part, type], i) => {
		dv.setUint32(0x30 + i * 12, model, true);
		dv.setUint32(0x30 + i * 12 + 4, part, true);
		dv.setUint32(0x30 + i * 12 + 8, type, true);
	});
	dv.setUint32(partsPtr, 0, true);
	dv.setUint32(partsPtr + 4, 1, true);
	return bytes;
}

describe('shattered-glass table decode', () => {
	it('reads each 12-byte entry', () => {
		const gs = parseGraphicsSpec(syntheticHeader(), [1n, 2n, 3n, 4n]);
		expect(gs.shatteredGlassParts).toEqual([
			{ modelImportIndex: 2, bodyPartIndex: 1, bodyPartType: 20 },
			{ modelImportIndex: 3, bodyPartIndex: 0, bodyPartType: 16 },
		]);
	});

	it('decodes an empty table when the count is zero', () => {
		expect(parseGraphicsSpec(syntheticHeader(0), [1n, 2n]).shatteredGlassParts).toEqual([]);
	});

	it('rejects a table that runs past the header', () => {
		expect(() => parseGraphicsSpec(syntheticHeader(2, 0x30 + 2 * 12 + 2 * 4 + 2 * 64 - 12), [])).toThrow(BundleError);
	});
});

const FIXTURE = path.resolve(__dirname, '../../../../example/VEH_CARBRWDS_GR.BIN');
const file = fs.readFileSync(FIXTURE);
const buffer = new Uint8Array(file).buffer;
const bundle = parseBundle(buffer);
const gs = parseGraphicsSpecData(extractResourceRaw(buffer, bundle, bundle.resources.find((r) => r.resourceTypeId === GRAPHICS_SPEC_TYPE_ID)!));

describe('shattered-glass parts of a retail car', () => {
	it('lists one model per pane, imported after the body-part models', () => {
		expect(gs.shatteredGlassParts).toHaveLength(gs.shatteredGlassPartsCount);
		expect(gs.shatteredGlassPartsCount).toBe(8);
		gs.shatteredGlassParts.forEach((g, i) => {
			expect(g.modelImportIndex).toBe(gs.partsCount + i);
			expect(g.bodyPartIndex).toBeLessThan(gs.partsCount);
			expect(g.bodyPartType).toBeGreaterThanOrEqual(16);
			expect(g.bodyPartType).toBeLessThan(24);
		});
	});

	it('resolves each to a renderable distinct from the body parts, on its body part locator', () => {
		const bodyRenderables = new Set(resolveGraphicsSpecParts(buffer, bundle, gs).map((p) => p.renderableId));
		const glass = resolveShatteredGlassParts(buffer, bundle, gs);
		expect(glass.map((g) => g.glassIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		for (const g of glass) {
			expect(g.renderableId).not.toBeNull();
			expect(bodyRenderables.has(g.renderableId)).toBe(false);
			expect(g.locator).toBe(gs.parts[g.bodyPartIndex].locator);
		}
	});

	it('decodes skinned meshes flagged with their pane slot bit and carrying the crack UV set', () => {
		const decoded = decodeShatteredGlass(buffer, bundle);
		expect(decoded).toHaveLength(8);
		for (const r of decoded) {
			expect(r.partIndex).toBe(r.glass.bodyPartIndex);
			expect(r.partLocator).toEqual(gs.parts[r.glass.bodyPartIndex].locator);
			for (const m of r.meshes) {
				expect(m.meshFlags & 0xff).toBe(1 << (r.glass.bodyPartType - 16));
				expect(m.geometry.getAttribute('skinIndex')).toBeDefined();
				expect(m.geometry.getAttribute('uv1')).toBeDefined();
			}
		}
	});
});

// Round-trip and edge-case tests for the Material parser+writer.
// The handler fixture already asserts byte-exact round-trip for the first
// Material in VEH_CARBRWDS_GR.BIN (see registry.test.ts). These tests:
//
//   - sweep every Material in the vehicle bundle to catch layout variants
//     the single-fixture test would miss;
//   - drive mutation scenarios (id swaps, state-array shuffles, the
//     size-changing cases where import counts change) to spec-pin the
//     writer's behaviour;
//   - exercise malformed-input rejection to lock in the size / bounds
//     checks.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from './bundle';
import { extractResourceRaw, resourceCtxFromBundle } from './registry';
import {
	parseMaterialData,
	writeMaterialData,
	MATERIAL_TYPE_ID,
	type ParsedMaterial,
	type MaterialImport,
} from './material';

const FIXTURE = path.resolve(__dirname, '../../../example/VEH_CARBRWDS_GR.BIN');

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

function loadAllMaterials(): Uint8Array[] {
	const file = fs.readFileSync(FIXTURE);
	const buf = new Uint8Array(file.byteLength);
	buf.set(file);
	const bundle = parseBundle(buf.buffer);
	const ctx = resourceCtxFromBundle(bundle);
	const out: Uint8Array[] = [];
	for (const r of bundle.resources) {
		if (r.resourceTypeId === MATERIAL_TYPE_ID) {
			out.push(extractResourceRaw(buf.buffer, bundle, r, ctx));
		}
	}
	return out;
}

describe('Material / real fixture sweep', () => {
	const materials = loadAllMaterials();

	it('finds multiple material instances in VEH_CARBRWDS_GR.BIN', () => {
		expect(materials.length).toBeGreaterThan(5);
	});

	it.each(materials.map((_, i) => i))(
		'parses and byte-exactly round-trips material index %i',
		(i) => {
			const raw = materials[i];
			const mat = parseMaterialData(raw);
			expect(mat.materialStateImports.length).toBe(mat.numMaterialStates);
			expect(mat.textureStateImports.length).toBe(mat.numTextureStates);
			const written = writeMaterialData(mat);
			expect(bytesEqual(written, raw), `material #${i} (size ${raw.byteLength}) not byte-exact`).toBe(true);
		},
	);
});

describe('Material / mutation scenarios', () => {
	function firstMaterial(): { raw: Uint8Array; mat: ParsedMaterial } {
		const raw = loadAllMaterials()[0];
		return { raw, mat: parseMaterialData(raw) };
	}

	it('flipping the shader id low bit round-trips cleanly', () => {
		const { mat } = firstMaterial();
		const flipped: ParsedMaterial = {
			...mat,
			shaderImport: { ...mat.shaderImport, id: mat.shaderImport.id ^ 1n },
		};
		const w1 = writeMaterialData(flipped);
		const reparsed = parseMaterialData(w1);
		expect(reparsed.shaderImport.id).toBe(flipped.shaderImport.id);
		const w2 = writeMaterialData(reparsed);
		expect(bytesEqual(w1, w2)).toBe(true);
	});

	it('reversing the material-state import order is idempotent', () => {
		const { mat } = firstMaterial();
		const reversed: ParsedMaterial = {
			...mat,
			materialStateImports: mat.materialStateImports.slice().reverse(),
		};
		const w1 = writeMaterialData(reversed);
		const reparsed = parseMaterialData(w1);
		for (let i = 0; i < reversed.materialStateImports.length; i++) {
			expect(reparsed.materialStateImports[i].id).toBe(reversed.materialStateImports[i].id);
		}
		const w2 = writeMaterialData(reparsed);
		expect(bytesEqual(w1, w2)).toBe(true);
	});

	it('rejects mismatched import-array length (count drift)', () => {
		const { mat } = firstMaterial();
		const bad: ParsedMaterial = {
			...mat,
			// counts stay the same; array drops one entry → writer must catch it
			materialStateImports: mat.materialStateImports.slice(0, -1),
		};
		expect(() => writeMaterialData(bad)).toThrow(/materialStateImports length/);
	});

	it('rejects u8 overflow on count fields', () => {
		const { mat } = firstMaterial();
		const bad: ParsedMaterial = {
			...mat,
			numMaterialStates: 300,
			materialStateImports: Array.from({ length: 300 }, (): MaterialImport => ({
				id: 0n, ptrOffset: 0, trailingPad: 0,
			})),
		};
		expect(() => writeMaterialData(bad)).toThrow(/overflow u8/);
	});
});

describe('Material / input validation', () => {
	it('rejects a truncated payload', () => {
		expect(() => parseMaterialData(new Uint8Array(16))).toThrow(/too small/);
	});

	it('rejects a payload where the import table would overlap the header', () => {
		// 64 bytes total (past the "too small" guard of 52), but
		// numMaterialStates=10 → import table = 11×16 = 176 bytes, which
		// leaves a negative offset and must be rejected.
		const buf = new Uint8Array(64);
		const dv = new DataView(buf.buffer);
		dv.setUint8(0x08, 10); // numMaterialStates
		dv.setUint8(0x09, 0);  // numTextureStates
		expect(() => parseMaterialData(buf)).toThrow(/does not fit/);
	});
});

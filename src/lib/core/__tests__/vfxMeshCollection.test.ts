// Gold coverage for parseVFXMeshCollection / writeVFXMeshCollection.
//
// PARTICLES.BUNDLE carries THREE collections but the auto-generated registry
// fixture suite only exercises the first resource of a type per bundle — so
// this suite walks all three, pins hand-verified decoded values, and pins the
// data facts the parser's rigid-layout asserts rely on (radius-table cycling,
// buffer-kind tags, descriptor arithmetic against muNumIndices/muNumVertices).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseVFXMeshCollection, writeVFXMeshCollection, VFX_RADIUS_SLOTS } from '../vfxMeshCollection';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const VFX_MESH_COLLECTION_TYPE_ID = 0x10019;

type Extracted = { name: string; raw: Uint8Array };

function loadCollections(): Extracted[] {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, 'example/PARTICLES.BUNDLE'));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const debugResources = typeof bundle.debugData === 'string' ? parseDebugDataFromXml(bundle.debugData) : [];
	return bundle.resources
		.filter((r) => r.resourceTypeId === VFX_MESH_COLLECTION_TYPE_ID)
		.map((r) => ({
			name: findDebugResourceById(debugResources, r.resourceId.low.toString(16))?.name ?? '?',
			raw: new Uint8Array(extractResourceRaw(buffer, bundle, r)),
		}));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const collections = loadCollections();

describe('VFXMeshCollection gold values (example/PARTICLES.BUNDLE)', () => {
	it('finds exactly three collections — the type id is 0x10019, not the wiki\'s 0x100019', () => {
		expect(collections.length).toBe(3);
		expect(collections.map((c) => c.name)).toEqual([
			'highres_debris_02.rf3',
			'lowres_debris.rf3',
			'Glass_debris.rf3',
		]);
	});

	it('decodes highres_debris_02.rf3', () => {
		const m = parseVFXMeshCollection(collections[0].raw);
		expect(m.muVersion).toBe(2);
		expect(m.textureName).toBe('highres_debris');
		expect(m.muNumIndices).toBe(7710);
		expect(m.muNumVertices).toBe(4182);
		expect(m.mafRadius.length).toBe(VFX_RADIUS_SLOTS);
		expect(m.mafRadius[0]).toBeCloseTo(0.1744, 3);
		expect(m.indexBuffers.length).toBe(1);
		expect(m.vertexBuffers.length).toBe(1);
		// Index data starts the body block: 7710 u16 indices = 15420 bytes,
		// align16 → 15424; vertices follow at that offset with stride 36
		// (4182 × 36 = 150552, align16 → 150560). Stride 0 on the VB is the
		// same "real stride lives in the VertexDescriptor" convention
		// Renderable uses.
		expect(m.indexBuffers[0]).toMatchObject({ muBufferKind: 3, muBodyOffset: 0, muByteLength: 15424, muStride: 2 });
		expect(m.vertexBuffers[0]).toMatchObject({ muBufferKind: 2, muBodyOffset: 15424, muByteLength: 150560, muStride: 0 });
		expect(m.indexBuffers[0]._pad0).toBe(0);
		expect(m._trailingPad.byteLength).toBe(28);
	});

	it('decodes lowres_debris.rf3 — short texture name shifts the whole tail', () => {
		const m = parseVFXMeshCollection(collections[1].raw);
		expect(m.textureName).toBe('WHITE');
		expect(m.muNumIndices).toBe(2124);
		expect(m.muNumVertices).toBe(1368);
		expect(m.indexBuffers[0]).toMatchObject({ muBufferKind: 3, muBodyOffset: 0, muByteLength: 4256, muStride: 2 });
		// 1368 × 36 = 49248 exactly — no alignment slack on this one.
		expect(m.vertexBuffers[0]).toMatchObject({ muBufferKind: 2, muBodyOffset: 4256, muByteLength: 49248, muStride: 0 });
		expect(m._trailingPad.byteLength).toBe(20);
	});

	it('decodes Glass_debris.rf3', () => {
		const m = parseVFXMeshCollection(collections[2].raw);
		expect(m.textureName).toBe('glass_debris');
		expect(m.muNumIndices).toBe(3072);
		expect(m.muNumVertices).toBe(1728);
		expect(m.indexBuffers[0]).toMatchObject({ muBufferKind: 3, muBodyOffset: 0, muByteLength: 6144, muStride: 2 });
		expect(m.vertexBuffers[0]).toMatchObject({ muBufferKind: 2, muBodyOffset: 6144, muByteLength: 62208, muStride: 0 });
	});

	it('radius slots cycle with the mesh count (13 / 8 / 3 meshes per collection)', () => {
		const cycles = [13, 8, 3];
		collections.forEach(({ name, raw }, i) => {
			const m = parseVFXMeshCollection(raw);
			for (let s = 0; s < VFX_RADIUS_SLOTS; s++) {
				expect(m.mafRadius[s], `${name} slot ${s}`).toBe(m.mafRadius[s % cycles[i]]);
			}
			// The cycle is minimal: slot[cycle-1] differs from slot[0] would not
			// prove it, but a shorter period repeating inside the cycle would —
			// check the first repeat really starts at `cycle`.
			expect(m.mafRadius[1], name).not.toBe(m.mafRadius[0]);
		});
	});

	it('trailing pads are all zero', () => {
		for (const { name, raw } of collections) {
			const m = parseVFXMeshCollection(raw);
			expect(m._trailingPad.every((b) => b === 0), name).toBe(true);
		}
	});
});

describe('VFXMeshCollection round-trip', () => {
	it('round-trips all three collections byte-for-byte', () => {
		for (const { name, raw } of collections) {
			const rewritten = writeVFXMeshCollection(parseVFXMeshCollection(raw));
			expect(rewritten.byteLength, name).toBe(raw.byteLength);
			expect(bytesEqual(rewritten, raw), name).toBe(true);
		}
	});

	it('writer is idempotent', () => {
		for (const { name, raw } of collections) {
			const first = writeVFXMeshCollection(parseVFXMeshCollection(raw));
			const second = writeVFXMeshCollection(parseVFXMeshCollection(first));
			expect(bytesEqual(first, second), name).toBe(true);
		}
	});

	it('a texture rename moves mpMeshHelper but preserves the descriptors', () => {
		const m = parseVFXMeshCollection(collections[0].raw);
		const renamed = parseVFXMeshCollection(writeVFXMeshCollection({ ...m, textureName: 'a_significantly_longer_texture_name' }));
		expect(renamed.textureName).toBe('a_significantly_longer_texture_name');
		expect(renamed.indexBuffers).toEqual(m.indexBuffers);
		expect(renamed.vertexBuffers).toEqual(m.vertexBuffers);
		expect(renamed.muNumVertices).toBe(m.muNumVertices);
	});

	it('writer rejects a radius table that is not exactly 32 slots', () => {
		const m = parseVFXMeshCollection(collections[0].raw);
		expect(() => writeVFXMeshCollection({ ...m, mafRadius: m.mafRadius.slice(0, 31) })).toThrow(/mafRadius/);
	});

	it('writer rejects a texture name containing NUL', () => {
		const m = parseVFXMeshCollection(collections[0].raw);
		expect(() => writeVFXMeshCollection({ ...m, textureName: 'bad\0name' })).toThrow(/NUL/);
	});

	it('parser rejects a corrupted mpTextureName pointer', () => {
		const corrupted = new Uint8Array(collections[0].raw);
		corrupted[0x90] = 0x98; // mpTextureName 0x94 → 0x98
		expect(() => parseVFXMeshCollection(corrupted)).toThrow(/mpTextureName/);
	});
});

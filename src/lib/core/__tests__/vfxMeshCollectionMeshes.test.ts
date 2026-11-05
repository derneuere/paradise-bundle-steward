// decodeVFXMeshes: the 32 transform slots of a debris mesh collection, split
// back into the distinct meshes the game draws one piece each with.

import { beforeAll, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { decodeVFXMeshes, meshForSlot, VFX_VERTEX_STRIDE } from '../vfxMeshCollectionMeshes';
import { parseVFXMeshCollection, VFX_RADIUS_SLOTS, type ParsedVFXMeshCollection } from '../vfxMeshCollection';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { getResourceBlocks } from '../resourceManager';

type V = { p: [number, number, number]; slot: number; n?: [number, number, number]; uv?: [number, number] };

// A collection body: indices first (u16), vertices after at `vbOffset`.
function synth(verts: V[], indices: number[], vbOffset = indices.length * 2): { model: ParsedVFXMeshCollection; body: Uint8Array } {
	const body = new Uint8Array(vbOffset + verts.length * VFX_VERTEX_STRIDE);
	const dv = new DataView(body.buffer);
	indices.forEach((x, i) => dv.setUint16(i * 2, x, true));
	verts.forEach((v, i) => {
		const o = vbOffset + i * VFX_VERTEX_STRIDE;
		const vals = [...v.p, v.slot + 0.5, ...(v.n ?? [0, 0, 1]), ...(v.uv ?? [0, 0])];
		vals.forEach((x, k) => dv.setFloat32(o + k * 4, x, true));
	});
	const desc = (kind: number, off: number, len: number, stride: number) => ({ muBufferKind: kind, muBodyOffset: off, muByteLength: len, muStride: stride, _pad0: 0, _unk4: 0 });
	return {
		body,
		model: {
			muVersion: 2, mafRadius: new Array(VFX_RADIUS_SLOTS).fill(0), muNumIndices: indices.length, muNumVertices: verts.length,
			textureName: 'WHITE', indexBuffers: [desc(3, 0, indices.length * 2, 2)], vertexBuffers: [desc(2, vbOffset, verts.length * VFX_VERTEX_STRIDE, 0)],
			_trailingPad: new Uint8Array(0),
		},
	};
}

const tri = (slot: number, s = 1): V[] => [{ p: [0, 0, 0], slot }, { p: [s, 0, 0], slot }, { p: [0, 2 * s, 0], slot }];

describe('decodeVFXMeshes (synthetic)', () => {
	it('splits the vertex stream by the transform slot in each position w, rebasing the indices', () => {
		const verts = [...tri(0), ...tri(1, 3)];
		const { model, body } = synth(verts, [0, 1, 2, 5, 4, 3], 16);
		const set = decodeVFXMeshes(model, body);
		expect(set.meshes.length).toBe(2);
		expect(set.slotMesh.slice(0, 3)).toEqual([0, 1, -1]);
		expect([...set.meshes[1].indices]).toEqual([0, 1, 2]);
		expect([...set.meshes[1].positions]).toEqual([0, 6, 0, 3, 0, 0, 0, 0, 0]);
		expect(set.meshes[0].radius).toBeCloseTo(Math.hypot(1, 2) / 2, 6);
		expect(set.meshes[1].radius).toBeCloseTo(Math.hypot(3, 6) / 2, 6);
	});

	it('reads normals and uvs, and folds slots that repeat a mesh onto one entry', () => {
		const a = tri(0).map((v, i) => ({ ...v, n: [0, 1, 0] as [number, number, number], uv: [i / 4, 1 - i / 4] as [number, number] }));
		const b = a.map((v) => ({ ...v, slot: 2 }));
		const c = tri(3).map((v) => ({ ...v, n: [0, 1, 0] as [number, number, number] }));
		const { model, body } = synth([...a, ...b, ...c], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
		const set = decodeVFXMeshes(model, body);
		expect(set.meshes.length).toBe(2);
		expect(set.slotMesh.slice(0, 4)).toEqual([0, -1, 0, 1]);
		expect([...set.meshes[0].normals.slice(0, 3)]).toEqual([0, 1, 0]);
		expect([...set.meshes[0].uvs]).toEqual([0, 1, 0.25, 0.75, 0.5, 0.5]);
	});

	it('picks a mesh by slot modulo 32', () => {
		const { model, body } = synth([...tri(0), ...tri(31, 2)], [0, 1, 2, 3, 4, 5]);
		const set = decodeVFXMeshes(model, body);
		expect(meshForSlot(set, 0)).toBe(0);
		expect(meshForSlot(set, 32)).toBe(0);
		expect(meshForSlot(set, 63)).toBe(1);
		expect(meshForSlot(set, -1)).toBe(1);
		expect(meshForSlot(set, 5)).toBe(-1);
	});

	it('rejects broken geometry instead of drawing garbage', () => {
		const ok = synth(tri(0), [0, 1, 2]);
		expect(() => decodeVFXMeshes({ ...ok.model, muNumIndices: 4 }, ok.body)).toThrow(/overrun/);
		expect(() => decodeVFXMeshes({ ...ok.model, muNumVertices: 4 }, ok.body)).toThrow(/overrun/);
		expect(() => decodeVFXMeshes({ ...ok.model, indexBuffers: [] }, ok.body)).toThrow(/no index/);
		expect(() => decodeVFXMeshes(ok.model, ok.body.subarray(0, 20))).toThrow(/body block/);
		const two = synth(tri(0), [0, 1, 2, 0]);
		expect(() => decodeVFXMeshes({ ...two.model, muNumIndices: 4, indexBuffers: [{ ...two.model.indexBuffers[0], muByteLength: 8 }] }, two.body)).toThrow(/triangle list/);
		const far = synth(tri(0), [0, 1, 3]);
		expect(() => decodeVFXMeshes(far.model, far.body)).toThrow(/past the 3/);
		const span = synth([...tri(0), ...tri(1)], [0, 1, 3]);
		expect(() => decodeVFXMeshes(span.model, span.body)).toThrow(/spans two slots/);
		const bad = synth([{ p: [0, 0, 0], slot: 32 }, ...tri(0).slice(1)], [0, 1, 2]);
		expect(() => decodeVFXMeshes(bad.model, bad.body)).toThrow(/slot 32/);
	});

	it('reads big-endian bodies too', () => {
		const { model, body } = synth(tri(0, 2), [0, 1, 2]);
		const be = new Uint8Array(body.length);
		const src = new DataView(body.buffer), dst = new DataView(be.buffer);
		for (let i = 0; i < 6; i += 2) dst.setUint16(i, src.getUint16(i, true), false);
		for (let o = 6; o < body.length; o += 4) dst.setFloat32(o, src.getFloat32(o, true), false);
		const le = decodeVFXMeshes(model, body), big = decodeVFXMeshes(model, be, false);
		expect([...big.meshes[0].positions]).toEqual([...le.meshes[0].positions]);
	});
});

const BUNDLE = path.resolve(__dirname, '../../../../example/PARTICLES.BUNDLE');

describe.skipIf(!fs.existsSync(BUNDLE))('decodeVFXMeshes (example/PARTICLES.BUNDLE)', () => {
	const load = () => {
		const buf = fs.readFileSync(BUNDLE);
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
		const bundle = parseBundle(ab);
		const dbg = typeof bundle.debugData === 'string' ? parseDebugDataFromXml(bundle.debugData) : [];
		return bundle.resources.filter((r) => r.resourceTypeId === 0x10019).map((r) => {
			const [header, body] = getResourceBlocks(ab, bundle, r);
			const model = parseVFXMeshCollection(header!);
			return { name: findDebugResourceById(dbg, r.resourceId.low.toString(16))?.name, model, set: decodeVFXMeshes(model, body!) };
		});
	};
	// Loaded in beforeAll: a skipped describe still runs its body, and the
	// fixture is absent in checkouts without the untracked example/ files.
	let all: ReturnType<typeof load> = [];
	beforeAll(() => { all = load(); });

	it('finds 13 / 8 / 3 distinct meshes cycling through the 32 slots, using every vertex and index', () => {
		expect(all.map((c) => c.name)).toEqual(['highres_debris_02.rf3', 'lowres_debris.rf3', 'Glass_debris.rf3']);
		[13, 8, 3].forEach((count, i) => {
			const { set, model } = all[i];
			expect(set.meshes.length).toBe(count);
			expect(set.slotMesh).toEqual(Array.from({ length: 32 }, (_, s) => s % count));
			const perSlot = set.slotMesh.map((m) => set.meshes[m]);
			expect(perSlot.reduce((a, m) => a + m.positions.length / 3, 0)).toBe(model.muNumVertices);
			expect(perSlot.reduce((a, m) => a + m.indices.length, 0)).toBe(model.muNumIndices);
		});
	});

	it('the radius table is each mesh\'s half bounding-box diagonal, so the meshes are at metre scale', () => {
		for (const { set, model } of all) {
			set.meshes.forEach((m, i) => expect(m.radius).toBeCloseTo(model.mafRadius[i], 3));
		}
	});

	it('the chunk meshes are 0.2 - 1.8 m across and the glass shards 2 - 4 cm, with unit normals', () => {
		// The longest side of the mesh's bounding box.
		const extent = (m: { positions: Float32Array }) => Math.max(...[0, 1, 2].map((k) => {
			const c = m.positions.filter((_, i) => i % 3 === k);
			return Math.max(...c) - Math.min(...c);
		}));
		const [high, low, glass] = all.map((c) => c.set.meshes.map(extent));
		expect(Math.min(...high, ...low)).toBeGreaterThan(0.2);
		expect(Math.max(...high, ...low)).toBeLessThan(1.8);
		expect(Math.min(...glass)).toBeGreaterThan(0.015);
		expect(Math.max(...glass)).toBeLessThan(0.045);
		const n = all[1].set.meshes[0].normals;
		expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 4);
	});
});

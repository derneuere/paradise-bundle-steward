// Geometry of a VFXMeshCollection (the debris / glass chunk meshes): decodes
// the secondary-memory body block that the header's buffer descriptors point
// into (see vfxMeshCollection.ts for the header).
//
// How the game draws a collection: ONE indexed draw of the whole index buffer
// per batch of up to 32 pieces, with 32 per-piece transforms in a constant
// array. Every vertex carries the transform it belongs to in its position's w
// (stored as slot + 0.5; the vertex program truncates it), so the collection is
// really 32 slot meshes laid end to end, and piece i of a batch is drawn as
// slot i's mesh. The build tool filled the 32 slots by cycling through the
// collection's distinct meshes (13 / 8 / 3 in retail), the same way it cycled
// the radius table, so a piece's look is picked by its position in its batch.
//
// The vertex is 36 bytes: position xyz + slot (f32 x4), normal (f32 x3), uv
// (f32 x2). Positions are in metres at scale 1; each piece scales its mesh by
// its own size (a burst's 0.05 - 0.12 makes a 0.5 - 1.7 m mesh a 3 - 20 cm
// chip). A slot's radius-table entry is half its bounding-box diagonal.

import type { ParsedVFXMeshCollection } from './vfxMeshCollection';
import { VFX_RADIUS_SLOTS } from './vfxMeshCollection';

export const VFX_VERTEX_STRIDE = 36;

export type VFXMesh = {
	positions: Float32Array; // xyz per vertex
	normals: Float32Array;   // xyz per vertex
	uvs: Float32Array;       // uv per vertex
	indices: Uint16Array;    // triangle list into this mesh's own vertices
	/** Half the bounding-box diagonal: what the collection's radius table holds. */
	radius: number;
};

export type VFXMeshSet = {
	/** The collection's distinct meshes, in first-slot order. */
	meshes: VFXMesh[];
	/** Mesh index drawn for each of the 32 slots; -1 for a slot with no geometry. */
	slotMesh: number[];
};

type SlotBuild = { globals: number[]; local: Map<number, number>; indices: number[] };

export function decodeVFXMeshes(model: ParsedVFXMeshCollection, body: Uint8Array, littleEndian = true): VFXMeshSet {
	const ib = model.indexBuffers[0], vb = model.vertexBuffers[0];
	if (!ib || !vb) throw new Error('VFXMeshCollection: no index or vertex buffer');
	const nv = model.muNumVertices, ni = model.muNumIndices;
	if (nv * VFX_VERTEX_STRIDE > vb.muByteLength) throw new Error(`VFXMeshCollection: ${nv} vertices overrun the ${vb.muByteLength}-byte vertex buffer`);
	if (ni * 2 > ib.muByteLength) throw new Error(`VFXMeshCollection: ${ni} indices overrun the ${ib.muByteLength}-byte index buffer`);
	if (ni % 3 !== 0) throw new Error(`VFXMeshCollection: ${ni} indices is not a triangle list`);
	if (vb.muBodyOffset + nv * VFX_VERTEX_STRIDE > body.byteLength || ib.muBodyOffset + ni * 2 > body.byteLength) {
		throw new Error('VFXMeshCollection: geometry overruns the body block');
	}
	const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
	const f = (o: number) => dv.getFloat32(o, littleEndian);
	const vtx = (i: number) => vb.muBodyOffset + i * VFX_VERTEX_STRIDE;

	const slotOf = new Int32Array(nv);
	for (let i = 0; i < nv; i++) {
		const s = Math.trunc(f(vtx(i) + 12));
		if (!(s >= 0 && s < VFX_RADIUS_SLOTS)) throw new Error(`VFXMeshCollection: vertex ${i} names transform slot ${s}`);
		slotOf[i] = s;
	}

	const slots: SlotBuild[] = Array.from({ length: VFX_RADIUS_SLOTS }, () => ({ globals: [], local: new Map(), indices: [] }));
	for (let t = 0; t < ni; t += 3) {
		const tri = [0, 1, 2].map((k) => dv.getUint16(ib.muBodyOffset + (t + k) * 2, littleEndian));
		for (const v of tri) if (v >= nv) throw new Error(`VFXMeshCollection: index ${v} past the ${nv} vertices`);
		const s = slotOf[tri[0]];
		if (slotOf[tri[1]] !== s || slotOf[tri[2]] !== s) throw new Error(`VFXMeshCollection: triangle ${t / 3} spans two slots`);
		const slot = slots[s];
		for (const v of tri) {
			let l = slot.local.get(v);
			if (l === undefined) { l = slot.globals.length; slot.local.set(v, l); slot.globals.push(v); }
			slot.indices.push(l);
		}
	}

	const meshes: VFXMesh[] = [];
	const slotMesh = slots.map((slot) => {
		if (slot.indices.length === 0) return -1;
		const mesh = buildMesh(slot, f, vtx);
		const same = meshes.findIndex((m) => sameMesh(m, mesh));
		if (same >= 0) return same;
		meshes.push(mesh);
		return meshes.length - 1;
	});
	return { meshes, slotMesh };
}

function buildMesh(slot: SlotBuild, f: (o: number) => number, vtx: (i: number) => number): VFXMesh {
	const n = slot.globals.length;
	const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
	const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
	slot.globals.forEach((g, i) => {
		const o = vtx(g);
		for (let k = 0; k < 3; k++) {
			const p = f(o + k * 4);
			positions[i * 3 + k] = p;
			normals[i * 3 + k] = f(o + 16 + k * 4);
			min[k] = Math.min(min[k], p);
			max[k] = Math.max(max[k], p);
		}
		uvs[i * 2] = f(o + 28);
		uvs[i * 2 + 1] = f(o + 32);
	});
	const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
	return { positions, normals, uvs, indices: Uint16Array.from(slot.indices), radius };
}

const sameArray = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (x: number, i: number) => x === b[i]);

function sameMesh(a: VFXMesh, b: VFXMesh): boolean {
	return sameArray(a.indices, b.indices) && sameArray(a.positions, b.positions)
		&& sameArray(a.normals, b.normals) && sameArray(a.uvs, b.uvs);
}

/** The mesh a debris piece is drawn with, from its position in its batch of 32 (-1 when that slot is empty). */
export function meshForSlot(set: VFXMeshSet, slot: number): number {
	return set.slotMesh[((slot % VFX_RADIUS_SLOTS) + VFX_RADIUS_SLOTS) % VFX_RADIUS_SLOTS];
}

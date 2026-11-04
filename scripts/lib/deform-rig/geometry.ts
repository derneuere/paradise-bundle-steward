// Vehicle body geometry for the rigging scripts: GraphicsSpec (0x10006) parts
// with their world-space mesh boxes, the target-body analysis the riggers place
// points onto, and the number of skin rows the body's meshes address.

import * as THREE from 'three';
import { parseBundle } from '../../../src/lib/core/bundle';
import { extractResourceRaw } from '../../../src/lib/core/registry';
import { parseGraphicsSpecData, resolveGraphicsSpecParts, GRAPHICS_SPEC_TYPE_ID } from '../../../src/lib/core/graphicsSpec';
import { decodeAllRenderables, locatorToMatrix4 } from '../../../src/lib/core/renderableDecode';
import { getRenderableBlocks, meshIndicesU16 } from '../../../src/lib/core/renderable';
import { u64ToBigInt } from '../../../src/lib/core/u64';
import type { Mat4, Vec3 } from '../../../src/lib/core/deformationSpec';
import { WHEEL_ARCH } from './parts';
import { readArrayBuffer } from './io';

const BONE_INDEXES = 13;
const BONE_WEIGHTS = 14;
const OFF_ORIGIN_EPS = 0.1;

export type GfxPart = {
	index: number;
	locator: Mat4;        // the GraphicsSpec part locator, as DeformationSpec rows
	translation: Vec3;
	box: THREE.Box3 | null;
	centroid: Vec3 | null;
	volume: number;
};

export type GfxBody = {
	parts: GfxPart[];
	// Rows of the per-car skin-offset array the meshes read (max blend index
	// + 1), or 0 when no mesh is skinned.
	skinRows: number;
};

// World-space box over the vertices a mesh actually indexes. The decoded
// position array covers the whole shared vertex buffer, so the geometry's own
// bounding box picks up other meshes' (and other layouts') bytes.
export function indexedBox(geometry: THREE.BufferGeometry, world: THREE.Matrix4): THREE.Box3 {
	const pos = geometry.getAttribute('position');
	const index = geometry.getIndex();
	const box = new THREE.Box3();
	const v = new THREE.Vector3();
	const n = index ? index.count : pos.count;
	for (let i = 0; i < n; i++) {
		const k = index ? index.getX(i) : i;
		if (k >= pos.count) continue;
		box.expandByPoint(v.fromBufferAttribute(pos, k).applyMatrix4(world));
	}
	return box;
}

export function readGfxBody(grPath: string): GfxBody {
	const ab = readArrayBuffer(grPath);
	const bundle = parseBundle(ab);
	const gsRes = bundle.resources.find((r) => r.resourceTypeId === GRAPHICS_SPEC_TYPE_ID);
	if (!gsRes) throw new Error(`${grPath} has no GraphicsSpec (0x10006)`);
	const gs = parseGraphicsSpecData(extractResourceRaw(ab, bundle, gsRes));
	const resolved = resolveGraphicsSpecParts(ab, bundle, gs);
	const { renderables } = decodeAllRenderables(ab, bundle, new Map(), false, 'graphics');
	const byId = new Map(renderables.map((r) => [r.resourceId, r]));

	const parts: GfxPart[] = resolved.map((part, index) => {
		const L = part.locator;
		const locator: Mat4 = [0, 1, 2, 3].map((r) => [L[r * 4], L[r * 4 + 1], L[r * 4 + 2], L[r * 4 + 3]]) as Mat4;
		const d = part.renderableId != null ? byId.get(part.renderableId) : undefined;
		let box: THREE.Box3 | null = null;
		if (d && d.meshes.length) {
			const m = locatorToMatrix4(L);
			box = new THREE.Box3();
			for (const mesh of d.meshes) box.union(indexedBox(mesh.geometry, m));
			if (box.isEmpty()) box = null;
		}
		const c = box?.getCenter(new THREE.Vector3());
		const s = box?.getSize(new THREE.Vector3());
		return {
			index, locator, translation: [L[12], L[13], L[14]],
			box, centroid: c ? [c.x, c.y, c.z] : null, volume: s ? s.x * s.y * s.z : 0,
		};
	});

	let maxIndex = -1;
	for (const r of renderables) {
		if (!r.parsed) continue;
		const entry = bundle.resources.find((e) => u64ToBigInt(e.resourceId) === r.resourceId);
		const body = entry ? getRenderableBlocks(ab, bundle, entry).body : null;
		if (!body) continue;
		const { vertexBuffer: vb, indexBuffer: ib } = r.parsed;
		for (const mesh of r.meshes) {
			const bi = mesh.vertexLayout?.find((a) => a.type === BONE_INDEXES);
			const bw = mesh.vertexLayout?.find((a) => a.type === BONE_WEIGHTS);
			const src = r.parsed.meshes.find((m) => m.startIndex === mesh.startIndex && m.numIndices === mesh.indexCount);
			if (!bi || !bw || !bi.stride || !src) continue;
			// Only the vertices this mesh's indices reach: a shared vertex buffer
			// can hold other meshes' vertices in a different layout.
			for (const idx of new Set(meshIndicesU16(body, ib, src))) {
				const base = vb.bodyOffset + (src.baseVertexIndex + idx) * bi.stride;
				for (let k = 0; k < 4; k++) {
					if (body[base + bw.offset + k] > 0) maxIndex = Math.max(maxIndex, body[base + bi.offset + k]);
				}
			}
		}
	}
	return { parts, skinRows: maxIndex + 1 };
}

export type Corner = { arch: number; gfx: number; position: Vec3 };

export type TargetBody = GfxBody & {
	corners: Map<number, Corner>;   // wheel-arch partType -> corner gfx part
	wheelMeshes: Set<number>;       // every gfx part a wheel part drives (corners included)
	wheelPartGfx: Map<number, number>; // wheel partType -> the mesh it should drive (arches + axle pairs)
	min: Vec3; max: Vec3; center: Vec3; half: Vec3;
	shellGfx: number;               // the largest non-corner part
};

// A corner part's position is its locator translation when it has one; mods
// often bake every part at an identity locator, so fall back to the mesh box.
const cornerPosition = (p: GfxPart): Vec3 =>
	Math.hypot(...p.translation) > OFF_ORIGIN_EPS ? p.translation : (p.centroid ?? p.translation);

// What the body's own DeformationSpec (when it has one) says about its meshes:
// which mesh each single-wheel arch drives, and every mesh any wheel part drives.
export type OwnWheelMeshes = { arches: Map<number, number>; pairs: Map<number, number>; all: number[] };

// Corners are the wheel-arch meshes the rig binds its arch parts to, in order
// of preference: --corners (four indices, sorted onto arches by position); the
// meshes the body's own spec binds to its arches; or, when exactly four parts
// sit off the body origin, those (mods often place only the arches that way).
// Every wheel mesh is kept out of the body box.
export function analyzeTarget(body: GfxBody, explicitCorners?: number[], own?: OwnWheelMeshes): TargetBody {
	const corners = new Map<number, Corner>();
	const add = (arch: number, i: number) => {
		const p = body.parts[i];
		if (!p) throw new Error(`no gfx part ${i}`);
		if (corners.has(arch)) throw new Error(`gfx parts ${corners.get(arch)!.gfx} and ${i} both sit at the same wheel corner`);
		corners.set(arch, { arch, gfx: i, position: cornerPosition(p) });
	};
	const bySign = (i: number) => {
		const pos = cornerPosition(body.parts[i]);
		return pos[2] > 0 ? (pos[0] < 0 ? WHEEL_ARCH.FL : WHEEL_ARCH.FR) : (pos[0] < 0 ? WHEEL_ARCH.RL : WHEEL_ARCH.RR);
	};
	const offOrigin = body.parts.filter((p) => Math.hypot(...p.translation) > OFF_ORIGIN_EPS).map((p) => p.index);
	if (explicitCorners) {
		if (explicitCorners.length !== 4) throw new Error('--corners takes four gfx part indices');
		for (const i of explicitCorners) add(bySign(i), i);
	} else if (own?.arches.size) {
		for (const [arch, i] of own.arches) add(arch, i);
	} else if (offOrigin.length === 4) {
		for (const i of offOrigin) add(bySign(i), i);
	}
	if (corners.size < 4) {
		console.warn(`[target] wheel-arch meshes found for ${corners.size}/4 corners; arch parts without one stay mesh-less `
			+ '(pass --corners a,b,c,d to bind all four)');
	}

	const wheelMeshes = new Set([...(own?.all ?? []), ...[...corners.values()].map((c) => c.gfx)]);
	const wheelPartGfx = new Map([...(own?.pairs ?? []), ...[...corners.values()].map((c) => [c.arch, c.gfx] as [number, number])]);
	const box = new THREE.Box3();
	let shellGfx = -1;
	for (const p of body.parts) {
		if (wheelMeshes.has(p.index) || !p.box) continue;
		box.union(p.box);
		if (shellGfx < 0 || p.volume > body.parts[shellGfx].volume) shellGfx = p.index;
	}
	if (box.isEmpty()) throw new Error('target has no decodable body meshes');
	const min: Vec3 = [box.min.x, box.min.y, box.min.z];
	const max: Vec3 = [box.max.x, box.max.y, box.max.z];
	return {
		...body, corners, wheelMeshes, wheelPartGfx, min, max, shellGfx,
		center: [0, 1, 2].map((k) => (min[k] + max[k]) / 2) as Vec3,
		half: [0, 1, 2].map((k) => (max[k] - min[k]) / 2) as Vec3,
	};
}

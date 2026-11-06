// A vehicle body as the crash simulator sees it: one entry per GraphicsSpec
// part (the index IK parts' partGraphics refer to) with its locator and LOD0
// meshes. Mesh geometry carries skinIndex / skinWeight: every vertex is pushed
// by its weighted deformation rows.

import * as THREE from 'three';
import { GRAPHICS_SPEC_TYPE_ID } from '@/lib/core/graphicsSpec';
import { decodeAllRenderables, locatorToMatrix4, type DecodedRenderable } from '@/lib/core/renderableDecode';
import { decodeShatteredGlass, type ShatteredGlassRenderable } from '@/lib/core/shatteredGlassDecode';
import type { ParsedBundle } from '@/lib/core/types';

export type CrashBodyPart = {
	gfx: number;
	locator: THREE.Matrix4;
	geometries: THREE.BufferGeometry[];
	meshFlags: number[];   // per geometry (window meshes carry their pane bit)
};

export type CrashBody = {
	parts: CrashBodyPart[];
	// World box over the indexed vertices (decoded position arrays span the
	// whole shared vertex buffer, so geometry.boundingBox is not usable).
	box: THREE.Box3;
	// Deformation rows the meshes read (highest weighted blend index + 1).
	skinRows: number;
	// The panes' shattered-glass models, drawn while a pane is cracked.
	glass: readonly ShatteredGlassRenderable[];
};

export function hasGraphicsSpec(bundle: ParsedBundle): boolean {
	return bundle.resources.some((r) => r.resourceTypeId === GRAPHICS_SPEC_TYPE_ID);
}

function maxBlendIndex(geometry: THREE.BufferGeometry): number {
	const si = geometry.getAttribute('skinIndex'), sw = geometry.getAttribute('skinWeight');
	const index = geometry.getIndex();
	if (!si || !sw || !index) return -1;
	let max = -1;
	for (let i = 0; i < index.count; i++) {
		const v = index.getX(i);
		for (let k = 0; k < 4; k++) if (sw.getComponent(v, k) > 0) max = Math.max(max, si.getComponent(v, k));
	}
	return max;
}

function indexedBox(geometry: THREE.BufferGeometry, world: THREE.Matrix4, into: THREE.Box3): void {
	const pos = geometry.getAttribute('position');
	const index = geometry.getIndex();
	const v = new THREE.Vector3();
	const n = index ? index.count : pos.count;
	for (let i = 0; i < n; i++) {
		const k = index ? index.getX(i) : i;
		if (k < pos.count) into.expandByPoint(v.fromBufferAttribute(pos, k).applyMatrix4(world));
	}
}

// Renderables decoded in GraphicsSpec mode carry their part index; anything
// else (the "all renderables" decode) has no part and can't be posed.
export function crashBodyFromDecoded(renderables: readonly DecodedRenderable[], glass: readonly ShatteredGlassRenderable[] = []): CrashBody {
	const byGfx = new Map<number, CrashBodyPart>();
	for (const r of renderables) {
		if (r.partIndex === undefined) continue;
		let part = byGfx.get(r.partIndex);
		if (!part) {
			part = { gfx: r.partIndex, locator: locatorToMatrix4(r.partLocator), geometries: [], meshFlags: [] };
			byGfx.set(r.partIndex, part);
		}
		part.geometries.push(...r.meshes.map((m) => m.geometry));
		part.meshFlags.push(...r.meshes.map((m) => m.meshFlags ?? 0));
	}
	const parts = [...byGfx.values()].sort((a, b) => a.gfx - b.gfx);
	const box = new THREE.Box3();
	let maxIndex = -1;
	for (const p of parts) {
		for (const g of p.geometries) { indexedBox(g, p.locator, box); maxIndex = Math.max(maxIndex, maxBlendIndex(g)); }
	}
	return { parts, box, skinRows: maxIndex + 1, glass };
}

export function decodeCrashBody(bundle: ParsedBundle, buffer: ArrayBuffer): CrashBody {
	if (!hasGraphicsSpec(bundle)) throw new Error('bundle has no GraphicsSpec');
	return crashBodyFromDecoded(decodeAllRenderables(buffer, bundle, new Map(), false, 'graphics').renderables, decodeShatteredGlass(buffer, bundle));
}

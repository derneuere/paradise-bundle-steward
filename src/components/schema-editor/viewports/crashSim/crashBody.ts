// Decodes a vehicle _GR bundle into the pieces the crash simulator draws:
// one entry per GraphicsSpec part (the index IK parts' partGraphics refer to)
// with its locator and LOD0 meshes. Mesh geometry carries skinIndex /
// skinWeight: every vertex is pushed by its weighted deformation rows.

import * as THREE from 'three';
import { extractResourceRaw } from '@/lib/core/registry';
import { parseGraphicsSpecData, resolveGraphicsSpecParts, GRAPHICS_SPEC_TYPE_ID } from '@/lib/core/graphicsSpec';
import { decodeAllRenderables, locatorToMatrix4 } from '@/lib/core/renderableDecode';
import type { ParsedBundle } from '@/lib/core/types';

export type CrashBodyPart = {
	gfx: number;
	locator: THREE.Matrix4;
	geometries: THREE.BufferGeometry[];
};

export type CrashBody = {
	parts: CrashBodyPart[];
	// World box over the indexed vertices (decoded position arrays span the
	// whole shared vertex buffer, so geometry.boundingBox is not usable).
	box: THREE.Box3;
	// Deformation rows the meshes read (highest weighted blend index + 1).
	skinRows: number;
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

export function decodeCrashBody(bundle: ParsedBundle, buffer: ArrayBuffer): CrashBody {
	const gsRes = bundle.resources.find((r) => r.resourceTypeId === GRAPHICS_SPEC_TYPE_ID);
	if (!gsRes) throw new Error('bundle has no GraphicsSpec');
	const gs = parseGraphicsSpecData(extractResourceRaw(buffer, bundle, gsRes));
	const resolved = resolveGraphicsSpecParts(buffer, bundle, gs);
	const { renderables } = decodeAllRenderables(buffer, bundle, new Map(), false, 'graphics');
	const byId = new Map(renderables.map((r) => [r.resourceId, r]));

	const box = new THREE.Box3();
	let maxIndex = -1;
	const parts = resolved.map((p, gfx) => {
		const locator = locatorToMatrix4(p.locator);
		const decoded = p.renderableId != null ? byId.get(p.renderableId) : undefined;
		const geometries = decoded?.meshes.map((m) => m.geometry) ?? [];
		for (const g of geometries) { indexedBox(g, locator, box); maxIndex = Math.max(maxIndex, maxBlendIndex(g)); }
		return { gfx, locator, geometries };
	});
	return { parts, box, skinRows: maxIndex + 1 };
}

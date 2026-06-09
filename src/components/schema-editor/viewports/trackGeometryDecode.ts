// Track-unit geometry decode — turns an InstanceList (0x23) into placed grey
// meshes for the WorldViewport.
//
// An InstanceList places Models (0x2A) in the world at a per-instance
// transform; rendering it draws the track-unit geometry under the props (same
// world space as PropInstanceData / static traffic vehicles). The data flow,
// per docs/instance-list-spec.md "Render plan":
//
//   InstanceList.instances[i]                          (i < muNumInstances)
//     → mpModel import @ field offset (0x10 + i*0x50)  → Model resourceId
//     → Model (0x2A) resource in this bundle           (skip if absent —
//                                                        backdrop/neighbour
//                                                        models are imported
//                                                        but not present)
//     → Model's Renderable (0xC) imports               → BufferGeometry each
//     → grey mesh at Matrix4.fromArray(mTransform)     (bottom row patched)
//
// Scope: grey, untextured geometry only. Textures/shaders live in companion
// bundles (GLOBALTEXTUREDICTIONARY.BIN / SHADERS.BNDL) and are out of scope —
// grey geometry is enough to give props spatial context. This module is pure
// (no React, no THREE materials): it returns BufferGeometry + a 16-float
// matrix per placed mesh so the decode can be unit-tested in node and the
// React layer owns material/scene-graph concerns.

import * as THREE from 'three';
import type { ParsedBundle, ResourceEntry } from '@/lib/core/types';
import { getImportsByPtrOffset, getImportIds } from '@/lib/core/bundle';
import { MODEL_TYPE_ID } from '@/lib/core/model';
import {
	RENDERABLE_TYPE_ID,
	VERTEX_DESCRIPTOR_TYPE_ID,
	getRenderableBlocks,
	parseRenderable,
	parseVertexDescriptor,
	pickPrimaryVertexDescriptor,
	decodeVertexArrays,
	meshIndicesU16,
	findResourceById,
	type ParsedVertexDescriptor,
	type RenderableMesh,
} from '@/lib/core/renderable';
import { extractResourceSize, isCompressed, decompressData } from '@/lib/core/resourceManager';
import { u64ToBigInt } from '@/lib/core/u64';
import { parseInstanceList, INSTANCE_LIST_TYPE_ID } from '@/lib/core/instanceList';

// Instance record geometry, mirrored from instanceList.ts so the import
// resolution can key off each instance's mpModel field offset without
// re-deriving the layout. mpModel sits at the start of each 0x50 record, and
// the array begins at 0x10 (mpaInstances is always 0x10).
const INSTANCES_OFFSET = 0x10;
const INSTANCE_RECORD_SIZE = 0x50;

/** One decoded, world-placed track mesh: grey geometry + its instance matrix. */
export type PlacedTrackMesh = {
	geometry: THREE.BufferGeometry;
	/** World transform from the instance's mTransform (bottom row patched). */
	matrix: THREE.Matrix4;
	/** Resolved Model resourceId — handy for debugging / future picking. */
	modelId: bigint;
	/** Renderable resourceId the geometry came from. */
	renderableId: bigint;
};

export type TrackGeometryResult = {
	meshes: PlacedTrackMesh[];
	/** Complete instances the InstanceList declared (muNumInstances). */
	instanceCount: number;
	/** Instances whose Model resolved to a present 0x2A resource. */
	resolvedModels: number;
};

/**
 * Build a THREE.Matrix4 from a 16-float Matrix44Affine, patching the bottom
 * row to (0,0,0,1). The on-disk pad slots (e[3]/e[7]/e[11]/e[15]) are zero —
 * the same fixup the static-vehicle / prop placers apply so the affine
 * transform is well-formed for THREE. fromArray reads column-major, which is
 * the storage order of these matrices.
 */
export function instanceTransformToMatrix4(transform: number[]): THREE.Matrix4 {
	const m = new THREE.Matrix4();
	m.fromArray(transform);
	const e = m.elements;
	e[3] = 0;
	e[7] = 0;
	e[11] = 0;
	e[15] = 1;
	return m;
}

// Decode one Renderable resource to grey BufferGeometries — the geometry-only
// subset of renderableDecodedContext's decodeOneRenderable (no materials, no
// textures, since the track is rendered untextured). Returns [] on any decode
// failure so one bad renderable never sinks the whole track.
function decodeRenderableGeometries(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	resource: ResourceEntry,
	resourceIndex: number,
	vdCache: Map<bigint, ParsedVertexDescriptor | null>,
): THREE.BufferGeometry[] {
	const out: THREE.BufferGeometry[] = [];
	try {
		const { header, body } = getRenderableBlocks(buffer, bundle, resource);
		if (!body) return out;
		const imports = getImportsByPtrOffset(bundle.imports, bundle.resources, resourceIndex);
		const renderable = parseRenderable(header, imports);

		const resolveVd = (id: bigint): ParsedVertexDescriptor | null => {
			if (vdCache.has(id)) return vdCache.get(id)!;
			const entry = findResourceById(bundle, id);
			if (!entry || entry.resourceTypeId !== VERTEX_DESCRIPTOR_TYPE_ID) {
				vdCache.set(id, null);
				return null;
			}
			const size = extractResourceSize(entry.sizeAndAlignmentOnDisk[0]);
			if (size <= 0) {
				vdCache.set(id, null);
				return null;
			}
			const start = (bundle.header.resourceDataOffsets[0] + entry.diskOffsets[0]) >>> 0;
			let bytes: Uint8Array = new Uint8Array(buffer, start, size);
			if (isCompressed(bytes)) bytes = decompressData(bytes) as Uint8Array;
			let parsed: ParsedVertexDescriptor | null = null;
			try {
				parsed = parseVertexDescriptor(bytes);
			} catch {
				parsed = null;
			}
			vdCache.set(id, parsed);
			return parsed;
		};

		const vertCache = new Map<string, ReturnType<typeof decodeVertexArrays>>();
		const decodeFor = (mesh: RenderableMesh): ReturnType<typeof decodeVertexArrays> | null => {
			const picked = pickPrimaryVertexDescriptor(mesh, resolveVd);
			if (!picked) return null;
			const key = JSON.stringify(picked.descriptor.attributes.map((a) => [a.type, a.offset, a.stride]));
			let arrays = vertCache.get(key);
			if (!arrays) {
				arrays = decodeVertexArrays(body, renderable.vertexBuffer, picked.descriptor);
				vertCache.set(key, arrays);
			}
			return arrays;
		};

		for (const mesh of renderable.meshes) {
			if (mesh.numIndices === 0) continue;
			if (mesh.primitiveType !== 4) continue; // 4 = D3DPT_TRIANGLELIST — the only type we render
			const arrays = decodeFor(mesh);
			if (!arrays || arrays.vertexCount === 0) continue;

			const indices = new Uint16Array(meshIndicesU16(body, renderable.indexBuffer, mesh));
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
			if (arrays.normals) {
				geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
			}
			geometry.setIndex(new THREE.BufferAttribute(indices, 1));
			if (!arrays.normals) geometry.computeVertexNormals();
			geometry.computeBoundingSphere();
			out.push(geometry);
		}
	} catch {
		// A single malformed renderable shouldn't blank the whole track.
		return out;
	}
	return out;
}

/**
 * Decode a Model (0x2A) resource — by its resourceId, within `bundle` — into
 * grey geometries: Model → its Renderable (0xC) imports → BufferGeometry each.
 * Returns [] when the Model isn't present in `bundle` (it may live in a
 * companion bundle), isn't a Model, or yields no triangle-list geometry.
 *
 * Shared by the track decoder (each InstanceList entry's Model) and the prop
 * decoder (each prop type's Model via PropGraphicsList). `bundle`/`buffer` are
 * the Model's HOME bundle — for props that may differ from the bundle holding
 * the PropGraphicsList, since prop Models live in GLOBALPROPS.BIN.
 */
export function decodeModelGeometries(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	modelId: bigint,
	vdCache: Map<bigint, ParsedVertexDescriptor | null>,
): { geometry: THREE.BufferGeometry; renderableId: bigint }[] {
	const out: { geometry: THREE.BufferGeometry; renderableId: bigint }[] = [];
	const modelEntry = findResourceById(bundle, modelId);
	if (!modelEntry || modelEntry.resourceTypeId !== MODEL_TYPE_ID) return out;
	const modelIndex = bundle.resources.indexOf(modelEntry);
	const renderableIds = getImportIds(bundle.imports, bundle.resources, modelIndex);
	for (const rid of renderableIds) {
		const rEntry = findResourceById(bundle, rid);
		if (!rEntry || rEntry.resourceTypeId !== RENDERABLE_TYPE_ID) continue;
		const rIndex = bundle.resources.indexOf(rEntry);
		for (const geometry of decodeRenderableGeometries(buffer, bundle, rEntry, rIndex, vdCache)) {
			out.push({ geometry, renderableId: rid });
		}
	}
	return out;
}

/**
 * Decode a track-unit bundle's InstanceList into world-placed grey geometries.
 *
 * Walks the first `muNumInstances` instances (the complete, renderable ones —
 * the array over-allocates and the tail references external/backdrop models
 * with stale transforms). For each, resolves the Model via the import table,
 * decodes the Model's Renderable imports, and emits one PlacedTrackMesh per
 * mesh at the instance's transform. Instances whose Model isn't present in
 * this bundle are skipped (backdrop/neighbour models are imported but absent).
 *
 * Pure — no React, no scene graph. The caller wraps each geometry in a grey
 * material and adds it to the scene.
 */
export function decodeTrackGeometry(
	bundle: ParsedBundle,
	buffer: ArrayBuffer,
): TrackGeometryResult {
	const empty: TrackGeometryResult = { meshes: [], instanceCount: 0, resolvedModels: 0 };

	const ilEntry = bundle.resources.find((r) => r.resourceTypeId === INSTANCE_LIST_TYPE_ID);
	if (!ilEntry) return empty;

	const ilIndex = bundle.resources.indexOf(ilEntry);
	let il;
	try {
		const size = extractResourceSize(ilEntry.sizeAndAlignmentOnDisk[0]);
		if (size <= 0) return empty;
		const start = (bundle.header.resourceDataOffsets[0] + ilEntry.diskOffsets[0]) >>> 0;
		let bytes: Uint8Array = new Uint8Array(buffer, start, size);
		if (isCompressed(bytes)) bytes = decompressData(bytes) as Uint8Array;
		il = parseInstanceList(bytes);
	} catch {
		return empty;
	}

	// mpModel for each instance is a BND2 import keyed by the instance's
	// mpModel field offset (0x10 + i*0x50). Resolve them all up front.
	const modelImports = getImportsByPtrOffset(bundle.imports, bundle.resources, ilIndex);

	const meshes: PlacedTrackMesh[] = [];
	const vdCache = new Map<bigint, ParsedVertexDescriptor | null>();
	// Cache decoded geometries per Model so repeated model placements (a track
	// unit can place the same Model many times) decode once.
	const geomCache = new Map<bigint, { geometry: THREE.BufferGeometry; renderableId: bigint }[]>();
	let resolvedModels = 0;

	const instanceCount = Math.min(il.muNumInstances, il.instances.length);
	for (let i = 0; i < instanceCount; i++) {
		const fieldOffset = INSTANCES_OFFSET + i * INSTANCE_RECORD_SIZE; // mpModel at record offset 0x00
		const modelId = modelImports.get(fieldOffset);
		if (modelId == null) continue;

		const modelEntry = findResourceById(bundle, modelId);
		// Backdrop / neighbour-chunk models are imported but not present in this
		// bundle — only locally-present Models contribute to the rendered track.
		if (!modelEntry || modelEntry.resourceTypeId !== MODEL_TYPE_ID) continue;
		resolvedModels++;

		let modelGeoms = geomCache.get(modelId);
		if (!modelGeoms) {
			modelGeoms = [];
			const modelIndex = bundle.resources.indexOf(modelEntry);
			const renderableIds = getImportIds(bundle.imports, bundle.resources, modelIndex);
			for (const rid of renderableIds) {
				const rEntry = findResourceById(bundle, rid);
				if (!rEntry || rEntry.resourceTypeId !== RENDERABLE_TYPE_ID) continue;
				const rIndex = bundle.resources.indexOf(rEntry);
				for (const geometry of decodeRenderableGeometries(buffer, bundle, rEntry, rIndex, vdCache)) {
					modelGeoms.push({ geometry, renderableId: rid });
				}
			}
			geomCache.set(modelId, modelGeoms);
		}

		if (modelGeoms.length === 0) continue;

		const matrix = instanceTransformToMatrix4(il.instances[i].mWorldTransform);
		for (const g of modelGeoms) {
			meshes.push({ geometry: g.geometry, matrix, modelId, renderableId: g.renderableId });
		}
	}

	return { meshes, instanceCount, resolvedModels };
}

/**
 * Free the GPU buffers of every geometry in a decoded mesh list.
 *
 * The decode shares one BufferGeometry across all placements of a Model (see
 * `geomCache` above — a track unit can place the same Model many times), so a
 * single geometry object appears in many PlacedTrackMesh entries. Dedupe by
 * identity so each is disposed exactly once.
 *
 * This exists because react-three-fiber only auto-disposes objects it builds
 * declaratively from JSX args; geometry handed in via the `geometry` prop is
 * the caller's to free. Without this, each load → close cycle of a large track
 * (~440k verts for TRK9) leaks its buffers on the GPU until the context is
 * lost. Pure (no React) so it can be unit-tested in node.
 */
export function disposeTrackGeometries(meshes: PlacedTrackMesh[]): void {
	const seen = new Set<THREE.BufferGeometry>();
	for (const m of meshes) {
		if (seen.has(m.geometry)) continue;
		seen.add(m.geometry);
		m.geometry.dispose();
	}
}

/** Shared grey material for the untextured track backdrop. */
export const TRACK_MATERIAL_COLOR = 0x8a8f99;

// re-exported so the test/spec doesn't have to reach into u64 separately.
export { u64ToBigInt };

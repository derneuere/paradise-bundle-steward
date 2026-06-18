// Pure (React-free) Renderable decode pipeline.
//
// parseRenderable → resolve imports → decode vertex arrays → build
// THREE.BufferGeometry → resolve material textures. Extracted out of the
// schema-editor's renderableDecodedContext so the same decoder feeds three
// consumers without dragging React in:
//   - the workspace viewport (via the React provider that wraps this),
//   - the inspector's material card,
//   - the headless render CLI (scripts/render-car.ts), which needs the exact
//     same DecodedRenderable[] the viewport draws to be a faithful proxy.
//
// THREE is used only for BufferGeometry / Matrix4 / Sphere math — no
// react-three-fiber, no DOM. Safe to import under Node (tsx).

import * as THREE from 'three';
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
	type ParsedRenderable,
	type RenderableMesh,
} from './renderable';
import {
	GRAPHICS_SPEC_TYPE_ID,
	getGraphicsSpecHeader,
	parseGraphicsSpec,
	resolveGraphicsSpecParts,
	type RawLocator,
} from './graphicsSpec';
import { getImportsByPtrOffset, getImportIds } from './bundle';
import { extractResourceSize, isResourceBlockCompressed, decompressData } from './resourceManager';
import { u64ToBigInt } from './u64';
import {
	resolveMaterialTextures,
	type ResolvedMaterial,
	type TextureSourceBundle,
	type ShaderNameMap,
} from './materialChain';
import type { DecodedTexture } from './texture';
import type { ParsedBundle, ResourceEntry } from './types';

// =============================================================================
// Types
// =============================================================================

export type DecodedMesh = {
	geometry: THREE.BufferGeometry;
	vertexCount: number;
	indexCount: number;
	boundingMatrix: Float32Array;
	materialAssemblyId: bigint | null;
	vertexDescriptorIds: (bigint | null)[];
	startIndex: number;
	primitiveType: number;
	resolvedMaterial: ResolvedMaterial | null;
	vertexLayout: { type: number; offset: number; stride: number }[] | null;
};

export type DecodedRenderable = {
	resourceId: bigint;
	debugName: string | null;
	/** Raw parsed struct, imports resolved. Null when the header parse failed
	 *  so the consumer can show a "parse error" placeholder. */
	parsed: ParsedRenderable | null;
	meshes: DecodedMesh[];
	partLocator?: RawLocator;
	error?: string;
};

export type DecodeMode = 'all' | 'graphics';

// =============================================================================
// Decoder
// =============================================================================

export function decodeOneRenderable(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	resource: ResourceEntry,
	debugName: string | null,
	vdCache: Map<bigint, ParsedVertexDescriptor | null>,
	textureCache: Map<bigint, DecodedTexture | null>,
	materialCache: Map<bigint, ResolvedMaterial | null>,
	secondarySources: TextureSourceBundle[] = [],
	shaderNames: ShaderNameMap | null = null,
): DecodedRenderable {
	const resourceId = u64ToBigInt(resource.resourceId);
	try {
		const { header, body } = getRenderableBlocks(buffer, bundle, resource);
		if (!body) {
			return { resourceId, debugName, parsed: null, meshes: [], error: 'no body block' };
		}
		const resourceIndex = bundle.resources.indexOf(resource);
		const imports = getImportsByPtrOffset(bundle.imports, bundle.resources, resourceIndex);
		const renderable: ParsedRenderable = parseRenderable(header, imports);

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
			if (isResourceBlockCompressed(entry, 0, bytes)) bytes = decompressData(bytes) as Uint8Array;
			let parsed: ParsedVertexDescriptor | null = null;
			try {
				parsed = parseVertexDescriptor(bytes);
			} catch {
				parsed = null;
			}
			vdCache.set(id, parsed);
			return parsed;
		};

		const meshes: DecodedMesh[] = [];
		const vertCache = new Map<string, ReturnType<typeof decodeVertexArrays>>();

		const decodeFor = (mesh: RenderableMesh): { arrays: ReturnType<typeof decodeVertexArrays>; layout: DecodedMesh['vertexLayout'] } | null => {
			const picked = pickPrimaryVertexDescriptor(mesh, resolveVd);
			if (!picked) return null;
			const key = JSON.stringify(picked.descriptor.attributes.map((a) => [a.type, a.offset, a.stride]));
			let arrays = vertCache.get(key);
			if (!arrays) {
				arrays = decodeVertexArrays(body, renderable.vertexBuffer, picked.descriptor);
				vertCache.set(key, arrays);
			}
			const layout = picked.descriptor.attributes.map(a => ({ type: a.type, offset: a.offset, stride: a.stride }));
			return { arrays, layout };
		};

		for (const mesh of renderable.meshes) {
			if (mesh.numIndices === 0) continue;
			if (mesh.primitiveType !== 4) continue;
			const decoded = decodeFor(mesh);
			if (!decoded || decoded.arrays.vertexCount === 0) continue;
			const { arrays, layout: vertexLayout } = decoded;

			const indices = meshIndicesU16(body, renderable.indexBuffer, mesh);
			const indicesCopy = new Uint16Array(indices);

			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
			if (arrays.normals) {
				geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
			}
			if (arrays.tangents) {
				geometry.setAttribute('tangent', new THREE.BufferAttribute(arrays.tangents, 4));
			}
			if (arrays.uv1) {
				geometry.setAttribute('uv', new THREE.BufferAttribute(arrays.uv1, 2));
			}
			geometry.setIndex(new THREE.BufferAttribute(indicesCopy, 1));
			if (!arrays.normals) geometry.computeVertexNormals();
			geometry.computeBoundingBox();
			geometry.computeBoundingSphere();

			let resolved: ResolvedMaterial | null = null;
			if (mesh.materialAssemblyId) {
				if (materialCache.has(mesh.materialAssemblyId)) {
					resolved = materialCache.get(mesh.materialAssemblyId) ?? null;
				} else {
					try {
						resolved = resolveMaterialTextures(buffer, bundle, mesh.materialAssemblyId, textureCache, secondarySources, shaderNames);
					} catch {
						resolved = null;
					}
					materialCache.set(mesh.materialAssemblyId, resolved);
				}
			}

			meshes.push({
				geometry,
				vertexCount: arrays.vertexCount,
				indexCount: indicesCopy.length,
				boundingMatrix: mesh.boundingMatrix,
				materialAssemblyId: mesh.materialAssemblyId,
				vertexDescriptorIds: mesh.vertexDescriptorIds,
				startIndex: mesh.startIndex,
				primitiveType: mesh.primitiveType,
				resolvedMaterial: resolved,
				vertexLayout,
			});
		}

		return { resourceId, debugName, parsed: renderable, meshes };
	} catch (err) {
		return {
			resourceId,
			debugName,
			parsed: null,
			meshes: [],
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export function decodeAllRenderables(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	debugNames: Map<string, string>,
	includeNonLOD0: boolean,
	mode: DecodeMode,
	secondarySources: TextureSourceBundle[] = [],
	shaderNames: ShaderNameMap | null = null,
): { renderables: DecodedRenderable[]; totalMeshes: number; failed: number } {
	const vdCache = new Map<bigint, ParsedVertexDescriptor | null>();
	const textureCache = new Map<bigint, DecodedTexture | null>();
	const materialCache = new Map<bigint, ResolvedMaterial | null>();
	const out: DecodedRenderable[] = [];
	let totalMeshes = 0;
	let failed = 0;

	const idKeyOf = (r: ResourceEntry) =>
		u64ToBigInt(r.resourceId).toString(16).replace(/^0+(?=.)/, '');
	const nameFor = (r: ResourceEntry) => debugNames.get(idKeyOf(r)) ?? null;
	const isLodN = (name: string | null) => name !== null && /_LOD[1-9]\d*$/.test(name);
	const decodeAndPush = (r: ResourceEntry, locator?: RawLocator) => {
		const decoded = decodeOneRenderable(buffer, bundle, r, nameFor(r), vdCache, textureCache, materialCache, secondarySources, shaderNames);
		if (locator) decoded.partLocator = locator;
		if (decoded.error) failed++;
		totalMeshes += decoded.meshes.length;
		out.push(decoded);
	};

	if (mode === 'graphics') {
		const gsResource = bundle.resources.find((r) => r.resourceTypeId === GRAPHICS_SPEC_TYPE_ID);
		if (gsResource) {
			try {
				const gsHeader = getGraphicsSpecHeader(buffer, bundle, gsResource);
				const gsIndex = bundle.resources.indexOf(gsResource);
				const gsImportIds = getImportIds(bundle.imports, bundle.resources, gsIndex);
				const gs = parseGraphicsSpec(gsHeader, gsImportIds);
				const parts = resolveGraphicsSpecParts(buffer, bundle, gs);
				for (const part of parts) {
					if (!part.renderableId) continue;
					let rEntry: ResourceEntry | null = null;
					for (const r of bundle.resources) {
						if (u64ToBigInt(r.resourceId) === part.renderableId) {
							rEntry = r;
							break;
						}
					}
					if (!rEntry || rEntry.resourceTypeId !== RENDERABLE_TYPE_ID) continue;
					if (extractResourceSize(rEntry.sizeAndAlignmentOnDisk[1]) <= 0) continue;
					if (!includeNonLOD0 && isLodN(nameFor(rEntry))) continue;
					decodeAndPush(rEntry, part.locator);
				}
				return { renderables: out, totalMeshes, failed };
			} catch (err) {
				console.warn('[renderableDecode] GraphicsSpec drive failed, falling back to all mode:', err);
			}
		}
	}

	for (const r of bundle.resources) {
		if (r.resourceTypeId !== RENDERABLE_TYPE_ID) continue;
		if (extractResourceSize(r.sizeAndAlignmentOnDisk[1]) <= 0) continue;
		if (!includeNonLOD0 && isLodN(nameFor(r))) continue;
		decodeAndPush(r);
	}

	return { renderables: out, totalMeshes, failed };
}

/** Compute a bounding sphere over all decoded meshes so the viewport camera
 *  can frame the model. Uses a median-centered 90% cutoff so a single outlier
 *  mesh doesn't balloon the radius and push the camera too far out. */
export function computeSceneBounds(renderables: DecodedRenderable[]): THREE.Sphere {
	type Item = { center: THREE.Vector3; radius: number };
	const items: Item[] = [];
	for (const r of renderables) {
		for (const m of r.meshes) {
			if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
			const s = m.geometry.boundingSphere;
			if (!s) continue;
			items.push({ center: s.center.clone(), radius: s.radius });
		}
	}
	if (items.length === 0) return new THREE.Sphere(new THREE.Vector3(), 1);

	const xs = items.map((i) => i.center.x).sort((a, b) => a - b);
	const ys = items.map((i) => i.center.y).sort((a, b) => a - b);
	const zs = items.map((i) => i.center.z).sort((a, b) => a - b);
	const mid = (a: number[]) => a[Math.floor(a.length / 2)];
	const medianCenter = new THREE.Vector3(mid(xs), mid(ys), mid(zs));

	const sorted = items
		.map((i) => ({ ...i, dist: i.center.distanceTo(medianCenter) }))
		.sort((a, b) => a.dist - b.dist);
	const keep = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.9)));

	const box = new THREE.Box3();
	for (const it of keep) {
		const min = it.center.clone().subScalar(it.radius);
		const max = it.center.clone().addScalar(it.radius);
		box.expandByPoint(min);
		box.expandByPoint(max);
	}
	const sphere = new THREE.Sphere();
	box.getBoundingSphere(sphere);
	return sphere;
}

/** Build a THREE.Matrix4 from a GraphicsSpec part locator (16 floats). */
export function locatorToMatrix4(locator: RawLocator | undefined): THREE.Matrix4 {
	const m = new THREE.Matrix4();
	if (!locator || locator.length !== 16) return m;
	m.fromArray(Array.from(locator));
	return m;
}

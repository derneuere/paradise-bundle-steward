// Shared decode state for the Renderable schema editor.
//
// Before this provider existed, the viewport owned the entire 3D-decode
// pipeline: parseRenderable → resolve imports → decode vertex arrays →
// resolve material textures → produce a DecodedRenderable[]. That was fine
// for a pure-viewport page, but the schema editor needs to expose the same
// data to:
//
//   1. The hierarchy tree — the tree only lists the currently-decoded
//      renderables so tree order matches 3D order.
//   2. The inspector's "Materials & Textures" extension — the card shows
//      texture thumbs + shader info + OBB matrix for the selected mesh,
//      which all come from the decoded data, not from the raw parser.
//   3. The viewport itself — still the primary consumer.
//
// Lifting the decode pass to this provider means all three consumers see
// the same set of renderables under the same decode-mode + LOD filter, and
// the tree automatically reshuffles when the user toggles GraphicsSpec /
// all / LOD0 / all LODs.
//
// The provider also owns the "slow UI state" that influences decoding
// (decode mode, LOD filter, loaded texture packs, shader name map).
// "Fast" viewport state (wireframe, paint color, selection highlight)
// stays local to the viewport.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useBundle } from '@/context/BundleContext';
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
} from '@/lib/core/renderable';
import {
	GRAPHICS_SPEC_TYPE_ID,
	getGraphicsSpecHeader,
	parseGraphicsSpec,
	resolveGraphicsSpecParts,
	type RawLocator,
} from '@/lib/core/graphicsSpec';
import { getImportsByPtrOffset, getImportIds, parseBundle } from '@/lib/core/bundle';
import { extractResourceSize, isCompressed, decompressData } from '@/lib/core/resourceManager';
import { u64ToBigInt } from '@/lib/core/u64';
import {
	resolveMaterialTextures,
	parseShaderNameMap,
	type ResolvedMaterial,
	type TextureSourceBundle,
	type ShaderNameMap,
} from '@/lib/core/materialChain';
import type { DecodedTexture } from '@/lib/core/texture';
import type { ParsedBundle, ResourceEntry } from '@/lib/core/types';

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
// Decoder — pure functions, no React. Lifted verbatim from the old
// RenderablePage / RenderableViewport so a single instance of the pipeline
// feeds every consumer.
// =============================================================================

function decodeOneRenderable(
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

function decodeAllRenderables(
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
				console.warn('[RenderableDecodedContext] GraphicsSpec drive failed, falling back to all mode:', err);
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

/** Build a THREE.Matrix4 from a 12-float GraphicsSpec part locator. */
export function locatorToMatrix4(locator: RawLocator | undefined): THREE.Matrix4 {
	const m = new THREE.Matrix4();
	if (!locator || locator.length !== 16) return m;
	m.fromArray(Array.from(locator));
	return m;
}

// =============================================================================
// React provider
// =============================================================================

export type RenderableDecodedValue = {
	/** Full decoded result from the current decode pass. Null until the
	 *  bundle is loaded and the first memo runs. */
	decoded: { renderables: DecodedRenderable[]; totalMeshes: number; failed: number } | null;
	/** ParsedRenderable[] aligned with `filteredWrappedIndex` — what the
	 *  schema editor's tree walks. Every entry is guaranteed to be a
	 *  successfully-parsed ParsedRenderable (failed parses are skipped). */
	filteredParsed: ParsedRenderable[];
	/** Parallel to `filteredParsed`. Debug-resolved names (e.g.
	 *  `P_CA_Sportscar_Body_Bonnet_LOD0`) for each wrapped entry. Null when
	 *  the RST didn't know the resource. */
	filteredDebugNames: (string | null)[];
	/** Parallel to `filteredParsed`. Pre-computed triangle count for label
	 *  callbacks that don't have React context access. */
	filteredTriCounts: number[];
	/** wrappedIndex → DecodedRenderable. Extensions use this to look up the
	 *  card data for the currently-selected renderable. */
	byWrappedIndex: Map<number, DecodedRenderable>;
	/** wrappedIndex → the corresponding index into `decoded.renderables`. The
	 *  viewport uses this to highlight the mesh referenced by the schema
	 *  editor's selectedPath. */
	wrappedToDecodedIndex: number[];
	/** decodedIndex → wrappedIndex. The viewport's click handler uses this
	 *  to translate a clicked mesh back into the schema editor's path space. */
	decodedToWrappedIndex: Map<number, number>;

	// UI state that influences decoding.
	decodeMode: DecodeMode;
	setDecodeMode: (m: DecodeMode) => void;
	includeNonLOD0: boolean;
	setIncludeNonLOD0: (b: boolean) => void;
	textureBundles: TextureSourceBundle[];
	textureBundleNames: string[];
	loadTexturePack: () => Promise<void>;
	shaderNameMap: ShaderNameMap | null;
};

const RenderableDecodedContext = createContext<RenderableDecodedValue | null>(null);

export function useRenderableDecoded(): RenderableDecodedValue | null {
	return useContext(RenderableDecodedContext);
}

export function RenderableDecodedProvider({ children }: { children: React.ReactNode }) {
	const { loadedBundle, originalArrayBuffer, debugResources } = useBundle();
	const [decodeMode, setDecodeMode] = useState<DecodeMode>('graphics');
	const [includeNonLOD0, setIncludeNonLOD0] = useState(false);
	const [textureBundles, setTextureBundles] = useState<TextureSourceBundle[]>([]);
	const [textureBundleNames, setTextureBundleNames] = useState<string[]>([]);
	const [shaderNameMap, setShaderNameMap] = useState<ShaderNameMap | null>(null);

	// Auto-load SHADERS.BNDL from the example directory if available. Same
	// side-effect the old RenderablePage ran at mount; moved up to the
	// provider so every consumer sees the shader name map.
	useEffect(() => {
		fetch('/example/SHADERS.BNDL')
			.then(r => { if (!r.ok) throw new Error('not found'); return r.arrayBuffer(); })
			.then(ab => {
				const map = parseShaderNameMap(ab);
				setShaderNameMap(map);
			})
			.catch(() => { /* SHADERS.BNDL not available, shader names will be null */ });
	}, []);

	const loadTexturePack = useCallback(async () => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.BIN,.BNDL,.BUNDLE,.bin,.bndl,.bundle';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			const ab = await file.arrayBuffer();
			try {
				const bundle = parseBundle(ab);
				setTextureBundles(prev => [...prev, { buffer: ab, bundle }]);
				setTextureBundleNames(prev => [...prev, file.name]);
			} catch (e) {
				console.warn('Failed to parse texture bundle:', e);
			}
		};
		input.click();
	}, []);

	const debugNames = useMemo(() => {
		const norm = (s: string) => s.toLowerCase().replace(/^0x/, '').replace(/^0+(?=.)/, '');
		const m = new Map<string, string>();
		for (const d of debugResources) {
			if (d.id && d.name) m.set(norm(d.id), d.name);
		}
		return m;
	}, [debugResources]);

	const decoded = useMemo(() => {
		if (!loadedBundle || !originalArrayBuffer) return null;
		const result = decodeAllRenderables(
			originalArrayBuffer,
			loadedBundle,
			debugNames,
			includeNonLOD0,
			decodeMode,
			textureBundles,
			shaderNameMap,
		);
		// Debug helper — still handy for inspecting the decoded scene from
		// the devtools console while reproducing user reports.
		(window as unknown as Record<string, unknown>).__decoded = result;
		return result;
	}, [loadedBundle, originalArrayBuffer, debugNames, includeNonLOD0, decodeMode, textureBundles, shaderNameMap]);

	// Derive the ParsedRenderable array the schema editor walks. Failed
	// parses are dropped; everything else is kept in decode order so a click
	// in 3D lines up with the tree row.
	const {
		filteredParsed,
		filteredDebugNames,
		filteredTriCounts,
		byWrappedIndex,
		wrappedToDecodedIndex,
		decodedToWrappedIndex,
	} = useMemo(() => {
		if (!decoded) {
			return {
				filteredParsed: [] as ParsedRenderable[],
				filteredDebugNames: [] as (string | null)[],
				filteredTriCounts: [] as number[],
				byWrappedIndex: new Map<number, DecodedRenderable>(),
				wrappedToDecodedIndex: [] as number[],
				decodedToWrappedIndex: new Map<number, number>(),
			};
		}
		const parsed: ParsedRenderable[] = [];
		const names: (string | null)[] = [];
		const tris: number[] = [];
		const byWi = new Map<number, DecodedRenderable>();
		const wtoD: number[] = [];
		const dtoW = new Map<number, number>();
		let wi = 0;
		for (let di = 0; di < decoded.renderables.length; di++) {
			const dr = decoded.renderables[di];
			if (!dr.parsed) continue;
			parsed.push(dr.parsed);
			names.push(dr.debugName);
			// Tri count from the PARSED struct (not the decoded meshes), so the
			// count still reflects the raw mesh list even when some meshes
			// were filtered out of 3D rendering (numIndices === 0, etc.).
			let t = 0;
			for (const m of dr.parsed.meshes) {
				if (m.primitiveType === 4) t += Math.floor(m.numIndices / 3);
			}
			tris.push(t);
			byWi.set(wi, dr);
			wtoD.push(di);
			dtoW.set(di, wi);
			wi++;
		}
		return {
			filteredParsed: parsed,
			filteredDebugNames: names,
			filteredTriCounts: tris,
			byWrappedIndex: byWi,
			wrappedToDecodedIndex: wtoD,
			decodedToWrappedIndex: dtoW,
		};
	}, [decoded]);

	const value = useMemo<RenderableDecodedValue>(() => ({
		decoded,
		filteredParsed,
		filteredDebugNames,
		filteredTriCounts,
		byWrappedIndex,
		wrappedToDecodedIndex,
		decodedToWrappedIndex,
		decodeMode,
		setDecodeMode,
		includeNonLOD0,
		setIncludeNonLOD0,
		textureBundles,
		textureBundleNames,
		loadTexturePack,
		shaderNameMap,
	}), [
		decoded,
		filteredParsed,
		filteredDebugNames,
		filteredTriCounts,
		byWrappedIndex,
		wrappedToDecodedIndex,
		decodedToWrappedIndex,
		decodeMode,
		includeNonLOD0,
		textureBundles,
		textureBundleNames,
		loadTexturePack,
		shaderNameMap,
	]);

	return (
		<RenderableDecodedContext.Provider value={value}>
			{children}
		</RenderableDecodedContext.Provider>
	);
}

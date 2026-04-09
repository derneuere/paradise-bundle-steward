// Renderable viewer page.
//
// Walks every Renderable resource in the loaded bundle, parses each one
// (header + body + imports), decodes positions/normals/uv1, and shoves the
// result into a three.js scene under <Canvas>. Each mesh becomes one
// THREE.BufferGeometry; multiple geometries inside one Renderable share the
// same vertex Float32Arrays via aliased BufferAttributes.
//
// Bypasses the registry's parseRaw shortcut: that path can only return ONE
// resource per type, but a car bundle has 100+ Renderables and the user wants
// all of them in the scene.

import { useEffect, useMemo, useState, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useBundle } from '@/context/BundleContext';
import {
	RENDERABLE_TYPE_ID,
	VERTEX_DESCRIPTOR_TYPE_ID,
	getRenderableBlocks,
	readInlineImportTable,
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
import { extractResourceSize, isCompressed, decompressData } from '@/lib/core/resourceManager';
import { u64ToBigInt } from '@/lib/core/u64';
import type { ParsedBundle, ResourceEntry } from '@/lib/core/types';

// =============================================================================
// Decoded scene model
// =============================================================================

type DecodedMesh = {
	// We hand three.js a fully-built BufferGeometry per mesh. The vertex
	// buffers are SHARED across all meshes within one Renderable (zero-copy
	// alias of the same Float32Array), but each mesh gets its own index slice.
	geometry: THREE.BufferGeometry;
	vertexCount: number;
	indexCount: number;
	// The 64-byte Matrix44 stored at the start of each RenderableMesh struct.
	// CONFIRMED to be an oriented bounding box descriptor — see
	// docs/Renderable_findings.md §5.1. Kept here so the viewer's debugging
	// toggle can re-apply it as a Matrix4.
	boundingMatrix: Float32Array;
	// Resolved imports for the part info panel. May be null if the import
	// table didn't reach this slot.
	materialAssemblyId: bigint | null;
	vertexDescriptorIds: (bigint | null)[];
	// Per-mesh draw parameters (raw from the RenderableMesh struct).
	startIndex: number;
	primitiveType: number;
};

type DecodedRenderable = {
	resourceId: bigint;
	debugName: string | null;
	meshes: DecodedMesh[];
	/** Set when this Renderable was reached via the GraphicsSpec → Model →
	 *  Renderable chain. Holds the 12 raw floats of the part's locator so the
	 *  viewer can try multiple matrix interpretations live. Null otherwise. */
	partLocator?: RawLocator;
	error?: string;
};

// =============================================================================
// Renderable enumeration + decode
// =============================================================================

/**
 * Walk a single Renderable resource and produce zero-or-more
 * THREE.BufferGeometry instances ready to add to a scene.
 *
 * Errors are caught and stored on the result so one bad Renderable doesn't
 * sink the whole car. The viewer renders the rest and surfaces the error
 * count in the UI.
 */
function decodeOneRenderable(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	resource: ResourceEntry,
	debugName: string | null,
	vdCache: Map<bigint, ParsedVertexDescriptor | null>,
): DecodedRenderable {
	const resourceId = u64ToBigInt(resource.resourceId);
	try {
		const { header, body } = getRenderableBlocks(buffer, bundle, resource);
		if (!body) {
			return { resourceId, debugName, meshes: [], error: 'no body block' };
		}
		const imports = readInlineImportTable(header, resource);
		const renderable: ParsedRenderable = parseRenderable(header, imports);

		// Resolve a VD by id, with caching since one VD is often shared across
		// many meshes / many Renderables.
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
			let bytes = new Uint8Array(buffer, start, size);
			if (isCompressed(bytes)) bytes = decompressData(bytes);
			let parsed: ParsedVertexDescriptor | null = null;
			try {
				parsed = parseVertexDescriptor(bytes);
			} catch {
				parsed = null;
			}
			vdCache.set(id, parsed);
			return parsed;
		};

		// Each mesh picks its own primary VD (most attributes wins). All VDs
		// in a Renderable should report the same stride, so the shared vertex
		// arrays we decode below using mesh[0]'s VD are valid for every mesh.
		// We still re-pick per mesh in case a future asset breaks that.
		const meshes: DecodedMesh[] = [];
		// Cache decoded vertex arrays per stride+attribute-set so we don't decode
		// the same buffer six times. Key on the JSON of the attribute layout.
		const vertCache = new Map<string, ReturnType<typeof decodeVertexArrays>>();

		const decodeFor = (mesh: RenderableMesh) => {
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
			if (mesh.primitiveType !== 4) continue; // only TRIANGLELIST
			const arrays = decodeFor(mesh);
			if (!arrays || arrays.vertexCount === 0) continue;

			const indices = meshIndicesU16(body, renderable.indexBuffer, mesh);
			// meshIndicesU16 returns a view into the body block. three.js's
			// BufferAttribute will hold a reference to it, so we need to make a
			// stable copy that won't be reused after we leave this function.
			const indicesCopy = new Uint16Array(indices);

			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
			if (arrays.normals) {
				geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
			}
			if (arrays.uv1) {
				geometry.setAttribute('uv', new THREE.BufferAttribute(arrays.uv1, 2));
			}
			geometry.setIndex(new THREE.BufferAttribute(indicesCopy, 1));
			if (!arrays.normals) geometry.computeVertexNormals();
			geometry.computeBoundingBox();
			geometry.computeBoundingSphere();

			meshes.push({
				geometry,
				vertexCount: arrays.vertexCount,
				indexCount: indicesCopy.length,
				boundingMatrix: mesh.boundingMatrix,
				materialAssemblyId: mesh.materialAssemblyId,
				vertexDescriptorIds: mesh.vertexDescriptorIds,
				startIndex: mesh.startIndex,
				primitiveType: mesh.primitiveType,
			});
		}

		return { resourceId, debugName, meshes };
	} catch (err) {
		return {
			resourceId,
			debugName,
			meshes: [],
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Decode every Renderable in a bundle. Memoized via useMemo by the page so
 * loading a new bundle (or just toggling LOD filtering) replays cleanly.
 *
 * The vdCache is intentionally function-scoped so it can be reused across
 * every Renderable in one decode pass — VertexDescriptor resources are
 * heavily shared (~15 unique VDs for ~100 Renderables in our sample).
 */
/**
 * Source-of-truth modes for which Renderables get decoded.
 *
 *   'all'        — walk every Renderable in the bundle. Open-doors car for
 *                  VEH_CARBRWDS_GR.BIN because there's no per-part transform.
 *                  Same code path as the very first pass.
 *
 *   'graphics'   — start from the GraphicsSpec (one per vehicle bundle), follow
 *                  each part → its Model → the Model's LOD0 Renderable, and
 *                  attach the part's locator. The viewer applies the locator
 *                  as a THREE.Matrix4 — when it's the right interpretation,
 *                  the doors close.
 */
export type DecodeMode = 'all' | 'graphics';

function decodeAllRenderables(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	debugNames: Map<string, string>,
	includeNonLOD0: boolean,
	mode: DecodeMode,
): { renderables: DecodedRenderable[]; totalMeshes: number; failed: number } {
	const vdCache = new Map<bigint, ParsedVertexDescriptor | null>();
	const out: DecodedRenderable[] = [];
	let totalMeshes = 0;
	let failed = 0;

	const idKeyOf = (r: ResourceEntry) =>
		u64ToBigInt(r.resourceId).toString(16).replace(/^0+(?=.)/, '');
	const nameFor = (r: ResourceEntry) => debugNames.get(idKeyOf(r)) ?? null;
	const isLodN = (name: string | null) => name !== null && /_LOD[1-9]\d*$/.test(name);
	const decodeAndPush = (r: ResourceEntry, locator?: RawLocator) => {
		const decoded = decodeOneRenderable(buffer, bundle, r, nameFor(r), vdCache);
		if (locator) decoded.partLocator = locator;
		if (decoded.error) failed++;
		totalMeshes += decoded.meshes.length;
		out.push(decoded);
	};

	if (mode === 'graphics') {
		// Find the first GraphicsSpec in the bundle. There's only ever one for
		// a vehicle, but we don't enforce — bundles without one fall back to
		// 'all' mode below.
		const gsResource = bundle.resources.find((r) => r.resourceTypeId === GRAPHICS_SPEC_TYPE_ID);
		if (gsResource) {
			try {
				const gsHeader = getGraphicsSpecHeader(buffer, bundle, gsResource);
				const gs = parseGraphicsSpec(gsHeader, gsResource);
				const parts = resolveGraphicsSpecParts(buffer, bundle, gs);
				for (const part of parts) {
					if (!part.renderableId) continue;
					// Find the Renderable resource entry.
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
				console.warn('[RenderablePage] GraphicsSpec drive failed, falling back to all mode:', err);
				// fall through to 'all'
			}
		}
	}

	// 'all' mode: every Renderable in the bundle, no part transforms.
	for (const r of bundle.resources) {
		if (r.resourceTypeId !== RENDERABLE_TYPE_ID) continue;
		if (extractResourceSize(r.sizeAndAlignmentOnDisk[1]) <= 0) continue;
		if (!includeNonLOD0 && isLodN(nameFor(r))) continue;
		decodeAndPush(r);
	}

	return { renderables: out, totalMeshes, failed };
}

// =============================================================================
// React component
// =============================================================================

// Per-mesh boundingMatrix experiment toggle. CONFIRMED to be an OBB descriptor
// (not a transform), kept as a debugging aid — see docs/Renderable_findings.md
// §5.1.
//
//   'none'      — ignore boundingMatrix (default; correct for rendering)
//   'matrix'    — apply as full Matrix4 (visibly distorts; OBB squash)
//   'translate' — apply only translation column (small offsets, OBB centers)
type TransformMode = 'none' | 'matrix' | 'translate';

// GraphicsSpec part-locator interpretation. The locator is 16 floats, stored
// row-major in OpenGL/OpenTK convention (translation in the BOTTOM ROW, not
// the right column). Two viewer modes:
//
//   'fromArray' — `Matrix4.fromArray(floats)` reads column-major, which
//                 effectively transposes the on-disk row-major bytes into
//                 the column-major three.js form. This is the correct mode
//                 for stride-64 locators in BP PC bundles.
//
//   'rowSet'    — Use `Matrix4.set()` directly with row-major args. This is
//                 INCORRECT for OpenTK-style data but kept as a debugging
//                 toggle in case we hit a bundle with the alternate
//                 (translation-in-right-column) layout.
type LocatorMode = 'fromArray' | 'rowSet';

/**
 * Build a THREE.Matrix4 from a 16-float locator. See LocatorMode comments.
 * Returns identity if locator is undefined.
 */
function locatorToMatrix4(locator: RawLocator | undefined, mode: LocatorMode): THREE.Matrix4 {
	const m = new THREE.Matrix4();
	if (!locator || locator.length !== 16) return m;
	if (mode === 'fromArray') {
		// On-disk row-major + bottom-row translation → reading column-major
		// gives the equivalent column-major matrix with right-column translation.
		m.fromArray(Array.from(locator));
		return m;
	}
	// rowSet: literal row-major interpretation. Translation is then in the
	// 4th column of the on-disk data, which is wrong for OpenTK-style data.
	m.set(
		locator[0], locator[1], locator[2], locator[3],
		locator[4], locator[5], locator[6], locator[7],
		locator[8], locator[9], locator[10], locator[11],
		locator[12], locator[13], locator[14], locator[15],
	);
	return m;
}

/**
 * One <mesh> per DecodedMesh. Flat-shaded, single material per renderable so
 * the camera framing is obvious. We share the same MeshStandardMaterial across
 * everything for now — texturing is a follow-up.
 *
 * Each Renderable can carry a `partLocator` from the GraphicsSpec parts table.
 * When present, every mesh inside that Renderable gets transformed by the
 * locator (interpreted via `locatorMode`). The mesh-level `transformMode`
 * (boundingMatrix experiment) is applied AFTER the part locator if both are
 * active — though in practice you'd run one or the other.
 *
 * Each <mesh> also carries onClick / onPointerOver / onPointerOut handlers
 * that surface (renderableIndex, meshIndex) selection state to the parent
 * page. The currently selected/hovered mesh swaps to a tinted material so
 * the user can see what they picked. r3f's raycaster handles the picking
 * for us — no manual raycasts needed.
 */
function RenderableMeshes({
	renderables,
	transformMode,
	locatorMode,
	selected,
	hovered,
	onSelect,
	onHover,
}: {
	renderables: DecodedRenderable[];
	transformMode: TransformMode;
	locatorMode: LocatorMode;
	selected: { ri: number; mi: number } | null;
	hovered: { ri: number; mi: number } | null;
	onSelect: (sel: { ri: number; mi: number } | null) => void;
	onHover: (sel: { ri: number; mi: number } | null) => void;
}) {
	const baseMaterial = useMemo(
		() => new THREE.MeshStandardMaterial({ color: 0xb0b8c0, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide }),
		[],
	);
	const hoverMaterial = useMemo(
		() => new THREE.MeshStandardMaterial({ color: 0x5fa8ff, metalness: 0.1, roughness: 0.5, side: THREE.DoubleSide, emissive: 0x113355, emissiveIntensity: 0.4 }),
		[],
	);
	const selectedMaterial = useMemo(
		() => new THREE.MeshStandardMaterial({ color: 0xffaa33, metalness: 0.1, roughness: 0.5, side: THREE.DoubleSide, emissive: 0x664400, emissiveIntensity: 0.6 }),
		[],
	);
	useEffect(() => () => {
		baseMaterial.dispose();
		hoverMaterial.dispose();
		selectedMaterial.dispose();
	}, [baseMaterial, hoverMaterial, selectedMaterial]);

	// Build the per-mesh THREE.Matrix4 once per (renderables, transformMode,
	// locatorMode) change. The matrix is `partLocator * meshMatrix` where
	// either factor may be identity.
	const matrices = useMemo(() => {
		const out: (THREE.Matrix4 | null)[][] = [];
		for (const r of renderables) {
			// Per-Renderable part locator (from GraphicsSpec), built once per renderable.
			const partMatrix = r.partLocator ? locatorToMatrix4(r.partLocator, locatorMode) : null;
			const row: (THREE.Matrix4 | null)[] = [];
			for (const m of r.meshes) {
				let meshMatrix: THREE.Matrix4 | null = null;
				if (transformMode !== 'none') {
					meshMatrix = new THREE.Matrix4();
					meshMatrix.fromArray(Array.from(m.boundingMatrix));
					if (transformMode === 'translate') {
						const tx = meshMatrix.elements[12];
						const ty = meshMatrix.elements[13];
						const tz = meshMatrix.elements[14];
						meshMatrix.identity();
						meshMatrix.setPosition(tx, ty, tz);
					}
				}
				// Combine: world = part * mesh.
				if (partMatrix && meshMatrix) {
					row.push(new THREE.Matrix4().multiplyMatrices(partMatrix, meshMatrix));
				} else if (partMatrix) {
					row.push(partMatrix);
				} else if (meshMatrix) {
					row.push(meshMatrix);
				} else {
					row.push(null);
				}
			}
			out.push(row);
		}
		return out;
	}, [renderables, transformMode, locatorMode]);

	return (
		<>
			{renderables.map((r, ri) =>
				r.meshes.map((m, mi) => {
					const mat = matrices[ri][mi];
					const isSelected = selected !== null && selected.ri === ri && selected.mi === mi;
					const isHovered = hovered !== null && hovered.ri === ri && hovered.mi === mi;
					const meshMaterial = isSelected ? selectedMaterial : isHovered ? hoverMaterial : baseMaterial;
					return (
						<mesh
							key={`${r.resourceId.toString(16)}-${mi}`}
							geometry={m.geometry}
							material={meshMaterial}
							matrixAutoUpdate={mat === null}
							matrix={mat ?? undefined}
							onClick={(e) => {
								// Stop bubbling so we don't select multiple meshes that happen
								// to overlap under the cursor; r3f sorts hits by distance, so
								// the closest mesh is the one we want.
								e.stopPropagation();
								onSelect({ ri, mi });
							}}
							onPointerOver={(e) => {
								e.stopPropagation();
								onHover({ ri, mi });
								document.body.style.cursor = 'pointer';
							}}
							onPointerOut={(e) => {
								e.stopPropagation();
								onHover(null);
								document.body.style.cursor = 'auto';
							}}
						/>
					);
				}),
			)}
		</>
	);
}

/**
 * Compute a bounding sphere over all decoded meshes so OrbitControls can frame
 * the model. Naively unioning every mesh's box pulls the camera way out when
 * a single Renderable has a junk vertex / oversized OBB / debug primitive — we
 * saw this on a fresh load: a few outliers ballooned the radius from ~1.5m to
 * ~30m and the car looked like a pixel.
 *
 * Instead we collect each mesh's centroid + radius, then keep the central 90%
 * by distance from the median centroid. The remaining set is unioned for the
 * final sphere. This is an empirical filter, not a principled one — it just
 * gives sensible camera framing on the BP car bundles we have.
 */
function computeSceneBounds(renderables: DecodedRenderable[]): THREE.Sphere {
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

	// Median centroid (per axis) — robust to outliers.
	const xs = items.map((i) => i.center.x).sort((a, b) => a - b);
	const ys = items.map((i) => i.center.y).sort((a, b) => a - b);
	const zs = items.map((i) => i.center.z).sort((a, b) => a - b);
	const mid = (a: number[]) => a[Math.floor(a.length / 2)];
	const medianCenter = new THREE.Vector3(mid(xs), mid(ys), mid(zs));

	// Keep the central 90% by distance from medianCenter.
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

/**
 * Right-side panel that shows details for the currently selected (or hovered)
 * mesh: parent Renderable id, debug name, mesh index, vertex/index counts,
 * material assembly id, and the resolved VertexDescriptor ids. Renders an
 * empty-state hint when nothing is picked.
 *
 * Selection wins over hover when both are present, but if only hover is set
 * the panel previews the hovered mesh — useful for skimming the model
 * without committing to a click.
 */
function PartInfoPanel({
	decoded,
	selection,
	hovered,
}: {
	decoded: { renderables: DecodedRenderable[] } | null;
	selection: { ri: number; mi: number } | null;
	hovered: { ri: number; mi: number } | null;
}) {
	const pick = selection ?? hovered;
	if (!decoded || !pick) {
		return (
			<div className="w-72 shrink-0 rounded-lg border border-border bg-card/50 p-3 text-xs text-muted-foreground overflow-y-auto">
				<div className="font-semibold text-sm text-foreground mb-2">Part info</div>
				<p>Click a part in the viewer to see its details.</p>
				<p className="mt-2">Hover over parts to preview without committing.</p>
			</div>
		);
	}
	const r = decoded.renderables[pick.ri];
	if (!r) return null;
	const m = r.meshes[pick.mi];
	if (!m) return null;

	const isSelection = selection !== null;
	const titleColor = isSelection ? 'text-amber-300' : 'text-sky-300';

	const idHex = (id: bigint | null) =>
		id === null ? '—' : '0x' + id.toString(16).padStart(8, '0');

	const vdList = m.vertexDescriptorIds.filter((id): id is bigint => id !== null);

	// 4×4 row-major dump of the OBB matrix.
	const obbRows: string[] = [];
	for (let r0 = 0; r0 < 4; r0++) {
		const row = [0, 1, 2, 3]
			.map((c) => m.boundingMatrix[r0 * 4 + c].toFixed(3).padStart(7, ' '))
			.join(' ');
		obbRows.push(row);
	}

	return (
		<div className="w-72 shrink-0 rounded-lg border border-border bg-card/50 p-3 text-xs overflow-y-auto">
			<div className={`font-semibold text-sm mb-2 ${titleColor}`}>
				{isSelection ? 'Selected' : 'Hover'} — Renderable[{pick.ri}] mesh[{pick.mi}]
			</div>

			<div className="mb-3">
				<div className="text-muted-foreground">Renderable id</div>
				<div className="font-mono text-foreground">0x{r.resourceId.toString(16).padStart(8, '0')}</div>
				{r.debugName && <div className="font-mono text-foreground break-all mt-1">{r.debugName}</div>}
			</div>

			<div className="grid grid-cols-2 gap-1 mb-3">
				<div className="text-muted-foreground">vertices</div>
				<div className="font-mono text-right">{m.vertexCount.toLocaleString()}</div>
				<div className="text-muted-foreground">indices</div>
				<div className="font-mono text-right">{m.indexCount.toLocaleString()}</div>
				<div className="text-muted-foreground">tris</div>
				<div className="font-mono text-right">{(m.indexCount / 3).toLocaleString()}</div>
				<div className="text-muted-foreground">startIndex</div>
				<div className="font-mono text-right">{m.startIndex.toLocaleString()}</div>
				<div className="text-muted-foreground">primType</div>
				<div className="font-mono text-right">
					{m.primitiveType === 4 ? '4 (TRILIST)' : `${m.primitiveType}`}
				</div>
				<div className="text-muted-foreground">VDs (resolved)</div>
				<div className="font-mono text-right">{vdList.length} / 6</div>
			</div>

			<div className="mb-3">
				<div className="text-muted-foreground mb-1">material assembly</div>
				<div className="font-mono break-all">{idHex(m.materialAssemblyId)}</div>
			</div>

			<div className="mb-3">
				<div className="text-muted-foreground mb-1">vertex descriptors</div>
				{vdList.length === 0 ? (
					<div className="font-mono text-muted-foreground">none</div>
				) : (
					<ul className="font-mono space-y-0.5">
						{m.vertexDescriptorIds.map((id, i) =>
							id === null ? null : (
								<li key={i}>
									[{i}] {idHex(id)}
								</li>
							),
						)}
					</ul>
				)}
			</div>

			<div className="mb-3">
				<div className="text-muted-foreground mb-1">part locator (Renderable)</div>
				<div className="font-mono text-[10px]">
					{r.partLocator ? 'present (16 floats)' : 'none'}
				</div>
			</div>

			<div>
				<div className="text-muted-foreground mb-1">mesh boundingMatrix (OBB)</div>
				<pre className="font-mono text-[10px] leading-tight whitespace-pre">{obbRows.join('\n')}</pre>
			</div>
		</div>
	);
}

const RenderablePage = () => {
	const { loadedBundle, originalArrayBuffer, debugResources } = useBundle();
	const [includeNonLOD0, setIncludeNonLOD0] = useState(false);
	const [transformMode, setTransformMode] = useState<TransformMode>('none');
	const [decodeMode, setDecodeMode] = useState<DecodeMode>('graphics');
	const [locatorMode, setLocatorMode] = useState<LocatorMode>('fromArray');
	const [selected, setSelected] = useState<{ ri: number; mi: number } | null>(null);
	const [hovered, setHovered] = useState<{ ri: number; mi: number } | null>(null);

	// Build a debug-name lookup keyed by canonical (lowercase, no leading zeros)
	// resource id. The RST stores ids as 8-char zero-padded lowercase hex; we
	// normalize both sides so the lookup tolerates either form.
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
		return decodeAllRenderables(originalArrayBuffer, loadedBundle, debugNames, includeNonLOD0, decodeMode);
	}, [loadedBundle, originalArrayBuffer, debugNames, includeNonLOD0, decodeMode]);

	// Clear stale selection when the decoded set changes — the indices we
	// captured may no longer point at the same mesh.
	useEffect(() => {
		setSelected(null);
		setHovered(null);
	}, [decoded]);

	const sceneBounds = useMemo(() => {
		if (!decoded) return null;
		return computeSceneBounds(decoded.renderables);
	}, [decoded]);

	if (!loadedBundle || !originalArrayBuffer) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Renderable Viewer</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle that contains Renderable resources (e.g. a vehicle graphics bundle) to view its meshes.
					</div>
				</CardContent>
			</Card>
		);
	}

	const renderableCount = loadedBundle.resources.filter((r) => r.resourceTypeId === RENDERABLE_TYPE_ID).length;
	if (renderableCount === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Renderable Viewer</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						This bundle has no Renderable (0xC) resources.
					</div>
				</CardContent>
			</Card>
		);
	}

	const center = sceneBounds ? sceneBounds.center : new THREE.Vector3();
	const radius = sceneBounds ? sceneBounds.radius : 1;
	// 2.2 × radius gives the bounding sphere ~2/3 of the FOV at 45° vertical,
	// which frames a car nicely without being too tight.
	const camDistance = Math.max(radius * 2.2, 1.5);

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader className="space-y-2">
					<div className="flex flex-row items-center justify-between">
						<CardTitle>Renderable Viewer</CardTitle>
						<span className="text-sm text-muted-foreground">
							{decoded
								? `${decoded.renderables.length} renderables, ${decoded.totalMeshes} meshes${decoded.failed > 0 ? `, ${decoded.failed} failed` : ''}`
								: 'decoding…'}
						</span>
					</div>
					<div className="flex flex-row flex-wrap items-center gap-2 text-xs text-muted-foreground">
						<span className="font-medium">source:</span>
						<Button
							variant={decodeMode === 'graphics' ? 'default' : 'outline'}
							size="sm"
							onClick={() => setDecodeMode('graphics')}
							title="Drive decode through GraphicsSpec → Model → Renderable; attaches part locators"
						>
							GraphicsSpec
						</Button>
						<Button
							variant={decodeMode === 'all' ? 'default' : 'outline'}
							size="sm"
							onClick={() => setDecodeMode('all')}
							title="Decode every Renderable in the bundle, no part transforms"
						>
							all renderables
						</Button>
						<span className="font-medium ml-2">lod:</span>
						<Button
							variant={includeNonLOD0 ? 'default' : 'outline'}
							size="sm"
							onClick={() => setIncludeNonLOD0((v) => !v)}
						>
							{includeNonLOD0 ? 'all LODs' : 'LOD0 only'}
						</Button>
						<span className="font-medium ml-2">locator:</span>
						<Button
							variant={locatorMode === 'fromArray' ? 'default' : 'outline'}
							size="sm"
							onClick={() => setLocatorMode('fromArray')}
							title="Matrix4.fromArray (column-major reading of row-major OpenTK data)"
						>
							fromArray
						</Button>
						<Button
							variant={locatorMode === 'rowSet' ? 'default' : 'outline'}
							size="sm"
							onClick={() => setLocatorMode('rowSet')}
							title="Matrix4.set (literal row-major, debugging only)"
						>
							rowSet
						</Button>
						<span className="font-medium ml-2">mesh xform:</span>
						<Button
							variant={transformMode === 'none' ? 'default' : 'outline'}
							size="sm"
							onClick={() => setTransformMode('none')}
							title="Ignore boundingMatrix"
						>
							none
						</Button>
						<Button
							variant={transformMode === 'matrix' ? 'default' : 'outline'}
							size="sm"
							onClick={() => setTransformMode('matrix')}
							title="Apply boundingMatrix as Matrix4 (OBB squash — debugging only)"
						>
							full
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					<div className="flex flex-row gap-3" style={{ height: '70vh' }}>
						<div style={{ flex: 1, background: '#1a1d23', borderRadius: 8, minWidth: 0 }}>
							<Canvas
								camera={{
									position: [center.x + camDistance, center.y + camDistance * 0.5, center.z + camDistance],
									fov: 45,
									near: 0.01,
									far: Math.max(camDistance * 20, 100),
								}}
								gl={{ antialias: true }}
								// Clicking on empty space deselects. Doesn't fire when a mesh
								// onClick consumes the event.
								onPointerMissed={() => setSelected(null)}
							>
								<color attach="background" args={['#1a1d23']} />
								<ambientLight intensity={0.4} />
								<directionalLight position={[10, 10, 5]} intensity={1.0} />
								<directionalLight position={[-8, 5, -10]} intensity={0.5} />
								<Grid
									position={[center.x, center.y - radius, center.z]}
									args={[Math.max(radius * 4, 4), Math.max(radius * 4, 4)]}
									cellSize={0.5}
									cellThickness={0.5}
									sectionSize={2}
									sectionThickness={1}
									fadeDistance={camDistance * 4}
									infiniteGrid
								/>
								<Suspense fallback={null}>
									{decoded && (
										<RenderableMeshes
											renderables={decoded.renderables}
											transformMode={transformMode}
											locatorMode={locatorMode}
											selected={selected}
											hovered={hovered}
											onSelect={setSelected}
											onHover={setHovered}
										/>
									)}
								</Suspense>
								<OrbitControls
									target={[center.x, center.y, center.z]}
									enableDamping
									dampingFactor={0.1}
									makeDefault
								/>
							</Canvas>
						</div>
						<PartInfoPanel decoded={decoded} selection={selected} hovered={hovered} />
					</div>
					{decoded && decoded.failed > 0 && (
						<div className="mt-2 text-xs text-destructive">
							{decoded.failed} renderable(s) failed to decode. See console for details.
						</div>
					)}
					{decoded && decoded.failed > 0 && (() => {
						const firstErrors = decoded.renderables.filter((r) => r.error).slice(0, 5);
						return (
							<div className="mt-1 text-xs text-muted-foreground">
								First failures: {firstErrors.map((r) => `${r.debugName ?? r.resourceId.toString(16)} (${r.error})`).join('; ')}
							</div>
						);
					})()}
				</CardContent>
			</Card>
		</div>
	);
};

export default RenderablePage;

// 3D viewport for PolygonSoupList — renders collision geometry across ALL
// 0x43 resources in the loaded bundle, not just the one the schema editor
// happens to be editing. WORLDCOL.BIN has 428 PSL resources and rendering
// just one would show at most a track-unit's worth of geometry.
//
// Features:
//   - Single batched draw call (~1.5M triangles on WORLDCOL)
//   - Per-triangle color derived from collisionTag → visually separates
//     road, wall, wreck, vegetation, etc.
//   - Raycast picking on pointer click — selecting a face navigates the
//     schema editor to that soup in that resource
//   - Highlighted emphasis on the resource currently owned by the schema
//     editor (slightly brighter hue so you can see which one you're editing)
//
// Data flow: the viewport pulls its model list from PolygonSoupListContext
// (provided by PolygonSoupListPage) rather than useBundle directly, so the
// page controls which models to render and receives click selections back.

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useBundle } from '@/context/BundleContext';
import { parseAllBundleResourcesViaRegistry } from '@/lib/core/registry/bundleOps';
import type { ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';
import { usePolygonSoupListContext, encodeSoupPoly } from './polygonSoupListContext';

// ---------------------------------------------------------------------------
// Vertex unpacking — u16 → i16 sign-extend + `(packed + offset) * scale`
// ---------------------------------------------------------------------------

function s16(v: number): number {
	return v >= 0x8000 ? v - 0x10000 : v;
}

// ---------------------------------------------------------------------------
// Collision-tag → RGB color
// ---------------------------------------------------------------------------

// Hash the u32 collisionTag into a deterministic HSL and convert to linear
// RGB floats. Uses the HIGH 16 bits (material half: flags/surface/traffic)
// for hue so surfaces with the same material read as a consistent color,
// and the LOW 16 bits (group half: AI section index) for a mild variation
// in lightness so polys in adjacent AI sections stay visually distinct.
function tagToColor(tag: number, out: [number, number, number]): void {
	const group    = tag & 0xFFFF;
	const material = (tag >>> 16) & 0xFFFF;
	// Cheap but decent hash — scramble with a Knuth multiplicative constant.
	const h = ((material * 2654435761) >>> 0) / 0xFFFFFFFF;
	const l = 0.45 + (((group * 2246822519) >>> 0) / 0xFFFFFFFF) * 0.2;
	hslToRgb(h, 0.6, l, out);
}

function hslToRgb(h: number, s: number, l: number, out: [number, number, number]): void {
	const hue2rgb = (p: number, q: number, t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	let r: number, g: number, b: number;
	if (s === 0) {
		r = g = b = l;
	} else {
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		r = hue2rgb(p, q, h + 1 / 3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1 / 3);
	}
	out[0] = r;
	out[1] = g;
	out[2] = b;
}

// ---------------------------------------------------------------------------
// Batched geometry builder
// ---------------------------------------------------------------------------

type BatchedGeometry = {
	geometry: THREE.BufferGeometry;
	center: THREE.Vector3;
	radius: number;
	triangleCount: number;
	soupCount: number;
	modelCount: number;
	/** Per-triangle mapping for raycast hit-testing.
	 *  Layout: [modelIndex, soupIndex, polyIndex] per triangle. */
	faceToLocation: Int32Array;
	/** Start positions (in triangle units) into faceToLocation for each
	 *  model, so we can boost the color of the currently-selected model
	 *  without rebuilding the whole geometry. */
	triangleRangesByModel: { start: number; count: number }[];
};

function buildGeometry(
	models: (ParsedPolygonSoupList | null)[],
): BatchedGeometry {
	// First pass: count triangles across everything so we can pre-allocate.
	let triangleCount = 0;
	let soupCount = 0;
	let modelCount = 0;
	const triangleRangesByModel: { start: number; count: number }[] = [];

	for (const model of models) {
		const startTri = triangleCount;
		if (model == null) {
			triangleRangesByModel.push({ start: startTri, count: 0 });
			continue;
		}
		if (model.soups.length > 0) modelCount++;
		for (const soup of model.soups) {
			soupCount++;
			for (const p of soup.polygons) {
				triangleCount += p.vertexIndices[3] === 0xFF ? 1 : 2;
			}
		}
		triangleRangesByModel.push({ start: startTri, count: triangleCount - startTri });
	}

	if (triangleCount === 0) {
		const empty = new THREE.BufferGeometry();
		return {
			geometry: empty,
			center: new THREE.Vector3(),
			radius: 100,
			triangleCount: 0,
			soupCount: 0,
			modelCount: 0,
			faceToLocation: new Int32Array(0),
			triangleRangesByModel,
		};
	}

	const positions = new Float32Array(triangleCount * 9);
	const colors = new Float32Array(triangleCount * 9);
	const faceToLocation = new Int32Array(triangleCount * 3);

	let minX = Infinity, minY = Infinity, minZ = Infinity;
	let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
	let writeIdx = 0;
	let triIdx = 0;
	const tagColor: [number, number, number] = [0, 0, 0];

	for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
		const model = models[modelIndex];
		if (model == null) continue;
		for (let soupIndex = 0; soupIndex < model.soups.length; soupIndex++) {
			const soup = model.soups[soupIndex];
			const vOff = soup.vertexOffsets;
			const scale = soup.comprGranularity;

			// Unpack every vertex of this soup once into a small scratch array.
			const unpacked = new Float32Array(soup.vertices.length * 3);
			for (let i = 0; i < soup.vertices.length; i++) {
				const v = soup.vertices[i];
				const wx = (s16(v.x) + vOff[0]) * scale;
				const wy = (s16(v.y) + vOff[1]) * scale;
				const wz = (s16(v.z) + vOff[2]) * scale;
				unpacked[i * 3 + 0] = wx;
				unpacked[i * 3 + 1] = wy;
				unpacked[i * 3 + 2] = wz;
				if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
				if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
				if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
			}

			for (let polyIndex = 0; polyIndex < soup.polygons.length; polyIndex++) {
				const poly = soup.polygons[polyIndex];
				const [a, b, c, d] = poly.vertexIndices;
				const isTri = d === 0xFF;
				const len = soup.vertices.length;
				const ia = a < len ? a : 0;
				const ib = b < len ? b : 0;
				const ic = c < len ? c : 0;

				tagToColor(poly.collisionTag, tagColor);

				// Triangle 1: a, b, c
				positions[writeIdx + 0] = unpacked[ia * 3 + 0];
				positions[writeIdx + 1] = unpacked[ia * 3 + 1];
				positions[writeIdx + 2] = unpacked[ia * 3 + 2];
				positions[writeIdx + 3] = unpacked[ib * 3 + 0];
				positions[writeIdx + 4] = unpacked[ib * 3 + 1];
				positions[writeIdx + 5] = unpacked[ib * 3 + 2];
				positions[writeIdx + 6] = unpacked[ic * 3 + 0];
				positions[writeIdx + 7] = unpacked[ic * 3 + 1];
				positions[writeIdx + 8] = unpacked[ic * 3 + 2];
				for (let k = 0; k < 9; k += 3) {
					colors[writeIdx + k + 0] = tagColor[0];
					colors[writeIdx + k + 1] = tagColor[1];
					colors[writeIdx + k + 2] = tagColor[2];
				}
				writeIdx += 9;
				faceToLocation[triIdx * 3 + 0] = modelIndex;
				faceToLocation[triIdx * 3 + 1] = soupIndex;
				faceToLocation[triIdx * 3 + 2] = polyIndex;
				triIdx++;

				if (!isTri) {
					const id = d < len ? d : 0;
					// Triangle 2: d, c, b (matches C# reference winding).
					positions[writeIdx + 0] = unpacked[id * 3 + 0];
					positions[writeIdx + 1] = unpacked[id * 3 + 1];
					positions[writeIdx + 2] = unpacked[id * 3 + 2];
					positions[writeIdx + 3] = unpacked[ic * 3 + 0];
					positions[writeIdx + 4] = unpacked[ic * 3 + 1];
					positions[writeIdx + 5] = unpacked[ic * 3 + 2];
					positions[writeIdx + 6] = unpacked[ib * 3 + 0];
					positions[writeIdx + 7] = unpacked[ib * 3 + 1];
					positions[writeIdx + 8] = unpacked[ib * 3 + 2];
					for (let k = 0; k < 9; k += 3) {
						colors[writeIdx + k + 0] = tagColor[0];
						colors[writeIdx + k + 1] = tagColor[1];
						colors[writeIdx + k + 2] = tagColor[2];
					}
					writeIdx += 9;
					faceToLocation[triIdx * 3 + 0] = modelIndex;
					faceToLocation[triIdx * 3 + 1] = soupIndex;
					faceToLocation[triIdx * 3 + 2] = polyIndex;
					triIdx++;
				}
			}
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.computeVertexNormals();

	const center = new THREE.Vector3(
		(minX + maxX) / 2,
		(minY + maxY) / 2,
		(minZ + maxZ) / 2,
	);
	const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
	const radius = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) / 2, 50);

	return {
		geometry,
		center,
		radius,
		triangleCount,
		soupCount,
		modelCount,
		faceToLocation,
		triangleRangesByModel,
	};
}

// Apply a highlight tint to the colors attribute for the currently-selected
// model's triangle range, plus a stronger per-poly emphasis for any polygons
// in the bulk selection. Called after picking changes; avoids rebuilding the
// whole geometry.
function applyHighlight(
	geometry: THREE.BufferGeometry,
	ranges: { start: number; count: number }[],
	baseColors: Float32Array,
	faceToLocation: Int32Array,
	selectedModelIndex: number,
	selectedPolysInCurrentModel: ReadonlySet<number>,
): void {
	const attr = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
	if (!attr) return;
	const colors = attr.array as Float32Array;
	// Reset to base.
	colors.set(baseColors);
	// Boost the currently-edited resource's range so the user can tell which
	// model the schema editor is pointed at.
	const sel = ranges[selectedModelIndex];
	if (sel && sel.count > 0) {
		const from = sel.start * 9;
		const to = from + sel.count * 9;
		for (let i = from; i < to; i++) {
			colors[i] = Math.min(1, colors[i] * 1.6 + 0.15);
		}
	}
	// Brighten every triangle whose (soup, poly) is in the bulk selection
	// — and whose model matches the currently-edited resource. The page
	// clears the bulk set on resource switch so cross-model entries don't
	// appear in practice, but guarding on modelIndex keeps the behavior
	// correct even if a stale entry slips through.
	if (selectedPolysInCurrentModel.size > 0 && sel && sel.count > 0) {
		const from = sel.start;
		const to = from + sel.count;
		for (let tri = from; tri < to; tri++) {
			const s = faceToLocation[tri * 3 + 1];
			const p = faceToLocation[tri * 3 + 2];
			if (!selectedPolysInCurrentModel.has(encodeSoupPoly(s, p))) continue;
			const base = tri * 9;
			// Shift toward amber so selected polys really stand out — matches
			// the amber accent on bulk-selected rows in the tree.
			colors[base + 0] = 1.0;
			colors[base + 1] = 0.72;
			colors[base + 2] = 0.2;
			colors[base + 3] = 1.0;
			colors[base + 4] = 0.72;
			colors[base + 5] = 0.2;
			colors[base + 6] = 1.0;
			colors[base + 7] = 0.72;
			colors[base + 8] = 0.2;
		}
	}
	attr.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Camera auto-fit
// ---------------------------------------------------------------------------

function AutoFit({ center, radius }: { center: THREE.Vector3; radius: number }) {
	const { camera } = useThree();
	const fitted = useRef(false);
	useEffect(() => {
		if (fitted.current) return;
		fitted.current = true;
		const d = radius * 1.5;
		camera.position.set(center.x, center.y + d, center.z + d * 0.3);
		camera.lookAt(center);
		if ('far' in camera) {
			(camera as THREE.PerspectiveCamera).far = radius * 10;
			(camera as THREE.PerspectiveCamera).updateProjectionMatrix();
		}
	}, [camera, center, radius]);
	return null;
}

// ---------------------------------------------------------------------------
// Fallback parser — when the viewport is rendered WITHOUT a page-level
// context (e.g., if someone drops the viewport into a different host),
// parse the bundle ourselves with a best-effort. This keeps the viewport
// useful as a standalone component without forcing every caller to set up
// the PolygonSoupListContext.
// ---------------------------------------------------------------------------

function useFallbackModels(): (ParsedPolygonSoupList | null)[] {
	const { loadedBundle, originalArrayBuffer } = useBundle();
	return useMemo(() => {
		if (!loadedBundle || !originalArrayBuffer) return [];
		const all = parseAllBundleResourcesViaRegistry(originalArrayBuffer, loadedBundle);
		return (all.get('polygonSoupList') as (ParsedPolygonSoupList | null)[] | undefined) ?? [];
	}, [loadedBundle, originalArrayBuffer]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const EMPTY_POLY_SELECTION: ReadonlySet<number> = new Set();

export function PolygonSoupListViewport() {
	const ctx = usePolygonSoupListContext();
	const fallback = useFallbackModels();
	const models = ctx?.models ?? fallback;
	const selectedModelIndex = ctx?.selectedModelIndex ?? 0;
	const onSelect = ctx?.onSelect;
	const selectedPolysInCurrentModel = ctx?.selectedPolysInCurrentModel ?? EMPTY_POLY_SELECTION;

	const batched = useMemo(() => buildGeometry(models), [models]);

	// Snapshot the base colors so re-highlights can restore the originals
	// without rebuilding geometry.
	const baseColorsRef = useRef<Float32Array | null>(null);
	useEffect(() => {
		const attr = batched.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
		if (!attr) return;
		baseColorsRef.current = (attr.array as Float32Array).slice();
	}, [batched.geometry]);

	// Apply highlight on selection change (resource swap or bulk-selection change).
	useEffect(() => {
		if (!baseColorsRef.current) return;
		applyHighlight(
			batched.geometry,
			batched.triangleRangesByModel,
			baseColorsRef.current,
			batched.faceToLocation,
			selectedModelIndex,
			selectedPolysInCurrentModel,
		);
	}, [
		batched.geometry,
		batched.triangleRangesByModel,
		batched.faceToLocation,
		selectedModelIndex,
		selectedPolysInCurrentModel,
	]);

	// Dispose GPU memory when the geometry changes or the component unmounts.
	useEffect(() => {
		const g = batched.geometry;
		return () => { g.dispose(); };
	}, [batched.geometry]);

	const handleClick = (event: ThreeEvent<MouseEvent>) => {
		if (!onSelect) return;
		const faceIdx = event.faceIndex;
		if (faceIdx == null) return;
		const map = batched.faceToLocation;
		if (faceIdx * 3 + 2 >= map.length) return;
		const modelIndex = map[faceIdx * 3 + 0];
		const soupIndex = map[faceIdx * 3 + 1];
		const polyIndex = map[faceIdx * 3 + 2];
		event.stopPropagation();
		onSelect(modelIndex, soupIndex, polyIndex);
	};

	if (batched.triangleCount === 0) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground">
				{models.length === 0 ? 'Loading collision meshes…' : 'No collision geometry in this bundle.'}
			</div>
		);
	}

	return (
		<div className="h-full relative">
			<Canvas
				camera={{ position: [0, batched.radius * 2, batched.radius], fov: 50, near: 0.1, far: batched.radius * 10 }}
				style={{ background: '#0b1020' }}
			>
				<ambientLight intensity={0.5} />
				<directionalLight position={[batched.center.x + batched.radius, batched.center.y + batched.radius * 2, batched.center.z + batched.radius]} intensity={0.7} />
				<directionalLight position={[batched.center.x - batched.radius, batched.center.y + batched.radius, batched.center.z - batched.radius]} intensity={0.25} />
				<mesh geometry={batched.geometry} onClick={handleClick}>
					<meshLambertMaterial vertexColors side={THREE.DoubleSide} flatShading />
				</mesh>
				<AutoFit center={batched.center} radius={batched.radius} />
				<OrbitControls
					makeDefault
					target={[batched.center.x, batched.center.y, batched.center.z]}
					minDistance={batched.radius * 0.05}
					maxDistance={batched.radius * 5}
				/>
			</Canvas>
			<div className="absolute top-2 left-2 text-[10px] font-mono text-white/80 bg-black/50 px-2 py-1 rounded pointer-events-none">
				{batched.modelCount} resources · {batched.soupCount} soups · {batched.triangleCount.toLocaleString()} triangles
				{onSelect && <div className="opacity-70">selected resource #{selectedModelIndex}</div>}
				{selectedPolysInCurrentModel.size > 0 && (
					<div className="opacity-70 text-amber-300">
						{selectedPolysInCurrentModel.size} poly{selectedPolysInCurrentModel.size === 1 ? '' : 's'} in bulk selection
					</div>
				)}
			</div>
		</div>
	);
}

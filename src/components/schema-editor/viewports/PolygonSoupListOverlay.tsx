// PolygonSoupListOverlay — WorldViewport overlay for the PolygonSoupList
// resource (collision geometry, resource type 0x43).
//
// Structurally distinct from the other World-viewport overlays: a bundle
// holds 0..N PolygonSoupList resources (one per track unit), and this
// overlay renders ALL of them as a single batched mesh. The currently-
// edited resource is read from `PolygonSoupListContext` — provided by
// `PolygonSoupListPage` — and click events on the 3D scene can switch the
// active resource (via the page's `handleViewportSelect`).
//
// Why this overlay reads the active Bundle directly (deviating from ADR-0002):
// see docs/adr/0004-polygon-soup-list-overlay-reads-bundle-context.md.
//
// DOM siblings (marquee, status badge) ride the WorldViewport HTML slot.

import { useMemo, useRef } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { unpackSoupVertex, type ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';
import { usePolygonSoupListContext, encodeSoupPoly } from './polygonSoupListContext';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
import { useLineSegmentsGeometry } from '@/hooks/useLineSegmentsGeometry';
import { useCachedColorAttribute } from '@/hooks/useCachedColorAttribute';
import { useApplyPolygonSoupHighlight } from '@/hooks/useApplyPolygonSoupHighlight';
import { useDisposeOnUnmount } from '@/hooks/useDisposeOnUnmount';
import type { Edge } from '@/components/common/three/SelectionOutline';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayProps } from './WorldViewport.types';
import { useWorldViewportHtmlSlot } from './WorldViewport';
import { defineSelectionCodec, type Selection } from './selection';

// ---------------------------------------------------------------------------
// Path ↔ Selection codec (exported for tests)
// ---------------------------------------------------------------------------

export type SoupPolyAddress = { soup: number; poly: number };

/**
 * Codec for an editable polygon inside a soup inside a PolygonSoupList
 * resource. Sub-paths inside the polygon record (e.g.
 * `['soups', 0, 'polygons', 7, 'collisionTag']`) collapse to the parent
 * polygon — drilling into a primitive in the inspector keeps the 3D outline
 * highlighted on the parent.
 *
 * The merged BatchedGeometry paint loop stays inline; `useBatchedSelection`
 * is a deferred follow-up. Only the codec migrates here.
 */
export const polygonSoupSelectionCodec = defineSelectionCodec({
	pathToSelection: (path: NodePath): Selection | null => {
		if (
			path.length >= 4 &&
			path[0] === 'soups' &&
			typeof path[1] === 'number' &&
			path[2] === 'polygons' &&
			typeof path[3] === 'number'
		) {
			return { kind: 'polygon', indices: [path[1], path[3]] };
		}
		return null;
	},
	selectionToPath: (sel: Selection): NodePath => {
		if (sel.kind !== 'polygon') return [];
		return ['soups', sel.indices[0], 'polygons', sel.indices[1]];
	},
});

/** Back-compat alias retained for tests. */
export function soupPolyPathAddress(path: NodePath): SoupPolyAddress | null {
	const sel = polygonSoupSelectionCodec.pathToSelection(path);
	return sel ? { soup: sel.indices[0], poly: sel.indices[1] } : null;
}

/** Back-compat alias retained for tests. */
export function soupPolyAddressPath(addr: SoupPolyAddress): NodePath {
	return polygonSoupSelectionCodec.selectionToPath({ kind: 'polygon', indices: [addr.soup, addr.poly] });
}

// ---------------------------------------------------------------------------
// Collision-tag → RGB color
// ---------------------------------------------------------------------------

function tagToColor(tag: number, out: [number, number, number]): void {
	const group    = tag & 0xFFFF;
	const material = (tag >>> 16) & 0xFFFF;
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
	/** Per-triangle mapping for raycast hit-testing. [modelIndex, soupIndex, polyIndex] per triangle. */
	faceToLocation: Int32Array;
	/** Triangle ranges per model — used to cheaply re-tint per-resource highlights. */
	triangleRangesByModel: { start: number; count: number }[];
};

function buildGeometry(models: (ParsedPolygonSoupList | null)[]): BatchedGeometry {
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

			const unpacked = new Float32Array(soup.vertices.length * 3);
			for (let i = 0; i < soup.vertices.length; i++) {
				const [wx, wy, wz] = unpackSoupVertex(soup.vertices[i], vOff, scale);
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

	const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
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

// Yield boundary edges for every polygon in the bulk + tree selection within
// `selectedModelIndex`'s model. Each polygon contributes its full boundary —
// tri = 3 edges, quad = 4 edges (the diagonal that splits a quad into two
// triangles is NOT emitted, so quads read as quads in the wireframe). Soups
// are unpacked lazily so soups that contribute nothing to the outline don't
// pay vertex-decompression cost.
function* iterateSelectionOutlineEdges(
	models: (ParsedPolygonSoupList | null)[],
	selectedModelIndex: number,
	selectedPolysInCurrentModel: ReadonlySet<number>,
): Generator<Edge> {
	const model = models[selectedModelIndex];
	if (!model || selectedPolysInCurrentModel.size === 0) return;

	for (let soupIndex = 0; soupIndex < model.soups.length; soupIndex++) {
		const soup = model.soups[soupIndex];
		let unpacked: Float32Array | null = null;

		for (let polyIndex = 0; polyIndex < soup.polygons.length; polyIndex++) {
			if (!selectedPolysInCurrentModel.has(encodeSoupPoly(soupIndex, polyIndex))) continue;

			if (!unpacked) {
				unpacked = new Float32Array(soup.vertices.length * 3);
				const vOff = soup.vertexOffsets;
				const scale = soup.comprGranularity;
				for (let i = 0; i < soup.vertices.length; i++) {
					const [wx, wy, wz] = unpackSoupVertex(soup.vertices[i], vOff, scale);
					unpacked[i * 3 + 0] = wx;
					unpacked[i * 3 + 1] = wy;
					unpacked[i * 3 + 2] = wz;
				}
			}

			const poly = soup.polygons[polyIndex];
			const [a, b, c, d] = poly.vertexIndices;
			const len = soup.vertices.length;
			const ia = a < len ? a : 0;
			const ib = b < len ? b : 0;
			const ic = c < len ? c : 0;
			const isTri = d === 0xFF;

			const v = (idx: number): [number, number, number] => [
				unpacked![idx * 3 + 0],
				unpacked![idx * 3 + 1],
				unpacked![idx * 3 + 2],
			];

			yield [v(ia), v(ib)];
			yield [v(ib), v(ic)];
			if (isTri) {
				yield [v(ic), v(ia)];
			} else {
				const id = d < len ? d : 0;
				yield [v(ic), v(id)];
				yield [v(id), v(ia)];
			}
		}
	}
}

function pickPolysInFrustum(
	batched: BatchedGeometry,
	frustum: THREE.Frustum,
	selectedModelIndex: number,
): { soup: number; poly: number }[] {
	const range = batched.triangleRangesByModel[selectedModelIndex];
	if (!range || range.count === 0) return [];

	const positions = batched.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!positions) return [];
	const arr = positions.array as Float32Array;
	const map = batched.faceToLocation;
	const seen = new Set<number>();
	const out: { soup: number; poly: number }[] = [];
	const pt = new THREE.Vector3();

	const triEnd = range.start + range.count;
	for (let tri = range.start; tri < triEnd; tri++) {
		const o = tri * 9;
		pt.set(
			(arr[o + 0] + arr[o + 3] + arr[o + 6]) / 3,
			(arr[o + 1] + arr[o + 4] + arr[o + 7]) / 3,
			(arr[o + 2] + arr[o + 5] + arr[o + 8]) / 3,
		);
		if (!frustum.containsPoint(pt)) continue;
		const s = map[tri * 3 + 1];
		const p = map[tri * 3 + 2];
		const key = encodeSoupPoly(s, p);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ soup: s, poly: p });
	}
	return out;
}

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
	colors.set(baseColors);
	const sel = ranges[selectedModelIndex];
	if (sel && sel.count > 0) {
		const from = sel.start * 9;
		const to = from + sel.count * 9;
		for (let i = from; i < to; i++) {
			colors[i] = Math.min(1, colors[i] * 1.6 + 0.15);
		}
	}
	if (selectedPolysInCurrentModel.size > 0 && sel && sel.count > 0) {
		const from = sel.start;
		const to = from + sel.count;
		for (let tri = from; tri < to; tri++) {
			const s = faceToLocation[tri * 3 + 1];
			const p = faceToLocation[tri * 3 + 2];
			if (!selectedPolysInCurrentModel.has(encodeSoupPoly(s, p))) continue;
			const base = tri * 9;
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
// Overlay
// ---------------------------------------------------------------------------

const EMPTY_POLY_SELECTION: ReadonlySet<number> = new Set();
const EMPTY_BUNDLE_SOUPS: (ParsedPolygonSoupList | null)[] = [];

type Props = WorldOverlayProps<ParsedPolygonSoupList> & {
	/** The full per-Bundle list of PSL instances the overlay should render
	 *  as a single batched mesh — same reference for every overlay descriptor
	 *  inside the same Bundle (entries are `null` where parsing failed *or*
	 *  where the instance was filtered out by per-instance visibility).
	 *  Supplied by `WorldViewportComposition` so the overlay no longer needs
	 *  to read `useFirstLoadedBundle()` to fish them out itself (closes the
	 *  multi-Bundle leak in ADR-0004's deviation). When a
	 *  `PolygonSoupListContext` is provided (the legacy `PolygonSoupListPage`
	 *  flow) the context's `models` wins. */
	bundleSoups?: (ParsedPolygonSoupList | null)[];
	/** Bundle-relative resource index of the currently-selected PSL instance,
	 *  used to drive per-instance highlighting in the batched mesh. The
	 *  composition path supplies this from the workspace selection so a
	 *  selection on instance 7 still highlights the right slice of the
	 *  union, even though only one (lead) overlay is mounted per Bundle.
	 *  When a `PolygonSoupListContext` is provided the context's
	 *  `selectedModelIndex` wins; when neither is supplied this falls back
	 *  to 0 to preserve the legacy single-Bundle shape. */
	activeSoupIndex?: number;
	/** 3D-pick callback for the composition path (no `PolygonSoupListContext`).
	 *  Receives the clicked instance index — which can differ from the lead
	 *  overlay's own index when N descriptors collapsed to one — so the
	 *  composition can route the selection to the correct PSL resource via
	 *  `select(...)`. The standard `onSelect(NodePath)` prop is unsuitable
	 *  for PSL because a NodePath alone can't carry the multi-instance
	 *  index (the workspace selection's `(bundleId, resourceKey, index,
	 *  path)` tuple is what actually addresses a polygon). The legacy page
	 *  flow's `PolygonSoupListContext.onSelect` takes priority when present. */
	onPickInstancePoly?: (
		modelIndex: number,
		soupIndex: number,
		polyIndex: number,
		modifiers?: { shift?: boolean; ctrl?: boolean },
	) => void;
};

// Note: not typed as `WorldOverlayComponent<ParsedPolygonSoupList>` because
// PSL extends the base props with `bundleSoups` (the per-Bundle multi-resource
// union — see ADR-0004). Every other overlay still satisfies the bare contract.
export const PolygonSoupListOverlay = ({
	selectedPath,
	bundleSoups,
	activeSoupIndex,
	onPickInstancePoly,
	isActive = true,
	// `data` (the active resource) is accepted for contract symmetry but not
	// directly used — the multi-resource state below covers it.
	// `onSelect` is unused: the page provides a richer click API via
	// `PolygonSoupListContext.onSelect(modelIndex, soupIndex, polyIndex,
	// modifiers)` which can switch the active resource and toggle bulk.
	// In the composition path (no context) the equivalent richer API comes
	// in via `onPickInstancePoly` instead — see Props doc.
}: Props) => {
	const ctx = usePolygonSoupListContext();
	const models = ctx?.models ?? bundleSoups ?? EMPTY_BUNDLE_SOUPS;
	const selectedModelIndex = ctx?.selectedModelIndex ?? activeSoupIndex ?? 0;
	const onPickFromCtx = ctx?.onSelect;
	const selectedPolysInCurrentModel = ctx?.selectedPolysInCurrentModel ?? EMPTY_POLY_SELECTION;
	const visibleModelIndexes = ctx?.visibleModelIndexes ?? null;
	const onMarqueeApply = ctx?.onMarqueeApply;
	const cameraBridge = useRef<CameraBridgeData | null>(null);

	// Tree-selected polygon — derived from `selectedPath`, the standard
	// World-overlay selection input. The page used to thread this through
	// the context; reading it from the prop here keeps the overlay aligned
	// with sibling overlays (selection comes from the schema editor's path).
	const treeSelectedPoly = useMemo(() => soupPolyPathAddress(selectedPath), [selectedPath]);

	// Union of bulk selection + the tree-selected polygon. The bulk set
	// drives the amber fill (unchanged); this merged set drives the white
	// outline so tree navigation alone is enough to get a visible cue.
	const outlinedPolys = useMemo(() => {
		if (!treeSelectedPoly) return selectedPolysInCurrentModel;
		const extra = encodeSoupPoly(treeSelectedPoly.soup, treeSelectedPoly.poly);
		if (selectedPolysInCurrentModel.has(extra)) return selectedPolysInCurrentModel;
		const merged = new Set(selectedPolysInCurrentModel);
		merged.add(extra);
		return merged;
	}, [selectedPolysInCurrentModel, treeSelectedPoly]);

	// Nullify hidden models before geometry build — `buildGeometry` already
	// handles null entries by emitting an empty range at that index.
	const effectiveModels = useMemo(() => {
		if (visibleModelIndexes == null) return models;
		const out: (ParsedPolygonSoupList | null)[] = new Array(models.length);
		for (let i = 0; i < models.length; i++) {
			out[i] = visibleModelIndexes.has(i) ? models[i] : null;
		}
		return out;
	}, [models, visibleModelIndexes]);

	const batched = useMemo(() => buildGeometry(effectiveModels), [effectiveModels]);

	const outlineGeometry = useLineSegmentsGeometry(
		() => iterateSelectionOutlineEdges(effectiveModels, selectedModelIndex, outlinedPolys),
		[effectiveModels, selectedModelIndex, outlinedPolys],
	);

	const baseColorsRef = useRef<Float32Array | null>(null);
	useCachedColorAttribute(batched.geometry, baseColorsRef);

	useApplyPolygonSoupHighlight(
		applyHighlight,
		batched.geometry,
		batched.triangleRangesByModel,
		baseColorsRef,
		batched.faceToLocation,
		selectedModelIndex,
		selectedPolysInCurrentModel,
	);

	// Dispose GPU memory when the geometry changes or the overlay unmounts.
	useDisposeOnUnmount(batched.geometry);

	const handleClick = (event: ThreeEvent<MouseEvent>) => {
		// Resolve the receiver: page-level context (richer bulk-aware API)
		// wins, otherwise the composition's `onPickInstancePoly` prop. If
		// neither is supplied (truly standalone mount) we'd have nothing to
		// route the pick to, so bail.
		const sink = onPickFromCtx ?? onPickInstancePoly;
		if (!sink) return;
		const faceIdx = event.faceIndex;
		if (faceIdx == null) return;
		const map = batched.faceToLocation;
		if (faceIdx * 3 + 2 >= map.length) return;
		const modelIndex = map[faceIdx * 3 + 0];
		const soupIndex = map[faceIdx * 3 + 1];
		const polyIndex = map[faceIdx * 3 + 2];
		event.stopPropagation();
		// Forward modifier keys so the page (or composition) can branch on
		// ctrl (toggle into bulk) / shift (extend bulk range). The composition
		// path doesn't currently honour modifiers — it just navigates to the
		// clicked polygon — but the signature is identical so the workspace
		// can grow bulk-select later without churning the overlay.
		const ne = event.nativeEvent as PointerEvent | undefined;
		sink(modelIndex, soupIndex, polyIndex, {
			shift: ne?.shiftKey ?? false,
			ctrl: (ne?.ctrlKey || ne?.metaKey) ?? false,
		});
	};

	// HTML siblings — marquee + status badge.
	const htmlNode = useMemo(() => {
		const showMarquee = onMarqueeApply != null && batched.triangleCount > 0;
		const status = (
			<div
				style={{
					position: 'absolute', top: 8, left: 8,
					background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.8)',
					padding: '4px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'monospace',
					pointerEvents: 'none',
				}}
			>
				{batched.modelCount} resources · {batched.soupCount} soups · {batched.triangleCount.toLocaleString()} triangles
				{onPickFromCtx && (
					<div style={{ opacity: 0.7 }}>selected resource #{selectedModelIndex}</div>
				)}
				{selectedPolysInCurrentModel.size > 0 && (
					<div style={{ opacity: 0.7, color: '#fbbf24' }}>
						{selectedPolysInCurrentModel.size} poly{selectedPolysInCurrentModel.size === 1 ? '' : 's'} in bulk selection
					</div>
				)}
			</div>
		);
		return (
			<>
				{status}
				{showMarquee && (
					<MarqueeSelector
						bridge={cameraBridge}
						far={Math.max(batched.radius * 10, 5000)}
						onMarquee={(frustum, mode) => {
							if (!onMarqueeApply || selectedModelIndex < 0) return;
							const polys = pickPolysInFrustum(batched, frustum, selectedModelIndex);
							if (polys.length === 0) return;
							onMarqueeApply(selectedModelIndex, polys, mode);
						}}
						hintIdle="press B to box-select polygons"
					/>
				)}
			</>
		);
	}, [batched, onMarqueeApply, onPickFromCtx, selectedModelIndex, selectedPolysInCurrentModel]);
	// Drop our marquee + status badge when this overlay isn't the focused
	// resource; a sibling Bundle's overlay would otherwise stack tools on
	// top (issue #24 follow-up).
	useWorldViewportHtmlSlot(isActive ? htmlNode : null);

	if (batched.triangleCount === 0) {
		return null;
	}

	return (
		<>
			<mesh geometry={batched.geometry} onClick={handleClick}>
				<meshLambertMaterial vertexColors side={THREE.DoubleSide} flatShading />
			</mesh>
			{/* Bulk-selection outline. depthTest=false + high renderOrder so
			    the outline is always visible, even when the selected polygon
			    is tucked inside dense geometry or behind a wall. */}
			<lineSegments geometry={outlineGeometry} renderOrder={999}>
				<lineBasicMaterial color={0xffffff} depthTest={false} transparent={false} />
			</lineSegments>
			<CameraBridge bridge={cameraBridge} />
		</>
	);
};

export default PolygonSoupListOverlay;

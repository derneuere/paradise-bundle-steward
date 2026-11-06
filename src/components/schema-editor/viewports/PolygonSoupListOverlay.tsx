// PolygonSoupListOverlay — WorldViewport overlay for the PolygonSoupList
// resource (collision geometry, resource type 0x43).
//
// Structurally distinct from the other World-viewport overlays: a bundle
// holds 0..N PolygonSoupList resources (one per track unit), and this
// overlay renders ALL of them, one memoised mesh per resource (see
// `polygonSoupChunk.ts` for why per-resource rather than one merged mesh).
// The currently-edited resource is read from `PolygonSoupListContext` —
// provided by `PolygonSoupListPage` — and click events on the 3D scene can
// switch the active resource (via the page's `handleViewportSelect`).
//
// Why this overlay reads the active Bundle directly (deviating from ADR-0002):
// see docs/adr/0004-polygon-soup-list-overlay-reads-bundle-context.md.
//
// DOM siblings (marquee, status badge) ride the WorldViewport HTML slot.

import { useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { unpackSoupVertex, type ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';
import { usePolygonSoupListContext, encodeSoupPoly } from './polygonSoupListContext';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
import { useLineSegmentsGeometry } from '@/lib/three/scene/useLineSegmentsGeometry';
import { useLatestRef } from '@/hooks/useLatestRef';
import { useWorkspaceAISectionsBulk } from '@/components/workspace/AISectionsBulkProvider';
import type { Edge } from '@/components/common/three/SelectionOutline';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayProps } from './WorldViewport.types';
import { useWorldViewportHtmlSlot } from './WorldViewport';
import { defineSelectionCodec, type Selection } from './selection';
import { getSoupChunk, pickChunkPolysInFrustum } from './polygonSoupChunk';
import { PolygonSoupChunkMesh, type SoupPickHandler } from './PolygonSoupChunkMesh';

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
// Selection outline
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

const EMPTY_POLY_SELECTION: ReadonlySet<number> = new Set();
const EMPTY_BUNDLE_SOUPS: (ParsedPolygonSoupList | null)[] = [];

type Props = WorldOverlayProps<ParsedPolygonSoupList> & {
	/** The full per-Bundle list of PSL instances the overlay should render —
	 *  same reference for every overlay descriptor inside the same Bundle
	 *  (entries are `null` where parsing failed *or* where the instance was
	 *  filtered out by per-instance visibility). Supplied by
	 *  `WorldViewportComposition` so the overlay never reads the workspace to
	 *  find its siblings (ADR-0004). When a `PolygonSoupListContext` is
	 *  provided (the legacy `PolygonSoupListPage` flow) the context's
	 *  `models` wins. */
	bundleSoups?: (ParsedPolygonSoupList | null)[];
	/** Bundle-relative resource index of the currently-selected PSL instance.
	 *  Only one (lead) overlay is mounted per Bundle, so a selection on
	 *  instance 7 must still highlight instance 7's mesh. When a
	 *  `PolygonSoupListContext` is provided the context's
	 *  `selectedModelIndex` wins; when neither is supplied this falls back
	 *  to 0. */
	activeSoupIndex?: number;
	/** 3D-pick callback for the composition path (no `PolygonSoupListContext`).
	 *  Receives the clicked instance index, which can differ from the lead
	 *  overlay's own index — a NodePath alone can't carry it, so the standard
	 *  `onSelect(NodePath)` prop is unsuitable here. The legacy page flow's
	 *  `PolygonSoupListContext.onSelect` takes priority when present. */
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
	// `data` is accepted for contract symmetry but unused — the overlay draws
	// every sibling. `onSelect` is unused: picking goes through
	// `PolygonSoupListContext.onSelect` or `onPickInstancePoly`, which carry
	// the instance index (see Props doc).
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
	// World-overlay selection input.
	const treeSelectedPoly = useMemo(() => soupPolyPathAddress(selectedPath), [selectedPath]);

	// Union of bulk selection + the tree-selected polygon. The bulk set
	// drives the amber fill; this merged set drives the white outline so tree
	// navigation alone is enough to get a visible cue.
	const outlinedPolys = useMemo(() => {
		if (!treeSelectedPoly) return selectedPolysInCurrentModel;
		const extra = encodeSoupPoly(treeSelectedPoly.soup, treeSelectedPoly.poly);
		if (selectedPolysInCurrentModel.has(extra)) return selectedPolysInCurrentModel;
		const merged = new Set(selectedPolysInCurrentModel);
		merged.add(extra);
		return merged;
	}, [selectedPolysInCurrentModel, treeSelectedPoly]);

	const effectiveModels = useMemo(() => {
		if (visibleModelIndexes == null) return models;
		const out: (ParsedPolygonSoupList | null)[] = new Array(models.length);
		for (let i = 0; i < models.length; i++) {
			out[i] = visibleModelIndexes.has(i) ? models[i] : null;
		}
		return out;
	}, [models, visibleModelIndexes]);

	// Cache hits for every model whose identity survived the last edit, so an
	// edit rebuilds only the track unit(s) it touched.
	const chunks = useMemo(
		() => effectiveModels.map((m) => (m ? getSoupChunk(m) : null)),
		[effectiveModels],
	);

	const stats = useMemo(() => {
		let triangleCount = 0;
		let soupCount = 0;
		let modelCount = 0;
		const bounds = new THREE.Box3();
		for (const c of chunks) {
			if (!c) continue;
			triangleCount += c.triangleCount;
			soupCount += c.soupCount;
			if (c.soupCount > 0) modelCount++;
			bounds.union(c.bounds);
		}
		const radius = bounds.isEmpty()
			? 100
			: Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 50);
		return { triangleCount, soupCount, modelCount, radius };
	}, [chunks]);

	const outlineGeometry = useLineSegmentsGeometry(
		() => iterateSelectionOutlineEdges(effectiveModels, selectedModelIndex, outlinedPolys),
		[effectiveModels, selectedModelIndex, outlinedPolys],
	);

	// Cross-resource mixed-Selection detector (issue #82). If any workspace
	// AI-section bulk has entries the user is curating a mixed Selection —
	// the AI-sections side is what the Bulk transform gizmo will act on, and
	// the PSL polys here are the SKIPPED side, so they get the red-tinted
	// paint. Null when no provider is mounted (legacy page route).
	const aiBulkWorkspace = useWorkspaceAISectionsBulk();
	const isMixedWithTransformables = useMemo(() => {
		if (!aiBulkWorkspace) return false;
		for (const s of aiBulkWorkspace.summaries) {
			if (s.count > 0) return true;
		}
		return false;
	}, [aiBulkWorkspace]);

	// The composition hands down a fresh `onPickInstancePoly` closure on every
	// selection change; routing through a ref keeps `onPick` stable so the
	// memoised chunk meshes don't all re-render on each click.
	const sinkRef = useLatestRef(onPickFromCtx ?? onPickInstancePoly);
	const onPick = useCallback<SoupPickHandler>((modelIndex, soupIndex, polyIndex, modifiers) => {
		sinkRef.current?.(modelIndex, soupIndex, polyIndex, modifiers);
	}, [sinkRef]);

	const selectedChunk = chunks[selectedModelIndex] ?? null;

	// HTML siblings — marquee + status badge.
	const htmlNode = useMemo(() => {
		const showMarquee = onMarqueeApply != null && stats.triangleCount > 0;
		const status = (
			<div
				style={{
					position: 'absolute', top: 8, left: 8,
					background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.8)',
					padding: '4px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'monospace',
					pointerEvents: 'none',
				}}
			>
				{stats.modelCount} resources · {stats.soupCount} soups · {stats.triangleCount.toLocaleString()} triangles
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
						far={Math.max(stats.radius * 10, 5000)}
						onMarquee={(frustum, mode) => {
							if (!onMarqueeApply || !selectedChunk) return;
							const polys = pickChunkPolysInFrustum(selectedChunk, frustum);
							if (polys.length === 0) return;
							onMarqueeApply(selectedModelIndex, polys, mode);
						}}
						hintIdle="press B to box-select polygons"
					/>
				)}
			</>
		);
	}, [stats, selectedChunk, onMarqueeApply, onPickFromCtx, selectedModelIndex, selectedPolysInCurrentModel]);
	// Drop our marquee + status badge when this overlay isn't the focused
	// resource; a sibling Bundle's overlay would otherwise stack tools on
	// top (issue #24 follow-up).
	useWorldViewportHtmlSlot(isActive ? htmlNode : null);

	if (stats.triangleCount === 0) {
		return null;
	}

	return (
		<>
			{chunks.map((chunk, i) => {
				if (!chunk || chunk.triangleCount === 0) return null;
				const isSelectedModel = i === selectedModelIndex;
				return (
					<PolygonSoupChunkMesh
						key={i}
						chunk={chunk}
						modelIndex={i}
						isSelectedModel={isSelectedModel}
						selectedPolys={isSelectedModel ? selectedPolysInCurrentModel : EMPTY_POLY_SELECTION}
						skippedByBulkTransform={isSelectedModel && isMixedWithTransformables}
						onPick={onPick}
					/>
				);
			})}
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

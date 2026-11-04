// TriggerDataOverlay — WorldViewport overlay for the TriggerData resource.
//
// Renders BoxRegion volumes (landmarks / generic / blackspots / VFX) as a
// single batched InstancedMesh, spawn locations as cones+arrows, roaming
// locations as instanced spheres, and the player-start as a gold cone with
// direction arrow. Selection currency is the schema NodePath (ADR-0001):
//
//   - ['landmarks', i]
//   - ['genericRegions', i]
//   - ['blackspots', i]
//   - ['vfxBoxRegions', i]
//   - ['spawnLocations', i]
//   - ['roamingLocations', i]
//   - ['playerStartPosition']      (singleton — no index)
//   - ['playerStartDirection']     (singleton — no index)
//
// Both player-start path shapes collapse to the same in-3D selection
// (highlighted player-start cone). Sub-paths inside a region (e.g.
// `['landmarks', 3, 'box', 'position']`) collapse to "this region is
// selected" so drilling into a primitive in the inspector still keeps the
// 3D highlight on the parent.
//
// Codec is `triggerSelectionCodec` (Selection-module shape: `{kind, indices}`)
// with thin `triggerPathMarker` / `triggerMarkerPath` aliases preserved for
// pre-migration test imports.
//
// The BatchedRegionBoxes mesh hosts four kinds on one InstancedMesh, so it
// can't use the `useInstancedSelection` hook (which is single-kind). Its
// inline paint loop resolves colour via the shared `pickRegionColor` helper so
// its precedence (primary > hover > bulk > base) can't drift from the hook.
// RoamingDots is single-kind and uses the hook directly.
//
// DOM siblings: marquee bulk-select rides the WorldViewport HTML slot.
//
// Direct manipulation runs through the shared transform core
// (`@/lib/core/transform` + the triggerData resolver). All this overlay owns is
// the Selection→ref mapping and the gesture-start Pivot snapshot; the packing,
// the Euler composition and the reference-identity contract live in the
// resolver, and there is one code path for every cardinality.

import { useCallback, useMemo, useRef, useState } from 'react';
import { useUpdateInstancedMesh } from '@/lib/three/scene/useUpdateInstancedMesh';
import { ThreeEvent } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { ParsedTriggerData, BoxRegion, Vector4 } from '@/lib/core/triggerData';
import { GenericRegionType } from '@/lib/core/triggerData';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
import { useTriggerDataBulk } from '@/components/workspace/TriggerDataBulkProvider';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import { useWorldViewportHtmlSlot } from './WorldViewport';
import {
	defineSelectionCodec,
	isDragRelease,
	SELECTION_THEME,
	useInstancedSelection,
	type Selection,
} from './selection';
import { pickRegionColor, pickRegionState } from './triggerOverlayColors';
import {
	resolverAxes,
	selectionPivot,
	toTransformDelta,
	transform,
	type Point,
} from '@/lib/core/transform';
import {
	triggerDataResolver,
	type TriggerDataRef,
} from '@/lib/core/transform/resolvers/triggerData';
import { BulkTransformGizmo } from '@/components/common/three/BulkTransformGizmo';
import {
	isIdentityDelta,
	type BulkTransformDelta,
} from '@/hooks/useBulkTransformDrag';

// ---------------------------------------------------------------------------
// Path ↔ Selection codec (exported for tests)
// ---------------------------------------------------------------------------

type TriggerMarkerKind =
	| 'landmark' | 'generic' | 'blackspot' | 'vfx'
	| 'spawn' | 'roaming' | 'playerStart';

const PATH_HEAD_TO_KIND: Record<string, TriggerMarkerKind> = {
	landmarks: 'landmark',
	genericRegions: 'generic',
	blackspots: 'blackspot',
	vfxBoxRegions: 'vfx',
	spawnLocations: 'spawn',
	roamingLocations: 'roaming',
};

const KIND_TO_LIST: Record<Exclude<TriggerMarkerKind, 'playerStart'>, string> = {
	landmark: 'landmarks',
	generic: 'genericRegions',
	blackspot: 'blackspots',
	vfx: 'vfxBoxRegions',
	spawn: 'spawnLocations',
	roaming: 'roamingLocations',
};

/**
 * Codec for every trigger-data entity. Sub-paths inside a region (e.g.
 * `['landmarks', 3, 'box', 'position']`) collapse to "this region is
 * selected". Both player-start singleton path shapes
 * (`playerStartPosition` and `playerStartDirection`) decode to the same
 * `{ kind: 'playerStart', indices: [0] }` selection because they share
 * the gold-cone marker; the inverse always returns the canonical
 * `playerStartPosition` path.
 */
export const triggerSelectionCodec = defineSelectionCodec({
	pathToSelection: (path: NodePath): Selection | null => {
		if (path.length === 0) return null;
		const head = path[0];
		if (head === 'playerStartPosition' || head === 'playerStartDirection') {
			return { kind: 'playerStart', indices: [0] };
		}
		if (typeof head !== 'string') return null;
		const kind = PATH_HEAD_TO_KIND[head];
		if (!kind) return null;
		const idx = path[1];
		if (typeof idx !== 'number') return null;
		return { kind, indices: [idx] };
	},
	selectionToPath: (sel: Selection): NodePath => {
		if (sel.kind === 'playerStart') return ['playerStartPosition'];
		const list = KIND_TO_LIST[sel.kind as Exclude<TriggerMarkerKind, 'playerStart'>];
		return list ? [list, sel.indices[0]] : [];
	},
});

/** Back-compat alias retained for test imports — `{kind, index}` shape over the new codec. */
export type TriggerMarker = { kind: TriggerMarkerKind; index: number } | null;

/** Back-compat alias retained for test imports. */
export function triggerPathMarker(path: NodePath): TriggerMarker {
	const sel = triggerSelectionCodec.pathToSelection(path);
	if (!sel) return null;
	return { kind: sel.kind as TriggerMarkerKind, index: sel.indices[0] };
}

/** Back-compat alias retained for test imports. */
export function triggerMarkerPath(m: TriggerMarker): NodePath {
	if (!m) return [];
	return triggerSelectionCodec.selectionToPath({ kind: m.kind, indices: [m.index] });
}

// ---------------------------------------------------------------------------
// Internal region entry — one per box, used by the InstancedMesh
// ---------------------------------------------------------------------------

type RegionEntry = {
	kind: 'landmark' | 'generic' | 'blackspot' | 'vfx';
	index: number;
	box: BoxRegion;
	color: THREE.Color;
	label: string;
};

function genericColorObj(type: GenericRegionType): THREE.Color {
	if (type <= 5 || type === 17 || type === 18) return new THREE.Color('#4488cc');
	if (type === 6 || type === 8 || type === 32) return new THREE.Color('#9944cc');
	if (type === 7 || type === 9 || type === 10 || type === 11) return new THREE.Color('#cc4444');
	if (type === 12) return new THREE.Color('#888888');
	if (type >= 13 && type <= 16) return new THREE.Color('#44cc88');
	if (type >= 19 && type <= 31) return new THREE.Color('#777777');
	return new THREE.Color('#aaaaaa');
}

const LANDMARK_COLOR = new THREE.Color('#44cc44');
const BLACKSPOT_COLOR = new THREE.Color('#cc2222');
const VFX_COLOR = new THREE.Color('#cc44cc');

function buildRegionList(data: ParsedTriggerData): RegionEntry[] {
	const out: RegionEntry[] = [];
	for (let i = 0; i < data.landmarks.length; i++) {
		const lm = data.landmarks[i];
		out.push({ kind: 'landmark', index: i, box: lm.box, color: LANDMARK_COLOR, label: `Landmark #${i} (id=${lm.id})` });
	}
	for (let i = 0; i < data.genericRegions.length; i++) {
		const gr = data.genericRegions[i];
		out.push({ kind: 'generic', index: i, box: gr.box, color: genericColorObj(gr.genericType), label: `Generic #${i} ${GenericRegionType[gr.genericType] ?? gr.genericType}` });
	}
	for (let i = 0; i < data.blackspots.length; i++) {
		const bs = data.blackspots[i];
		out.push({ kind: 'blackspot', index: i, box: bs.box, color: BLACKSPOT_COLOR, label: `Blackspot #${i} (score=${bs.scoreAmount})` });
	}
	for (let i = 0; i < data.vfxBoxRegions.length; i++) {
		out.push({ kind: 'vfx', index: i, box: data.vfxBoxRegions[i].box, color: VFX_COLOR, label: `VFX #${i}` });
	}
	return out;
}

// ---------------------------------------------------------------------------
// Shared geometries / materials
// ---------------------------------------------------------------------------

const _dummy = new THREE.Object3D();
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const boxMat = new THREE.MeshBasicMaterial({
	transparent: true,
	opacity: 0.15,
	side: THREE.DoubleSide,
	depthWrite: false,
});

const wireBoxEdges = new THREE.EdgesGeometry(boxGeo);
const selEdgeMat = new THREE.LineBasicMaterial({ color: '#ffaa33' });
const hovEdgeMat = new THREE.LineBasicMaterial({ color: '#66aaff' });

const coneGeo = new THREE.ConeGeometry(3, 8, 8);
const spawnMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.2 });
const spawnSelMat = new THREE.MeshStandardMaterial({ color: 0xffaa33, roughness: 0.4, metalness: 0.2, emissive: 0x664400, emissiveIntensity: 0.5 });
// Amber bulk tint — mirrors SELECTION_THEME.bulk (0xffcc66) for cones caught in
// a multi-select but not the single-selection pick.
const spawnBulkMat = new THREE.MeshStandardMaterial({ color: 0xffcc66, roughness: 0.4, metalness: 0.2, emissive: 0x554400, emissiveIntensity: 0.4 });

const roamGeo = new THREE.SphereGeometry(2, 8, 6);
const roamMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
const ROAM_COLOR = new THREE.Color(0x888888);

const playerMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.3, metalness: 0.4, emissive: 0x664400, emissiveIntensity: 0.3 });
const playerSelMat = new THREE.MeshStandardMaterial({ color: 0xffaa33, roughness: 0.3, metalness: 0.4, emissive: 0x664400, emissiveIntensity: 0.6 });
const playerConeGeo = new THREE.ConeGeometry(5, 12, 8);

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BatchedRegionBoxes({
	regions, primary, hovered, bulk, onPick, onHover,
}: {
	regions: RegionEntry[];
	primary: Selection | null;
	hovered: Selection | null;
	/** Bulk-selected box regions, keyed `${kind}:${index}`. */
	bulk: ReadonlySet<string>;
	onPick: (sel: Selection) => void;
	onHover: (sel: Selection | null) => void;
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);
	const count = regions.length;

	// Mixed-kind paint loop — one InstancedMesh hosts four selection kinds
	// (landmark / generic / blackspot / vfx) so the per-kind hook doesn't fit
	// here without expanding it to take a `kind` per-instance. Colour precedence
	// (primary > hover > bulk > base) lives in `pickRegionColor` so it can't
	// drift from useInstancedSelection.
	useUpdateInstancedMesh(
		meshRef,
		count,
		(mesh) => {
			for (let i = 0; i < count; i++) {
				const r = regions[i];
				_dummy.position.set(r.box.position.x, r.box.position.y, r.box.position.z);
				_dummy.rotation.set(r.box.rotation.x, r.box.rotation.y, r.box.rotation.z);
				_dummy.scale.set(r.box.dimensions.x || 1, r.box.dimensions.y || 1, r.box.dimensions.z || 1);
				_dummy.updateMatrix();
				mesh.setMatrixAt(i, _dummy.matrix);

				const isPrimary = primary?.kind === r.kind && primary.indices[0] === r.index;
				const isHovered = hovered?.kind === r.kind && hovered.indices[0] === r.index;
				const isBulk = bulk.has(`${r.kind}:${r.index}`);
				mesh.setColorAt(i, pickRegionColor({ isPrimary, isHovered, isBulk }, r.color, SELECTION_THEME));
			}
		},
		[regions, count, primary, hovered, bulk],
	);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (isDragRelease(e.nativeEvent.clientX, e.nativeEvent.clientY)) return;
		if (e.instanceId != null && e.instanceId < regions.length) {
			const r = regions[e.instanceId];
			onPick({ kind: r.kind, indices: [r.index] });
		}
	}, [regions, onPick]);

	const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null && e.instanceId < regions.length) {
			const r = regions[e.instanceId];
			onHover({ kind: r.kind, indices: [r.index] });
			document.body.style.cursor = 'pointer';
		}
	}, [regions, onHover]);

	const handlePointerOut = useCallback(() => {
		onHover(null);
		document.body.style.cursor = 'auto';
	}, [onHover]);

	if (count === 0) return null;

	return (
		<instancedMesh
			ref={meshRef}
			args={[boxGeo, boxMat, count]}
			onClick={handleClick}
			onPointerMove={handlePointerMove}
			onPointerOut={handlePointerOut}
		/>
	);
}

function BoxOverlayMesh({ box, material }: { box: BoxRegion; material: THREE.LineBasicMaterial }) {
	return (
		<group
			position={[box.position.x, box.position.y, box.position.z]}
			rotation={[box.rotation.x, box.rotation.y, box.rotation.z]}
			scale={[box.dimensions.x || 1, box.dimensions.y || 1, box.dimensions.z || 1]}
		>
			<lineSegments geometry={wireBoxEdges} material={material} />
		</group>
	);
}

function BoxLabel({ box, label, color }: { box: BoxRegion; label: string; color: string }) {
	return (
		<Html
			position={[box.position.x, box.position.y + (box.dimensions.y || 1) * 0.6, box.position.z]}
			center distanceFactor={300}
			style={{ pointerEvents: 'none' }}
		>
			<div style={{
				background: 'rgba(0,0,0,0.8)', color, padding: '2px 6px',
				borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace',
			}}>
				{label}
			</div>
		</Html>
	);
}

function SpawnArrows({
	data, primary, bulk, onPick,
}: {
	data: ParsedTriggerData;
	primary: Selection | null;
	/** Bulk-selected spawn indices. */
	bulk: ReadonlySet<number>;
	onPick: (sel: Selection) => void;
}) {
	return (
		<>
			{data.spawnLocations.map((sp, i) => {
				const pos: [number, number, number] = [sp.position.x, sp.position.y, sp.position.z];
				const isSel = primary?.kind === 'spawn' && primary.indices[0] === i;
				// Cones can't hover-paint (no InstancedMesh hover wiring here), so
				// hover is always false — precedence still lives in one helper.
				const state = pickRegionState({ isPrimary: isSel, isHovered: false, isBulk: bulk.has(i) });
				const coneMat = state === 'primary' ? spawnSelMat : state === 'bulk' ? spawnBulkMat : spawnMat;
				const dir = new THREE.Vector3(sp.direction.x, sp.direction.y, sp.direction.z);
				if (dir.lengthSq() > 0.001) dir.normalize();
				const arrowEnd: [number, number, number] = [
					sp.position.x + dir.x * 15, sp.position.y + dir.y * 15, sp.position.z + dir.z * 15,
				];
				return (
					<group key={`spawn-${i}`}>
						<mesh
							geometry={coneGeo}
							material={coneMat}
							position={pos}
							onClick={(e) => { e.stopPropagation(); if (isDragRelease(e.nativeEvent.clientX, e.nativeEvent.clientY)) return; onPick({ kind: 'spawn', indices: [i] }); }}
						/>
						<Line points={[pos, arrowEnd]} color={isSel ? '#ffaa33' : state === 'bulk' ? '#ffcc66' : '#ffffff'} lineWidth={2} />
						{isSel && (
							<Html position={pos} center distanceFactor={200} style={{ pointerEvents: 'none' }}>
								<div style={{
									background: 'rgba(0,0,0,0.8)', color: '#fff', padding: '2px 6px',
									borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace',
								}}>
									Spawn #{i}
								</div>
							</Html>
						)}
					</group>
				);
			})}
		</>
	);
}

function RoamingDots({
	data, primary, hovered, bulk, onPick, onHover,
}: {
	data: ParsedTriggerData;
	primary: Selection | null;
	hovered: Selection | null;
	bulk: ReadonlySet<string>;
	onPick: (sel: Selection) => void;
	onHover: (sel: Selection | null) => void;
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);
	const count = data.roamingLocations.length;

	const setMatrix = useCallback((i: number, dummy: THREE.Object3D) => {
		const rl = data.roamingLocations[i];
		dummy.position.set(rl.position.x, rl.position.y, rl.position.z);
	}, [data.roamingLocations]);

	const baseColorFor = useCallback(() => ROAM_COLOR, []);

	const handlers = useInstancedSelection(meshRef, {
		kind: 'roaming',
		count,
		primary,
		bulk,
		hovered,
		setMatrix,
		baseColorFor,
		onPick,
		onHover,
	});

	if (count === 0) return null;
	return <instancedMesh ref={meshRef} args={[roamGeo, roamMat, count]} {...handlers} />;
}

function PlayerStartMarker({
	data, primary, onPick,
}: {
	data: ParsedTriggerData;
	primary: Selection | null;
	onPick: (sel: Selection) => void;
}) {
	const pos: [number, number, number] = [data.playerStartPosition.x, data.playerStartPosition.y, data.playerStartPosition.z];
	const dir = new THREE.Vector3(data.playerStartDirection.x, data.playerStartDirection.y, data.playerStartDirection.z);
	if (dir.lengthSq() > 0.001) dir.normalize();
	const arrowEnd: [number, number, number] = [pos[0] + dir.x * 25, pos[1] + dir.y * 25, pos[2] + dir.z * 25];
	const isSel = primary?.kind === 'playerStart';

	return (
		<group>
			<mesh
				geometry={playerConeGeo}
				material={isSel ? playerSelMat : playerMat}
				position={pos}
				onClick={(e) => { e.stopPropagation(); if (isDragRelease(e.nativeEvent.clientX, e.nativeEvent.clientY)) return; onPick({ kind: 'playerStart', indices: [0] }); }}
			/>
			<Line points={[pos, arrowEnd]} color="#ffcc00" lineWidth={3} />
			<Html position={[pos[0], pos[1] + 15, pos[2]]} center distanceFactor={200} style={{ pointerEvents: 'none' }}>
				<div style={{
					background: 'rgba(0,0,0,0.8)', color: '#ffcc00', padding: '2px 6px',
					borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap', fontFamily: 'monospace', fontWeight: 'bold',
				}}>
					Player Start
				</div>
			</Html>
		</group>
	);
}

// ---------------------------------------------------------------------------
// Marquee centroid collector — extracted as a pure function so the bulk
// wiring spec can pin the projection (box.position for boxes, position for
// vectors) without mounting r3f. Mirrors AISectionsOverlay's marquee codec
// extraction in `__tests__/AISectionsOverlay.bulk.test.ts`.
// ---------------------------------------------------------------------------

/** Walk every bulk-eligible TriggerData list and return schema paths whose
 *  representative point falls inside `frustum`. Boxes project on
 *  `box.position`; spawns / roams project on `position`. The path shape is
 *  exactly what the bulk reducer expects (`[listKey, index]`). */
export function collectMarqueeHits(
	data: ParsedTriggerData,
	frustum: THREE.Frustum,
): NodePath[] {
	const hits: NodePath[] = [];
	const pt = new THREE.Vector3();
	const tryBox = (listKey: string, list: { box: BoxRegion }[]) => {
		for (let i = 0; i < list.length; i++) {
			const p = list[i].box.position;
			pt.set(p.x, p.y, p.z);
			if (frustum.containsPoint(pt)) hits.push([listKey, i]);
		}
	};
	const tryVec = (listKey: string, list: { position: Vector4 }[]) => {
		for (let i = 0; i < list.length; i++) {
			const p = list[i].position;
			pt.set(p.x, p.y, p.z);
			if (frustum.containsPoint(pt)) hits.push([listKey, i]);
		}
	};
	tryBox('landmarks', data.landmarks);
	tryBox('genericRegions', data.genericRegions);
	tryBox('blackspots', data.blackspots);
	tryBox('vfxBoxRegions', data.vfxBoxRegions);
	tryVec('spawnLocations', data.spawnLocations);
	tryVec('roamingLocations', data.roamingLocations);
	return hits;
}

// ---------------------------------------------------------------------------
// Selection → transform refs
//
// There is no single-entity vs bulk dispatch any more: one ref list feeds the
// shared transform core, and a one-ref list behaves exactly like the old
// single-entity path because the Pivot of one slot IS that entity's position.
// ---------------------------------------------------------------------------

/** Dedupe key for a ref list. `playerStart` is a singleton with no index. */
function refKey(ref: TriggerDataRef): string {
	return ref.kind === 'playerStart' ? 'playerStart' : `${ref.kind}:${ref.idx}`;
}

/** Map a bulk path-key (`'landmarks/3'`, `'roamingLocations/5'`, …) to a
 *  `TriggerDataRef`. Returns null when the key isn't bulk-eligible.
 *  Mirrors the inverse of `triggerSelectionCodec.selectionToPath` for the
 *  bulk-eligible subset. Exported for tests. */
export function bulkKeyToRef(key: string): TriggerDataRef | null {
	const slash = key.indexOf('/');
	if (slash < 0) return null;
	const listKey = key.slice(0, slash);
	const idx = Number(key.slice(slash + 1));
	if (!Number.isFinite(idx) || idx < 0) return null;
	switch (listKey) {
		case 'landmarks': return { kind: 'landmark', idx };
		case 'genericRegions': return { kind: 'generic', idx };
		case 'blackspots': return { kind: 'blackspot', idx };
		case 'vfxBoxRegions': return { kind: 'vfx', idx };
		case 'roamingLocations': return { kind: 'roaming', idx };
		case 'spawnLocations': return { kind: 'spawn', idx };
		default: return null;
	}
}

/** Selection kinds that address one indexed spatial entity. */
const INDEXED_REF_KINDS: ReadonlySet<string> = new Set([
	'landmark', 'generic', 'blackspot', 'vfx', 'roaming', 'spawn',
]);

/** Map a `Selection.kind` to the matching `TriggerDataRef`. Player start
 *  decodes to its own ref kind rather than to null: it is genuinely
 *  selectable, it just expands to zero slots, so the resolver — not this
 *  codec — is where "not transformable" is expressed. Exported for tests. */
export function selectionToRef(sel: Selection | null): TriggerDataRef | null {
	if (!sel) return null;
	if (sel.kind === 'playerStart') return { kind: 'playerStart' };
	if (!INDEXED_REF_KINDS.has(sel.kind)) return null;
	type IndexedRef = Exclude<TriggerDataRef, { kind: 'playerStart' }>;
	return { kind: sel.kind as IndexedRef['kind'], idx: sel.indices[0] };
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

const EMPTY_BULK: ReadonlySet<string> = new Set();
const EMPTY_SPAWN_BULK: ReadonlySet<number> = new Set();

type Props = {
	data: ParsedTriggerData;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
	onChange?: (next: ParsedTriggerData) => void;
	/** True when this overlay owns the active selection — gates tool registration. */
	isActive?: boolean;
	/** Bundle / instance identity, supplied by `WorldViewportComposition` so
	 *  the overlay can resolve "MY bulk" via `forInstance(bundleId, index)`.
	 *  Optional so legacy per-resource pages still mount cleanly with no bulk. */
	bundleId?: string;
	index?: number;
};

export const TriggerDataOverlay: WorldOverlayComponent<ParsedTriggerData> = ({
	data, selectedPath, onSelect, onChange, isActive = true, bundleId, index,
}: Props) => {
	const primary = useMemo(() => triggerSelectionCodec.pathToSelection(selectedPath), [selectedPath]);
	const [hovered, setHovered] = useState<Selection | null>(null);

	const handlePick = useCallback(
		(sel: Selection) => onSelect(triggerSelectionCodec.selectionToPath(sel)),
		[onSelect],
	);

	const regions = useMemo(() => buildRegionList(data), [data]);

	// Workspace-wide TriggerData bulk handle. Resolves "this overlay's bulk"
	// via per-instance lookup so two TriggerData overlays from two bundles
	// keep independent bulk Sets. When `bundleId`/`index` are missing (legacy
	// single-resource page route) we treat the bulk as absent.
	const triggerBulk = useTriggerDataBulk();
	const instanceBulk = useMemo(() => {
		if (!triggerBulk || bundleId == null || index == null) return null;
		return triggerBulk.forInstance(bundleId, index);
	}, [triggerBulk, bundleId, index]);

	// Translate the bulk path-key set (e.g. `'roamingLocations/3'`) into the
	// Selection-keyed Set `useInstancedSelection` expects (`'roaming:3'`).
	const roamingBulk = useMemo<ReadonlySet<string>>(() => {
		const keys = instanceBulk?.bulkPathKeys;
		if (!keys || keys.size === 0) return EMPTY_BULK;
		const out = new Set<string>();
		for (const k of keys) {
			if (!k.startsWith('roamingLocations/')) continue;
			const idx = Number(k.slice('roamingLocations/'.length));
			if (Number.isFinite(idx)) out.add(`roaming:${idx}`);
		}
		return out;
	}, [instanceBulk]);

	// Box-region bulk set keyed `${kind}:${index}` so BatchedRegionBoxes can
	// test membership against the RegionEntry it's painting. The mesh hosts all
	// four box kinds, so the key carries the kind — mirroring the `RegionEntry`
	// discriminator, NOT the on-disk list name.
	const boxRegionBulk = useMemo<ReadonlySet<string>>(() => {
		const keys = instanceBulk?.bulkPathKeys;
		if (!keys || keys.size === 0) return EMPTY_BULK;
		const out = new Set<string>();
		for (const k of keys) {
			const ref = bulkKeyToRef(k);
			if (ref && ref.kind !== 'roaming' && ref.kind !== 'spawn' && ref.kind !== 'playerStart') {
				out.add(`${ref.kind}:${ref.idx}`);
			}
		}
		return out;
	}, [instanceBulk]);

	// Spawn bulk set of raw indices (keys `spawnLocations/i`) — SpawnArrows
	// renders one cone per spawn and just needs `has(i)`.
	const spawnBulk = useMemo<ReadonlySet<number>>(() => {
		const keys = instanceBulk?.bulkPathKeys;
		if (!keys || keys.size === 0) return EMPTY_SPAWN_BULK;
		const out = new Set<number>();
		for (const k of keys) {
			if (!k.startsWith('spawnLocations/')) continue;
			const idx = Number(k.slice('spawnLocations/'.length));
			if (Number.isFinite(idx)) out.add(idx);
		}
		return out;
	}, [instanceBulk]);

	const findEntry = useCallback(
		(sel: Selection | null) => {
			if (!sel) return undefined;
			if (sel.kind === 'playerStart' || sel.kind === 'spawn' || sel.kind === 'roaming') return undefined;
			return regions.find((r) => r.kind === sel.kind && r.index === sel.indices[0]);
		},
		[regions],
	);
	const selEntry = findEntry(primary);
	const hovEntry = findEntry(hovered);

	// Transform refs — the workspace bulk-path-keys unioned with the inspector
	// pick. The union routinely produces the SAME entity twice; the shared
	// transform dedupes by slot key anyway, but we dedupe here too so the axis
	// profile and the pivot are computed over the ref list the user sees.
	const bulkRefs = useMemo<readonly TriggerDataRef[]>(() => {
		const out: TriggerDataRef[] = [];
		const seen = new Set<string>();
		const addUnique = (ref: TriggerDataRef) => {
			const key = refKey(ref);
			if (seen.has(key)) return;
			seen.add(key);
			out.push(ref);
		};
		if (instanceBulk) {
			for (const k of instanceBulk.bulkPathKeys) {
				const ref = bulkKeyToRef(k);
				if (ref) addUnique(ref);
			}
		}
		const primaryRef = selectionToRef(primary);
		if (primaryRef) addUnique(primaryRef);
		return out;
	}, [instanceBulk, primary]);

	// One gizmo, one code path, whatever the cardinality: the Pivot of a
	// one-slot Selection IS that entity's position, so a single box still turns
	// in place exactly as it did under the old single-entity dispatcher.
	// Null Pivot (empty Selection, or nothing but the non-transformable player
	// start) means no gizmo at all.
	const livePivot = useMemo(
		() => selectionPivot(data, bulkRefs, triggerDataResolver),
		[data, bulkRefs],
	);
	const gizmoAxes = useMemo(
		() => resolverAxes(bulkRefs, triggerDataResolver),
		[bulkRefs],
	);

	// Gesture-start Pivot snapshot, latched on the first `onTransform` frame and
	// reused for every later frame and for the commit: re-deriving the median
	// from already-moved positions turns a rigid rotate into a spiral.
	const pivotAtDragStart = useRef<Point | null>(null);
	const [dragDelta, setDragDelta] = useState<BulkTransformDelta | null>(null);

	// Preview model for the live drag, so box highlights and labels track the
	// gesture frame-for-frame. Preview and commit call the SAME `transform`, so
	// what the user sees during the drag is what lands in the model on release.
	// Out-of-range refs are skipped silently inside the resolver — there is no
	// throw left to catch.
	const previewModel: ParsedTriggerData | null = useMemo(() => {
		if (!dragDelta || isIdentityDelta(dragDelta)) return null;
		const next = transform(
			data,
			bulkRefs,
			toTransformDelta(dragDelta, pivotAtDragStart.current ?? livePivot),
			triggerDataResolver,
		);
		return next === data ? null : next;
	}, [data, bulkRefs, dragDelta, livePivot]);

	// Helper to read a box from either the preview or the original model.
	// During a drag we want to see the in-flight pose; otherwise the data.
	const readBox = useCallback(
		(kind: 'landmark' | 'generic' | 'blackspot' | 'vfx', idx: number): BoxRegion | null => {
			const src = previewModel ?? data;
			const list =
				kind === 'landmark' ? src.landmarks
				: kind === 'generic' ? src.genericRegions
				: kind === 'blackspot' ? src.blackspots
				: src.vfxBoxRegions;
			return list[idx]?.box ?? null;
		},
		[data, previewModel],
	);

	// The gizmo sits on the Pivot, ridden along by the live translate delta —
	// a rotation orbits the Pivot, so it never moves the gizmo itself.
	const gizmoPosition = useMemo<[number, number, number] | null>(() => {
		const base = pivotAtDragStart.current ?? livePivot;
		if (!base) return null;
		const dx = dragDelta?.translate.x ?? 0;
		const dy = dragDelta?.translate.y ?? 0;
		const dz = dragDelta?.translate.z ?? 0;
		return [base.x + dx, base.y + dy, base.z + dz];
	}, [livePivot, dragDelta]);

	// Drag handlers — the gizmo owns every direct-manipulation gesture in
	// the WorldViewport per ADR-0010. Preview is local React state; commit
	// fires onChange exactly once per gesture, which is the *only* point
	// a Workspace-undo entry is pushed (one entry per gesture, not per
	// drag-frame).
	const handleGizmoTransform = useCallback((delta: BulkTransformDelta) => {
		if (!pivotAtDragStart.current) pivotAtDragStart.current = livePivot;
		setDragDelta(delta);
	}, [livePivot]);

	const handleGizmoCommit = useCallback((delta: BulkTransformDelta) => {
		// Fall back to the live Pivot when a commit arrives with no preceding
		// frame, rather than dropping the rotation on the floor.
		const pivot = pivotAtDragStart.current ?? livePivot;
		pivotAtDragStart.current = null;
		setDragDelta(null);
		if (!onChange || isIdentityDelta(delta)) return;
		const next = transform(data, bulkRefs, toTransformDelta(delta, pivot), triggerDataResolver);
		if (next === data) return;
		// One onChange ⇒ one setResourceAt ⇒ one HistoryCommit on the
		// Workspace-undo stack. Drag-frames in between only updated local
		// React state — they didn't push undo entries.
		onChange(next);
	}, [data, bulkRefs, livePivot, onChange]);

	const handleGizmoCancel = useCallback(() => {
		pivotAtDragStart.current = null;
		setDragDelta(null);
	}, []);

	// Marquee — pick every region/spawn/roaming whose centroid falls inside
	// the dragged rectangle. Boxes use box.position; spawns / roams use
	// their position field. Routes through the workspace-side
	// `instanceBulk.onApplyPaths` so the right-sidebar BulkPanelStack and
	// future tree decoration light up in one dispatch.
	const cameraBridge = useRef<CameraBridgeData | null>(null);
	const handleMarquee = useCallback(
		(frustum: THREE.Frustum, mode: 'add' | 'remove') => {
			if (!instanceBulk) return;
			const hits = collectMarqueeHits(data, frustum);
			if (hits.length === 0) return;
			instanceBulk.onApplyPaths(hits, mode);
		},
		[data, instanceBulk],
	);

	const htmlNode = useMemo(
		() => (
			<MarqueeSelector
				bridge={cameraBridge}
				far={50000}
				onMarquee={handleMarquee}
				hintIdle="press B to box-select trigger regions"
			/>
		),
		[handleMarquee],
	);
	// Drop our marquee when this overlay isn't the focused resource — see
	// ADR-0007 / issue #24.
	useWorldViewportHtmlSlot(isActive ? htmlNode : null);

	// While dragging we paint the box highlight + label off the preview
	// model so the user sees the gesture live. The picker boxes / spawn
	// arrows / roaming dots stay on the static `data` so picking doesn't
	// jump as the drag progresses (a moving target is hard to keep
	// pointer-locked on).
	const previewSelBox = useMemo(() => {
		if (!selEntry) return null;
		const live = readBox(selEntry.kind, selEntry.index);
		return live ?? selEntry.box;
	}, [selEntry, readBox]);

	return (
		<>
			<BatchedRegionBoxes
				regions={regions}
				primary={primary}
				hovered={hovered}
				bulk={boxRegionBulk}
				onPick={handlePick}
				onHover={setHovered}
			/>

			{selEntry && previewSelBox && <BoxOverlayMesh box={previewSelBox} material={selEdgeMat} />}
			{hovEntry && hovEntry !== selEntry && <BoxOverlayMesh box={hovEntry.box} material={hovEdgeMat} />}

			{selEntry && previewSelBox && (
				<BoxLabel box={previewSelBox} label={selEntry.label} color="#ffaa33" />
			)}
			{hovEntry && hovEntry !== selEntry && (
				<BoxLabel box={hovEntry.box} label={hovEntry.label} color="#66aaff" />
			)}

			<SpawnArrows data={data} primary={primary} bulk={spawnBulk} onPick={handlePick} />
			<RoamingDots
				data={data}
				primary={primary}
				hovered={hovered}
				bulk={roamingBulk}
				onPick={handlePick}
				onHover={setHovered}
			/>
			<PlayerStartMarker data={data} primary={primary} onPick={handlePick} />

			{gizmoPosition && gizmoAxes && (
				<BulkTransformGizmo
					position={gizmoPosition}
					axes={gizmoAxes}
					onTransform={handleGizmoTransform}
					onCommit={handleGizmoCommit}
					onCancel={handleGizmoCancel}
				/>
			)}

			<CameraBridge bridge={cameraBridge} />
		</>
	);
};

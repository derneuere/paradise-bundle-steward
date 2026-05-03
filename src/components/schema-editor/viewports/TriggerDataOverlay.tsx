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
// inline paint loop stays — only the theme imports are migrated. RoamingDots
// is single-kind and uses the hook.
//
// DOM siblings: marquee bulk-select rides the WorldViewport HTML slot.

import { useCallback, useMemo, useRef, useState } from 'react';
import { useUpdateInstancedMesh } from '@/hooks/useUpdateInstancedMesh';
import { ThreeEvent } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { ParsedTriggerData, BoxRegion, Vector4 } from '@/lib/core/triggerData';
import { GenericRegionType } from '@/lib/core/triggerData';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
import { useSchemaBulkSelection } from '@/components/schema-editor/bulkSelectionContext';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import { useWorldViewportHtmlSlot } from './WorldViewport';
import {
	defineSelectionCodec,
	SELECTION_THEME,
	useInstancedSelection,
	type Selection,
} from './selection';

// ---------------------------------------------------------------------------
// Path ↔ Selection codec (exported for tests)
// ---------------------------------------------------------------------------

export type TriggerMarkerKind =
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
	regions, primary, hovered, onPick, onHover,
}: {
	regions: RegionEntry[];
	primary: Selection | null;
	hovered: Selection | null;
	onPick: (sel: Selection) => void;
	onHover: (sel: Selection | null) => void;
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);
	const count = regions.length;

	// Mixed-kind paint loop — one InstancedMesh hosts four selection kinds
	// (landmark / generic / blackspot / vfx) so the per-kind hook doesn't fit
	// here without expanding it to take a `kind` per-instance. The codec +
	// theme migrate cleanly; the loop itself stays inline.
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

				const isSel = primary?.kind === r.kind && primary.indices[0] === r.index;
				const isHov = hovered?.kind === r.kind && hovered.indices[0] === r.index;
				mesh.setColorAt(i, isSel ? SELECTION_THEME.primary : isHov ? SELECTION_THEME.hover : r.color);
			}
		},
		[regions, count, primary, hovered],
	);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
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
	data, primary, onPick,
}: {
	data: ParsedTriggerData;
	primary: Selection | null;
	onPick: (sel: Selection) => void;
}) {
	return (
		<>
			{data.spawnLocations.map((sp, i) => {
				const pos: [number, number, number] = [sp.position.x, sp.position.y, sp.position.z];
				const isSel = primary?.kind === 'spawn' && primary.indices[0] === i;
				const dir = new THREE.Vector3(sp.direction.x, sp.direction.y, sp.direction.z);
				if (dir.lengthSq() > 0.001) dir.normalize();
				const arrowEnd: [number, number, number] = [
					sp.position.x + dir.x * 15, sp.position.y + dir.y * 15, sp.position.z + dir.z * 15,
				];
				return (
					<group key={`spawn-${i}`}>
						<mesh
							geometry={coneGeo}
							material={isSel ? spawnSelMat : spawnMat}
							position={pos}
							onClick={(e) => { e.stopPropagation(); onPick({ kind: 'spawn', indices: [i] }); }}
						/>
						<Line points={[pos, arrowEnd]} color={isSel ? '#ffaa33' : '#ffffff'} lineWidth={2} />
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
				onClick={(e) => { e.stopPropagation(); onPick({ kind: 'playerStart', indices: [0] }); }}
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
// Overlay
// ---------------------------------------------------------------------------

const EMPTY_BULK: ReadonlySet<string> = new Set();

type Props = {
	data: ParsedTriggerData;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
	onChange?: (next: ParsedTriggerData) => void;
	/** True when this overlay owns the active selection — gates tool registration. */
	isActive?: boolean;
};

export const TriggerDataOverlay: WorldOverlayComponent<ParsedTriggerData> = ({
	data, selectedPath, onSelect, isActive = true,
}: Props) => {
	const primary = useMemo(() => triggerSelectionCodec.pathToSelection(selectedPath), [selectedPath]);
	const [hovered, setHovered] = useState<Selection | null>(null);

	const handlePick = useCallback(
		(sel: Selection) => onSelect(triggerSelectionCodec.selectionToPath(sel)),
		[onSelect],
	);

	const regions = useMemo(() => buildRegionList(data), [data]);

	const bulk = useSchemaBulkSelection();

	// Translate the bulk path-key set (e.g. `'roamingLocations/3'`) into the
	// Selection-keyed Set the hook expects (`'roaming:3'`). Only the subset
	// the hook cares about (single-kind 'roaming') need translation here.
	const roamingBulk = useMemo<ReadonlySet<string>>(() => {
		if (!bulk?.bulkPathKeys || bulk.bulkPathKeys.size === 0) return EMPTY_BULK;
		const out = new Set<string>();
		for (const k of bulk.bulkPathKeys) {
			if (!k.startsWith('roamingLocations/')) continue;
			const idx = Number(k.slice('roamingLocations/'.length));
			if (Number.isFinite(idx)) out.add(`roaming:${idx}`);
		}
		return out;
	}, [bulk]);

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

	// Marquee — pick every region/spawn/roaming whose centroid falls inside
	// the dragged rectangle. Boxes use box.position; spawns / roams use
	// their position field.
	const cameraBridge = useRef<CameraBridgeData | null>(null);
	const handleMarquee = useCallback(
		(frustum: THREE.Frustum, mode: 'add' | 'remove') => {
			if (!bulk?.onBulkApplyPaths) return;
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
			if (hits.length === 0) return;
			bulk.onBulkApplyPaths(hits, mode);
		},
		[data, bulk],
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

	return (
		<>
			<BatchedRegionBoxes
				regions={regions}
				primary={primary}
				hovered={hovered}
				onPick={handlePick}
				onHover={setHovered}
			/>

			{selEntry && <BoxOverlayMesh box={selEntry.box} material={selEdgeMat} />}
			{hovEntry && hovEntry !== selEntry && <BoxOverlayMesh box={hovEntry.box} material={hovEdgeMat} />}

			{selEntry && <BoxLabel box={selEntry.box} label={selEntry.label} color="#ffaa33" />}
			{hovEntry && hovEntry !== selEntry && (
				<BoxLabel box={hovEntry.box} label={hovEntry.label} color="#66aaff" />
			)}

			<SpawnArrows data={data} primary={primary} onPick={handlePick} />
			<RoamingDots
				data={data}
				primary={primary}
				hovered={hovered}
				bulk={roamingBulk}
				onPick={handlePick}
				onHover={setHovered}
			/>
			<PlayerStartMarker data={data} primary={primary} onPick={handlePick} />

			<CameraBridge bridge={cameraBridge} />
		</>
	);
};

export default TriggerDataOverlay;

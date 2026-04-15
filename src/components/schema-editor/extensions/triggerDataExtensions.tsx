// Schema-editor extensions for TriggerData.
//
// Wraps the existing Phase 1 triggerdata tabs as schema-editor extensions
// so the schema stays the source of truth for tree navigation + simple
// primitive editing, while the rich list components (virtualized tables,
// filter bar, clone/remove affordances) remain the source of truth for
// bulk editing.
//
// The parent TriggerDataEditor used to own several pieces of shared
// state: a filter query, a duplicate-region-index set, scroll positions
// per tab, and a "Edit Box" dialog. In the schema editor those pieces
// are recreated locally per extension:
//   - filterQuery: useState inside each complex list extension.
//   - duplicateRegionIndexSet: computed from the current data in a
//     shared hook (cheap — one pass across all regions).
//   - scrollPosRef: throwaway ref per extension (no longer preserved
//     across tab switches — the schema tabs are self-contained).
//   - Edit Box: instead of opening a dialog, clicking "Edit Box" now
//     navigates the schema selection to the corresponding `.box` path,
//     which surfaces the BoxRegion record in the inspector.
//
// Each list extension's `setData` prop replaces the entire resource
// root, matching the original list components' `onChange(next)` contract.

import React, { useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';

import type { SchemaExtensionProps, ExtensionRegistry } from '../context';
import { useSchemaEditor } from '../context';
import type { NodePath } from '@/lib/schema/walk';
import type {
	ParsedTriggerData,
	Landmark,
	GenericRegion,
	Blackspot,
	VFXBoxRegion,
	SignatureStunt,
	Killzone,
	RoamingLocation,
	SpawnLocation,
	TriggerRegionType,
	StuntCameraType,
	GenericRegionType,
	BlackspotScoreType,
} from '@/lib/core/triggerData';
import { SpawnType } from '@/lib/core/triggerData';

// Phase 1 list component imports.
import { HeaderEditor } from '@/components/triggerdata/HeaderEditor';
import { LandmarksListComp } from '@/components/triggerdata/LandmarksListComp';
import { GenericRegionsListComp } from '@/components/triggerdata/GenericRegionsListComp';
import { BlackspotsListComp } from '@/components/triggerdata/BlackspotsListComp';
import { VfxListComp } from '@/components/triggerdata/VfxListComp';
import { SignatureStuntsList } from '@/components/triggerdata/SignatureStuntsList';
import { KillzonesList } from '@/components/triggerdata/KillzonesList';
import { RoamingList } from '@/components/triggerdata/RoamingList';
import { SpawnsList } from '@/components/triggerdata/SpawnsList';
import { RegionsMap } from '@/components/triggerdata/RegionsMap';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Recreate the TriggerDataEditor's filter matcher verbatim. The logic is
// "stringify everything and do a case-insensitive substring check" — good
// enough for the existing tests and the user expectation.
function matchesFilter(item: Record<string, unknown>, query: string): boolean {
	if (!query) return true;
	const q = query.toLowerCase();
	for (const v of Object.values(item)) {
		if (v == null) continue;
		if (typeof v === 'number' || typeof v === 'bigint') {
			if (String(v).includes(q)) return true;
		} else if (typeof v === 'string') {
			if (v.toLowerCase().includes(q)) return true;
		} else if (Array.isArray(v)) {
			if (v.some((x) => String(x).toLowerCase().includes(q))) return true;
		} else if (typeof v === 'object') {
			// Match vector / box sub-objects by their numeric leaves.
			if (
				Object.values(v as Record<string, unknown>).some(
					(sv) => typeof sv === 'number' && String(sv).includes(q),
				)
			) {
				return true;
			}
		}
	}
	return false;
}

function buildFilteredIndices<T extends Record<string, unknown>>(
	arr: T[],
	filterQuery: string,
): number[] {
	if (!filterQuery) return arr.map((_, i) => i);
	return arr.reduce<number[]>((acc, item, i) => {
		if (matchesFilter(item, filterQuery)) acc.push(i);
		return acc;
	}, []);
}

// Compute the duplicate regionIndex set across all four region arrays.
// This is read-only; the list components only use it to highlight cells.
function buildDuplicateRegionIndexSet(data: ParsedTriggerData): Set<number> {
	const counts = new Map<number, number>();
	const add = (v: number) => counts.set(v | 0, (counts.get(v | 0) ?? 0) + 1);
	for (const r of data.vfxBoxRegions) add(r.regionIndex);
	for (const r of data.blackspots) add(r.regionIndex);
	for (const r of data.genericRegions) add(r.regionIndex);
	for (const r of data.landmarks) add(r.regionIndex);
	const dups = new Set<number>();
	counts.forEach((c, k) => {
		if ((k | 0) >= 0 && c > 1) dups.add(k);
	});
	return dups;
}

// Next free regionIndex, scanning the used set and optionally excluding
// the current item so "fixing" duplicates doesn't pick its own value.
function nextFreeRegionIndex(
	data: ParsedTriggerData,
	exclude?: { kind: 'landmark' | 'generic' | 'blackspot' | 'vfx'; index: number },
): number {
	const used = new Set<number>();
	data.vfxBoxRegions.forEach((r, i) => {
		if (!(exclude && exclude.kind === 'vfx' && exclude.index === i)) used.add(r.regionIndex | 0);
	});
	data.blackspots.forEach((r, i) => {
		if (!(exclude && exclude.kind === 'blackspot' && exclude.index === i)) used.add(r.regionIndex | 0);
	});
	data.genericRegions.forEach((r, i) => {
		if (!(exclude && exclude.kind === 'generic' && exclude.index === i)) used.add(r.regionIndex | 0);
	});
	data.landmarks.forEach((r, i) => {
		if (!(exclude && exclude.kind === 'landmark' && exclude.index === i)) used.add(r.regionIndex | 0);
	});
	let n = 0;
	while (used.has(n)) n++;
	return n;
}

// Empty per-tab scroll position ref. Each extension instance gets its
// own; the original cross-tab persistence is not preserved because the
// schema tabs don't share a parent component.
function makeScrollPosRef() {
	return { landmarks: 0, generic: 0, blackspots: 0, vfx: 0 };
}

// Map the "Edit Box" button click onto a schema selection. In the old
// editor, the button opened a modal dialog. In the schema editor we let
// the inspector handle the box form — just navigate the selection.
function useBoxNavigator() {
	const { selectPath } = useSchemaEditor();
	return (kind: 'landmark' | 'generic' | 'blackspot' | 'vfx', index: number) => {
		const pathByKind: Record<typeof kind, NodePath> = {
			landmark: ['landmarks', index, 'box'],
			generic: ['genericRegions', index, 'box'],
			blackspot: ['blackspots', index, 'box'],
			vfx: ['vfxBoxRegions', index, 'box'],
		};
		selectPath(pathByKind[kind]);
	};
}

// Shared filter input chrome — keeps the extension layouts consistent
// with the original tab's header.
function FilterBar({
	query,
	onQueryChange,
	onAdd,
	addLabel,
}: {
	query: string;
	onQueryChange: (q: string) => void;
	onAdd?: () => void;
	addLabel?: string;
}) {
	return (
		<div className="flex items-center gap-2 mb-3">
			<div className="relative flex-1 max-w-sm">
				<Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
				<Input
					className="pl-8 h-8"
					placeholder="Filter…"
					value={query}
					onChange={(e) => onQueryChange(e.target.value)}
				/>
			</div>
			{onAdd && (
				<Button size="sm" onClick={onAdd}>
					{addLabel ?? 'Add'}
				</Button>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Header extension — wraps HeaderEditor for the TriggerData root form
// ---------------------------------------------------------------------------

export const HeaderExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => (
	<Card>
		<CardHeader>
			<CardTitle className="text-sm">Header</CardTitle>
		</CardHeader>
		<CardContent>
			<HeaderEditor
				data={data as ParsedTriggerData}
				onChange={setData as (next: ParsedTriggerData) => void}
			/>
		</CardContent>
	</Card>
);

// ---------------------------------------------------------------------------
// Regions 2D map — read-only leaflet view of every region
// ---------------------------------------------------------------------------

export const RegionsMapExtension: React.FC<SchemaExtensionProps> = ({ data }) => (
	<Card>
		<CardHeader>
			<CardTitle className="text-sm">Region Map (2D)</CardTitle>
		</CardHeader>
		<CardContent>
			<RegionsMap data={data as ParsedTriggerData} />
		</CardContent>
	</Card>
);

// ---------------------------------------------------------------------------
// Complex list extensions — virtualized tables with filter + clone / add
// ---------------------------------------------------------------------------

export const LandmarksExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => {
	const td = data as ParsedTriggerData;
	const onChange = setData as (next: ParsedTriggerData) => void;
	const [filterQuery, setFilterQuery] = useState('');
	const scrollPosRef = useRef(makeScrollPosRef());
	const duplicateRegionIndexSet = useMemo(() => buildDuplicateRegionIndexSet(td), [td]);
	const filteredIndices = useMemo(
		() => buildFilteredIndices(td.landmarks as unknown as Record<string, unknown>[], filterQuery),
		[td.landmarks, filterQuery],
	);
	const navigateToBox = useBoxNavigator();

	const addLandmark = () => {
		const lm: Landmark = {
			type: 0 as TriggerRegionType,
			id: 0,
			regionIndex: nextFreeRegionIndex(td),
			box: {
				positionX: 0, positionY: 0, positionZ: 0,
				rotationX: 0, rotationY: 0, rotationZ: 0,
				dimensionX: 1, dimensionY: 1, dimensionZ: 1,
			},
			enabled: 1,
			startingGrids: [],
			designIndex: 0,
			district: 0,
			flags: 0,
		};
		onChange({ ...td, landmarks: [...td.landmarks, lm] });
	};

	const cloneLandmark = (index: number) => {
		const src = td.landmarks[index];
		if (!src) return;
		const nextId = td.landmarks.reduce((mx, x) => Math.max(mx, x.id), 0) + 1;
		const clone: Landmark = {
			...src,
			box: { ...src.box },
			startingGrids: [...src.startingGrids],
			id: nextId,
			regionIndex: nextFreeRegionIndex(td),
		};
		onChange({
			...td,
			landmarks: [...td.landmarks.slice(0, index + 1), clone, ...td.landmarks.slice(index + 1)],
		});
	};

	return (
		<div>
			<FilterBar
				query={filterQuery}
				onQueryChange={setFilterQuery}
				onAdd={addLandmark}
				addLabel="Add"
			/>
			<LandmarksListComp
				data={td}
				onChange={onChange}
				duplicateRegionIndexSet={duplicateRegionIndexSet}
				ensureUniqueRegionIndex={() => 0}
				scrollPosRef={scrollPosRef}
				onEditBox={(kind, index) => navigateToBox(kind, index)}
				onClone={cloneLandmark}
				filteredIndices={filteredIndices}
			/>
		</div>
	);
};

export const GenericRegionsExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => {
	const td = data as ParsedTriggerData;
	const onChange = setData as (next: ParsedTriggerData) => void;
	const [filterQuery, setFilterQuery] = useState('');
	const scrollPosRef = useRef(makeScrollPosRef());
	const duplicateRegionIndexSet = useMemo(() => buildDuplicateRegionIndexSet(td), [td]);
	const filteredIndices = useMemo(
		() =>
			buildFilteredIndices(
				td.genericRegions as unknown as Record<string, unknown>[],
				filterQuery,
			),
		[td.genericRegions, filterQuery],
	);
	const navigateToBox = useBoxNavigator();

	const addGeneric = () => {
		const gr: GenericRegion = {
			type: 2 as TriggerRegionType,
			id: 0,
			regionIndex: nextFreeRegionIndex(td),
			box: {
				positionX: 0, positionY: 0, positionZ: 0,
				rotationX: 0, rotationY: 0, rotationZ: 0,
				dimensionX: 1, dimensionY: 1, dimensionZ: 1,
			},
			enabled: 1,
			groupId: 0,
			cameraCut1: 0,
			cameraCut2: 0,
			cameraType1: 0 as StuntCameraType,
			cameraType2: 0 as StuntCameraType,
			genericType: 0 as GenericRegionType,
			isOneWay: 0,
		};
		onChange({ ...td, genericRegions: [...td.genericRegions, gr] });
	};

	const cloneGeneric = (index: number) => {
		const src = td.genericRegions[index];
		if (!src) return;
		const nextId = td.genericRegions.reduce((mx, x) => Math.max(mx, x.id), 0) + 1;
		const clone: GenericRegion = {
			...src,
			box: { ...src.box },
			id: nextId,
			regionIndex: nextFreeRegionIndex(td),
		};
		onChange({
			...td,
			genericRegions: [
				...td.genericRegions.slice(0, index + 1),
				clone,
				...td.genericRegions.slice(index + 1),
			],
		});
	};

	return (
		<div>
			<FilterBar
				query={filterQuery}
				onQueryChange={setFilterQuery}
				onAdd={addGeneric}
				addLabel="Add"
			/>
			<GenericRegionsListComp
				data={td}
				onChange={onChange}
				duplicateRegionIndexSet={duplicateRegionIndexSet}
				ensureUniqueRegionIndex={() => 0}
				scrollPosRef={scrollPosRef}
				onEditBox={(kind, index) => navigateToBox(kind, index)}
				onClone={cloneGeneric}
				filteredIndices={filteredIndices}
			/>
		</div>
	);
};

export const BlackspotsExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => {
	const td = data as ParsedTriggerData;
	const onChange = setData as (next: ParsedTriggerData) => void;
	const [filterQuery, setFilterQuery] = useState('');
	const scrollPosRef = useRef(makeScrollPosRef());
	const duplicateRegionIndexSet = useMemo(() => buildDuplicateRegionIndexSet(td), [td]);
	const filteredIndices = useMemo(
		() =>
			buildFilteredIndices(td.blackspots as unknown as Record<string, unknown>[], filterQuery),
		[td.blackspots, filterQuery],
	);
	const navigateToBox = useBoxNavigator();

	const addBlackspot = () => {
		const bs: Blackspot = {
			type: 1 as TriggerRegionType,
			id: 0,
			regionIndex: nextFreeRegionIndex(td),
			box: {
				positionX: 0, positionY: 0, positionZ: 0,
				rotationX: 0, rotationY: 0, rotationZ: 0,
				dimensionX: 1, dimensionY: 1, dimensionZ: 1,
			},
			enabled: 1,
			scoreType: 0 as BlackspotScoreType,
			scoreAmount: 0,
		};
		onChange({ ...td, blackspots: [...td.blackspots, bs] });
	};

	const cloneBlackspot = (index: number) => {
		const src = td.blackspots[index];
		if (!src) return;
		const nextId = td.blackspots.reduce((mx, x) => Math.max(mx, x.id), 0) + 1;
		const clone: Blackspot = {
			...src,
			box: { ...src.box },
			id: nextId,
			regionIndex: nextFreeRegionIndex(td),
		};
		onChange({
			...td,
			blackspots: [
				...td.blackspots.slice(0, index + 1),
				clone,
				...td.blackspots.slice(index + 1),
			],
		});
	};

	return (
		<div>
			<FilterBar
				query={filterQuery}
				onQueryChange={setFilterQuery}
				onAdd={addBlackspot}
				addLabel="Add"
			/>
			<BlackspotsListComp
				data={td}
				onChange={onChange}
				duplicateRegionIndexSet={duplicateRegionIndexSet}
				ensureUniqueRegionIndex={() => 0}
				scrollPosRef={scrollPosRef}
				onEditBox={(kind, index) => navigateToBox(kind, index)}
				onClone={cloneBlackspot}
				filteredIndices={filteredIndices}
			/>
		</div>
	);
};

export const VfxExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => {
	const td = data as ParsedTriggerData;
	const onChange = setData as (next: ParsedTriggerData) => void;
	const [filterQuery, setFilterQuery] = useState('');
	const scrollPosRef = useRef(makeScrollPosRef());
	const duplicateRegionIndexSet = useMemo(() => buildDuplicateRegionIndexSet(td), [td]);
	const filteredIndices = useMemo(
		() =>
			buildFilteredIndices(
				td.vfxBoxRegions as unknown as Record<string, unknown>[],
				filterQuery,
			),
		[td.vfxBoxRegions, filterQuery],
	);
	const navigateToBox = useBoxNavigator();

	const addVfx = () => {
		const v: VFXBoxRegion = {
			type: 3 as TriggerRegionType,
			id: 0,
			regionIndex: nextFreeRegionIndex(td),
			box: {
				positionX: 0, positionY: 0, positionZ: 0,
				rotationX: 0, rotationY: 0, rotationZ: 0,
				dimensionX: 1, dimensionY: 1, dimensionZ: 1,
			},
			enabled: 1,
		};
		onChange({ ...td, vfxBoxRegions: [...td.vfxBoxRegions, v] });
	};

	const cloneVfx = (index: number) => {
		const src = td.vfxBoxRegions[index];
		if (!src) return;
		const nextId = td.vfxBoxRegions.reduce((mx, x) => Math.max(mx, x.id), 0) + 1;
		const clone: VFXBoxRegion = {
			...src,
			box: { ...src.box },
			id: nextId,
			regionIndex: nextFreeRegionIndex(td),
		};
		onChange({
			...td,
			vfxBoxRegions: [
				...td.vfxBoxRegions.slice(0, index + 1),
				clone,
				...td.vfxBoxRegions.slice(index + 1),
			],
		});
	};

	return (
		<div>
			<FilterBar query={filterQuery} onQueryChange={setFilterQuery} onAdd={addVfx} addLabel="Add" />
			<VfxListComp
				data={td}
				onChange={onChange}
				duplicateRegionIndexSet={duplicateRegionIndexSet}
				ensureUniqueRegionIndex={() => 0}
				scrollPosRef={scrollPosRef}
				onEditBox={(kind, index) => navigateToBox(kind, index)}
				onClone={cloneVfx}
				filteredIndices={filteredIndices}
			/>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Simple list extensions — signature stunts, killzones, roaming, spawns.
//
// These list components take a simpler (data, onChange, onAdd, filteredIndices)
// shape, so the extension just wires up a filter bar + add handler.
// ---------------------------------------------------------------------------

export const SignatureStuntsExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => {
	const td = data as ParsedTriggerData;
	const onChange = setData as (next: ParsedTriggerData) => void;
	const [filterQuery, setFilterQuery] = useState('');
	const filteredIndices = useMemo(
		() =>
			buildFilteredIndices(
				td.signatureStunts as unknown as Record<string, unknown>[],
				filterQuery,
			),
		[td.signatureStunts, filterQuery],
	);

	const addSignatureStunt = () => {
		const st: SignatureStunt = { id: 0n, camera: 0n, stuntElementRegionIds: [] };
		onChange({ ...td, signatureStunts: [...td.signatureStunts, st] });
	};

	return (
		<div>
			<FilterBar
				query={filterQuery}
				onQueryChange={setFilterQuery}
				onAdd={addSignatureStunt}
				addLabel="Add Stunt"
			/>
			<SignatureStuntsList
				data={td}
				onChange={onChange}
				onAdd={addSignatureStunt}
				filteredIndices={filteredIndices}
			/>
		</div>
	);
};

export const KillzonesExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => {
	const td = data as ParsedTriggerData;
	const onChange = setData as (next: ParsedTriggerData) => void;
	const [filterQuery, setFilterQuery] = useState('');
	const filteredIndices = useMemo(
		() =>
			buildFilteredIndices(td.killzones as unknown as Record<string, unknown>[], filterQuery),
		[td.killzones, filterQuery],
	);

	const addKillzone = () => {
		const kz: Killzone = { triggerIds: [], regionIds: [] };
		onChange({ ...td, killzones: [...td.killzones, kz] });
	};

	return (
		<div>
			<FilterBar
				query={filterQuery}
				onQueryChange={setFilterQuery}
				onAdd={addKillzone}
				addLabel="Add Killzone"
			/>
			<KillzonesList
				data={td}
				onChange={onChange}
				onAdd={addKillzone}
				filteredIndices={filteredIndices}
			/>
		</div>
	);
};

export const RoamingExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => {
	const td = data as ParsedTriggerData;
	const onChange = setData as (next: ParsedTriggerData) => void;
	const [filterQuery, setFilterQuery] = useState('');
	const filteredIndices = useMemo(
		() =>
			buildFilteredIndices(
				td.roamingLocations as unknown as Record<string, unknown>[],
				filterQuery,
			),
		[td.roamingLocations, filterQuery],
	);

	const addRoaming = () => {
		const rl: RoamingLocation = { position: { x: 0, y: 0, z: 0, w: 0 }, districtIndex: 0 };
		onChange({ ...td, roamingLocations: [...td.roamingLocations, rl] });
	};

	return (
		<div>
			<FilterBar
				query={filterQuery}
				onQueryChange={setFilterQuery}
				onAdd={addRoaming}
				addLabel="Add Roaming"
			/>
			<RoamingList
				data={td}
				onChange={onChange}
				onAdd={addRoaming}
				filteredIndices={filteredIndices}
			/>
		</div>
	);
};

export const SpawnsExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => {
	const td = data as ParsedTriggerData;
	const onChange = setData as (next: ParsedTriggerData) => void;
	const [filterQuery, setFilterQuery] = useState('');
	const filteredIndices = useMemo(
		() =>
			buildFilteredIndices(
				td.spawnLocations as unknown as Record<string, unknown>[],
				filterQuery,
			),
		[td.spawnLocations, filterQuery],
	);

	const addSpawn = () => {
		const sp: SpawnLocation = {
			position: { x: 0, y: 0, z: 0, w: 0 },
			direction: { x: 0, y: 0, z: 0, w: 0 },
			junkyardId: 0n,
			type: SpawnType.E_TYPE_PLAYER_SPAWN,
		};
		onChange({ ...td, spawnLocations: [...td.spawnLocations, sp] });
	};

	return (
		<div>
			<FilterBar
				query={filterQuery}
				onQueryChange={setFilterQuery}
				onAdd={addSpawn}
				addLabel="Add Spawn"
			/>
			<SpawnsList
				data={td}
				onChange={onChange}
				onAdd={addSpawn}
				filteredIndices={filteredIndices}
			/>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Registry — hand this map to <SchemaEditorProvider extensions={...}>.
//
// Keys here must match the names used in the schema's `customRenderer`
// and `propertyGroups[].component` fields.
// ---------------------------------------------------------------------------

export const triggerDataExtensions: ExtensionRegistry = {
	HeaderTab: HeaderExtension,
	RegionsMapTab: RegionsMapExtension,
	LandmarksTab: LandmarksExtension,
	GenericRegionsTab: GenericRegionsExtension,
	BlackspotsTab: BlackspotsExtension,
	VfxTab: VfxExtension,
	SignatureStuntsTab: SignatureStuntsExtension,
	KillzonesTab: KillzonesExtension,
	RoamingTab: RoamingExtension,
	SpawnsTab: SpawnsExtension,
};

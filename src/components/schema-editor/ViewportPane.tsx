// Center pane — hosts the resource's 3D viewport.
//
// Each resource key has its own branch here. The shims translate between the
// schema editor's path-based selection model and each viewport's native
// selection shape so we can reuse the existing viewport components without
// porting them into the schema editor.

import { useMemo } from 'react';
import type { ParsedTrafficData } from '@/lib/core/trafficData';
import { TrafficDataViewport } from '@/components/trafficdata/TrafficDataViewport';
import type { TrafficDataSelection } from '@/components/trafficdata/useTrafficSelection';
import type { ParsedStreetData } from '@/lib/core/streetData';
import {
	StreetDataViewport,
	type StreetDataSelection,
} from '@/components/streetdata/StreetDataViewport';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import {
	TriggerDataViewport,
	type TriggerSelection,
} from '@/components/triggerdata/TriggerDataViewport';
import { useSchemaEditor } from './context';
import type { NodePath } from '@/lib/schema/walk';
import { PolygonSoupListViewport } from './viewports/PolygonSoupListViewport';
import { RenderableViewport } from './viewports/RenderableViewport';

// ---------------------------------------------------------------------------
// Path ↔ TrafficDataSelection translation
// ---------------------------------------------------------------------------

// Maps a schema path into the viewport's selection shape.
// Recognized shapes:
//   ["hulls", h]                                     → { hullIndex: h }
//   ["hulls", h, "sections", i]                      → { ..., sub: section }
//   ["hulls", h, "rungs", i]                         → { ..., sub: rung }
//   ["hulls", h, "junctions", i]                     → { ..., sub: junction }
//   ["hulls", h, "lightTriggers", i]                 → { ..., sub: lightTrigger }
//   ["hulls", h, "staticTrafficVehicles", i]         → { ..., sub: staticVehicle }
function pathToSelection(path: NodePath): TrafficDataSelection {
	if (path.length < 2 || path[0] !== 'hulls') return null;
	const hullIndex = path[1];
	if (typeof hullIndex !== 'number') return null;
	if (path.length === 2) return { hullIndex };
	if (path.length < 4) return { hullIndex };
	const list = path[2];
	const idx = path[3];
	if (typeof list !== 'string' || typeof idx !== 'number') return { hullIndex };
	switch (list) {
		case 'sections':
			return { hullIndex, sub: { type: 'section', index: idx } };
		case 'rungs':
			return { hullIndex, sub: { type: 'rung', index: idx } };
		case 'junctions':
			return { hullIndex, sub: { type: 'junction', index: idx } };
		case 'lightTriggers':
			return { hullIndex, sub: { type: 'lightTrigger', index: idx } };
		case 'staticTrafficVehicles':
			return { hullIndex, sub: { type: 'staticVehicle', index: idx } };
		default:
			return { hullIndex };
	}
}

// Inverse: a TrafficDataSelection from the viewport becomes a schema path.
function selectionToPath(sel: TrafficDataSelection): NodePath {
	if (!sel) return [];
	const base: NodePath = ['hulls', sel.hullIndex];
	if (!sel.sub) return base;
	switch (sel.sub.type) {
		case 'section':
			return [...base, 'sections', sel.sub.index];
		case 'rung':
			return [...base, 'rungs', sel.sub.index];
		case 'junction':
			return [...base, 'junctions', sel.sub.index];
		case 'lightTrigger':
			return [...base, 'lightTriggers', sel.sub.index];
		case 'staticVehicle':
			return [...base, 'staticTrafficVehicles', sel.sub.index];
	}
}

// Derive the viewport's `activeTab` from the selection sub-type. The
// viewport uses this to filter what 3D layers it highlights.
function selectionToActiveTab(sel: TrafficDataSelection): string {
	if (!sel?.sub) return 'sections';
	switch (sel.sub.type) {
		case 'section': return 'sections';
		case 'rung': return 'rungs';
		case 'junction': return 'junctions';
		case 'lightTrigger': return 'lightTriggers';
		case 'staticVehicle': return 'staticVehicles';
	}
}

// ---------------------------------------------------------------------------
// Path ↔ StreetDataSelection translation
// ---------------------------------------------------------------------------

// StreetData paths are flat: ['streets' | 'junctions' | 'roads', N]. Anything
// outside those three lists collapses to no selection.
function pathToStreetDataSelection(path: NodePath): StreetDataSelection {
	if (path.length < 2) return null;
	const list = path[0];
	const idx = path[1];
	if (typeof list !== 'string' || typeof idx !== 'number') return null;
	if (list === 'streets') return { type: 'street', index: idx };
	if (list === 'junctions') return { type: 'junction', index: idx };
	if (list === 'roads') return { type: 'road', index: idx };
	return null;
}

function streetDataSelectionToPath(sel: StreetDataSelection): NodePath {
	if (!sel) return [];
	switch (sel.type) {
		case 'street':   return ['streets', sel.index];
		case 'junction': return ['junctions', sel.index];
		case 'road':     return ['roads', sel.index];
	}
}

// ---------------------------------------------------------------------------
// Path ↔ TriggerSelection translation
// ---------------------------------------------------------------------------
//
// The TriggerDataViewport was designed around a flat { kind, index } tuple
// where `kind` is one of landmark / generic / blackspot / vfx / spawn /
// roaming / playerStart. Map each top-level list path onto that shape.
// Anything deeper than the first list index is ignored — clicking a box
// sub-field in the tree still highlights the parent region in 3D.
function pathToTriggerSelection(path: NodePath): TriggerSelection {
	if (path.length === 0) return null;
	const head = path[0];
	if (head === 'playerStartPosition' || head === 'playerStartDirection') {
		return { kind: 'playerStart', index: 0 };
	}
	if (typeof path[1] !== 'number') return null;
	const idx = path[1] as number;
	switch (head) {
		case 'landmarks':        return { kind: 'landmark', index: idx };
		case 'genericRegions':   return { kind: 'generic', index: idx };
		case 'blackspots':       return { kind: 'blackspot', index: idx };
		case 'vfxBoxRegions':    return { kind: 'vfx', index: idx };
		case 'spawnLocations':   return { kind: 'spawn', index: idx };
		case 'roamingLocations': return { kind: 'roaming', index: idx };
		default:                 return null;
	}
}

function triggerSelectionToPath(sel: TriggerSelection): NodePath {
	if (!sel) return [];
	switch (sel.kind) {
		case 'landmark':    return ['landmarks', sel.index];
		case 'generic':     return ['genericRegions', sel.index];
		case 'blackspot':   return ['blackspots', sel.index];
		case 'vfx':         return ['vfxBoxRegions', sel.index];
		case 'spawn':       return ['spawnLocations', sel.index];
		case 'roaming':     return ['roamingLocations', sel.index];
		case 'playerStart': return ['playerStartPosition'];
	}
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ViewportPane() {
	const { resource, data, selectedPath, selectPath } = useSchemaEditor();

	if (resource.key === 'trafficData') {
		return <TrafficDataViewportShim data={data} selectedPath={selectedPath} selectPath={selectPath} />;
	}
	if (resource.key === 'streetData') {
		return <StreetDataViewportShim data={data} selectedPath={selectedPath} selectPath={selectPath} />;
	}
	if (resource.key === 'triggerData') {
		return <TriggerDataViewportShim data={data} selectedPath={selectedPath} selectPath={selectPath} />;
	}
	if (resource.key === 'polygonSoupList') {
		return <PolygonSoupListViewport />;
	}
	if (resource.key === 'renderable') {
		// Renderable's 3D preview is the main user-facing value of the
		// resource — a full three.js scene that decodes every 0xC record in
		// the bundle. It pulls its own state from useBundle + the
		// RenderableDecodedProvider supplied by RenderablePage, and wires
		// click events back to the schema editor via useSchemaEditor.
		// No path-shim layer needed here.
		return <RenderableViewport />;
	}
	return (
		<div className="h-full flex items-center justify-center text-xs text-muted-foreground">
			No viewport available for {resource.name}.
		</div>
	);
}

// Kept as a sub-component so the hooks below don't run for non-trafficData
// resources. Extracted exactly as-is from the original ViewportPane body.
function TrafficDataViewportShim({
	data,
	selectedPath,
	selectPath,
}: {
	data: unknown;
	selectedPath: NodePath;
	selectPath: (path: NodePath) => void;
}) {
	const trafficData = data as ParsedTrafficData;
	const selection = useMemo(() => pathToSelection(selectedPath), [selectedPath]);
	const activeHullIndex = selection?.hullIndex ?? 0;
	const activeTab = useMemo(() => selectionToActiveTab(selection), [selection]);

	return (
		<div className="h-full">
			<TrafficDataViewport
				data={trafficData}
				activeHullIndex={activeHullIndex}
				selected={selection}
				onSelect={(sel) => selectPath(selectionToPath(sel))}
				activeTab={activeTab}
			/>
		</div>
	);
}

// StreetData viewport shim. StreetDataViewport takes a `{ data, onChange,
// selected, onSelect }` API — we forward the schema editor's data and
// translate the selection shape.
function StreetDataViewportShim({
	data,
	selectedPath,
	selectPath,
}: {
	data: unknown;
	selectedPath: NodePath;
	selectPath: (path: NodePath) => void;
}) {
	const { setAtPath } = useSchemaEditor();
	const streetData = data as ParsedStreetData;
	const selection = useMemo(() => pathToStreetDataSelection(selectedPath), [selectedPath]);

	return (
		<div className="h-full">
			<StreetDataViewport
				data={streetData}
				onChange={(next) => setAtPath([], next)}
				selected={selection}
				onSelect={(sel) => selectPath(streetDataSelectionToPath(sel))}
			/>
		</div>
	);
}

// TriggerData viewport shim. TriggerDataViewport takes a
// `{ data, onChange, selected, onSelect }` API — forward the schema
// editor's data and translate selection via the helpers above.
function TriggerDataViewportShim({
	data,
	selectedPath,
	selectPath,
}: {
	data: unknown;
	selectedPath: NodePath;
	selectPath: (path: NodePath) => void;
}) {
	const { setAtPath } = useSchemaEditor();
	const triggerData = data as ParsedTriggerData;
	const selection = useMemo(() => pathToTriggerSelection(selectedPath), [selectedPath]);

	return (
		<div className="h-full">
			<TriggerDataViewport
				data={triggerData}
				// The viewport is read-only today but takes an onChange for
				// future in-scene edits. Route it through the schema editor's
				// root setter so any mutation participates in structural sharing.
				onChange={(next) => setAtPath([], next)}
				selected={selection}
				onSelect={(sel) => selectPath(triggerSelectionToPath(sel))}
			/>
		</div>
	);
}

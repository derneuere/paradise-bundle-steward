// Center pane — hosts the resource's 3D viewport.
//
// Each resource key has its own branch here. The shims translate between the
// schema editor's path-based selection model and each viewport's native
// selection shape so we can reuse the existing viewport components without
// porting them into the schema editor.

import { useMemo } from 'react';
import { ViewportErrorBoundary } from '@/components/common/ViewportErrorBoundary';
import type { ResourceSchema } from '@/lib/schema/types';
import type { ParsedTrafficData } from '@/lib/core/trafficData';
import { TrafficDataViewport } from '@/components/trafficdata/TrafficDataViewport';
import {
	isPvsCellSelection,
	type TrafficDataSelection,
} from '@/components/trafficdata/useTrafficSelection';
import type { ParsedStreetData } from '@/lib/core/streetData';
import { StreetDataOverlay } from './viewports/StreetDataOverlay';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import {
	TriggerDataViewport,
	type TriggerSelection,
} from '@/components/triggerdata/TriggerDataViewport';
import { useSchemaEditor } from './context';
import type { NodePath } from '@/lib/schema/walk';
import { PolygonSoupListViewport } from './viewports/PolygonSoupListViewport';
import { RenderableViewport } from './viewports/RenderableViewport';
import { TextureViewport } from './viewports/TextureViewport';
import type { ParsedAISections } from '@/lib/core/aiSections';
import { AISectionsOverlay } from './viewports/AISectionsOverlay';
import type { ParsedZoneList } from '@/lib/core/zoneList';
import { WorldViewport } from './viewports/WorldViewport';
import { ZoneListOverlay } from './viewports/ZoneListOverlay';

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
//   ["pvs", "hullPvsSets", N]                        → { kind: 'pvsCell', ... }
function pathToSelection(path: NodePath): TrafficDataSelection {
	if (path[0] === 'pvs' && path[1] === 'hullPvsSets' && typeof path[2] === 'number') {
		return { kind: 'pvsCell', cellIndex: path[2] };
	}
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
	if (isPvsCellSelection(sel)) return ['pvs', 'hullPvsSets', sel.cellIndex];
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
	if (!sel || isPvsCellSelection(sel)) return 'sections';
	if (!sel.sub) return 'sections';
	switch (sel.sub.type) {
		case 'section': return 'sections';
		case 'rung': return 'rungs';
		case 'junction': return 'junctions';
		case 'lightTrigger': return 'lightTriggers';
		case 'staticVehicle': return 'staticVehicles';
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

	// Error boundary resets when the user switches resource — otherwise a
	// crash on one resource would wedge the pane until a full page reload.
	return (
		<ViewportErrorBoundary resetKey={resource.key}>
			<ViewportPaneInner
				resource={resource}
				data={data}
				selectedPath={selectedPath}
				selectPath={selectPath}
			/>
		</ViewportErrorBoundary>
	);
}

function ViewportPaneInner({
	resource,
	data,
	selectedPath,
	selectPath,
}: {
	resource: ResourceSchema;
	data: unknown;
	selectedPath: NodePath;
	selectPath: (path: NodePath) => void;
}) {
	if (resource.key === 'trafficData') {
		return <TrafficDataViewportShim data={data} selectedPath={selectedPath} selectPath={selectPath} />;
	}
	if (resource.key === 'streetData') {
		return <StreetDataViewportShim data={data} selectedPath={selectedPath} selectPath={selectPath} />;
	}
	if (resource.key === 'triggerData') {
		return <TriggerDataViewportShim data={data} selectedPath={selectedPath} selectPath={selectPath} />;
	}
	if (resource.key === 'aiSections') {
		return <AISectionsViewportShim data={data} selectedPath={selectedPath} selectPath={selectPath} />;
	}
	if (resource.key === 'zoneList') {
		return <ZoneListViewportShim data={data} selectedPath={selectedPath} selectPath={selectPath} />;
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
	if (resource.key === 'texture') {
		// 2D preview: the schema's root is just the ParsedTextureHeader, but
		// TextureViewport pulls decoded RGBA pixels from TextureContext
		// (provided by TexturePage) so the center pane can show the image.
		return <TextureViewport />;
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
	// PVS-cell selections aren't owned by a hull. Fall back to hull 0 so the
	// viewport keeps its existing dim/bright treatment for hull lines.
	const activeHullIndex = selection && !isPvsCellSelection(selection) ? selection.hullIndex : 0;
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

// StreetData runs through the WorldViewport chrome with a NodePath-driven
// overlay (issue #11). The overlay matches `['streets'|'junctions'|'roads', i]`
// directly; in-scene edits flow through `onChange` to setAtPath([], next).
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

	return (
		<WorldViewport>
			<StreetDataOverlay
				data={streetData}
				selectedPath={selectedPath}
				onSelect={selectPath}
				onChange={(next) => setAtPath([], next)}
			/>
		</WorldViewport>
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

// AISections runs through the WorldViewport chrome with a NodePath-driven
// overlay (issue #12). The overlay matches the four AI section path shapes
// directly; in-scene drag edits flow through `onChange` to setAtPath([], next).
function AISectionsViewportShim({
	data,
	selectedPath,
	selectPath,
}: {
	data: unknown;
	selectedPath: NodePath;
	selectPath: (path: NodePath) => void;
}) {
	const { setAtPath } = useSchemaEditor();
	const aiData = data as ParsedAISections;

	return (
		<WorldViewport>
			<AISectionsOverlay
				data={aiData}
				selectedPath={selectedPath}
				onSelect={selectPath}
				onChange={(next) => setAtPath([], next)}
			/>
		</WorldViewport>
	);
}

// ZoneList is the WorldViewport pilot: chrome owns the Canvas + camera +
// lighting, the overlay speaks NodePath directly. No path↔selection
// translation needed — the overlay matches `['zones', i]` shapes itself.
function ZoneListViewportShim({
	data,
	selectedPath,
	selectPath,
}: {
	data: unknown;
	selectedPath: NodePath;
	selectPath: (path: NodePath) => void;
}) {
	const zoneData = data as ParsedZoneList;

	return (
		<WorldViewport>
			<ZoneListOverlay
				data={zoneData}
				selectedPath={selectedPath}
				onSelect={selectPath}
			/>
		</WorldViewport>
	);
}

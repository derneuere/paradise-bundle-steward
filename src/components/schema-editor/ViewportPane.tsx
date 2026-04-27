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
import { TextureViewport } from './viewports/TextureViewport';
import type { ParsedAISections } from '@/lib/core/aiSections';
import {
	AISectionsViewport,
	type AISectionSelection,
} from '@/components/aisections/AISectionsViewport';
import type { ParsedZoneList } from '@/lib/core/zoneList';
import {
	ZoneListViewport,
	type ZoneSelection,
} from '@/components/zonelist/ZoneListViewport';

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
// Path ↔ AISectionSelection translation
// ---------------------------------------------------------------------------
//
// Recognized shapes:
//   ["sections", i]                                         → { sectionIndex: i }
//   ["sections", i, "portals", p]                           → { ..., sub: portal }
//   ["sections", i, "portals", p, "boundaryLines", l]       → { ..., sub: boundaryLine }
//   ["sections", i, "noGoLines", l]                         → { ..., sub: noGoLine }
function pathToAISelection(path: NodePath): AISectionSelection {
	if (path.length < 2 || path[0] !== 'sections') return null;
	const sectionIndex = path[1];
	if (typeof sectionIndex !== 'number') return null;
	if (path.length === 2) return { sectionIndex };
	const list = path[2];
	if (list === 'portals' && typeof path[3] === 'number') {
		const portalIndex = path[3] as number;
		if (path.length === 4) {
			return { sectionIndex, sub: { type: 'portal', portalIndex } };
		}
		if (path[4] === 'boundaryLines' && typeof path[5] === 'number') {
			return {
				sectionIndex,
				sub: { type: 'boundaryLine', portalIndex, lineIndex: path[5] as number },
			};
		}
		return { sectionIndex, sub: { type: 'portal', portalIndex } };
	}
	if (list === 'noGoLines' && typeof path[3] === 'number') {
		return { sectionIndex, sub: { type: 'noGoLine', lineIndex: path[3] as number } };
	}
	return { sectionIndex };
}

function aiSelectionToPath(sel: AISectionSelection): NodePath {
	if (!sel) return [];
	const base: NodePath = ['sections', sel.sectionIndex];
	if (!sel.sub) return base;
	switch (sel.sub.type) {
		case 'portal':
			return sel.sub.portalIndex != null ? [...base, 'portals', sel.sub.portalIndex] : base;
		case 'boundaryLine':
			if (sel.sub.portalIndex != null && sel.sub.lineIndex != null) {
				return [...base, 'portals', sel.sub.portalIndex, 'boundaryLines', sel.sub.lineIndex];
			}
			return base;
		case 'noGoLine':
			return sel.sub.lineIndex != null ? [...base, 'noGoLines', sel.sub.lineIndex] : base;
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

// AISections viewport shim. The existing AISectionsViewport was written
// around a `{ sectionIndex, sub }` selection shape — we translate that to
// and from schema paths so clicking a section in the 3D viewport drives the
// hierarchy tree and vice versa.
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
	const selection = useMemo(() => pathToAISelection(selectedPath), [selectedPath]);

	return (
		<div className="h-full">
			<AISectionsViewport
				data={aiData}
				// The 3D viewport exposes an onChange for future in-scene edits
				// (e.g. dragging a portal). Route it through the schema editor's
				// root setter so the mutation participates in structural sharing.
				onChange={(next) => setAtPath([], next)}
				selected={selection}
				onSelect={(sel) => selectPath(aiSelectionToPath(sel))}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Path ↔ ZoneSelection translation
// ---------------------------------------------------------------------------

// Recognised paths:
//   ['zones', i]                                     → { zoneIndex: i }
//   ['zones', i, ...sub]                             → { zoneIndex: i }
//                                                       (sub-selection inside
//                                                       a zone is meaningful
//                                                       to the inspector but
//                                                       collapses to "select
//                                                       this zone" in the
//                                                       viewport)
function pathToZoneSelection(path: NodePath): ZoneSelection {
	if (path.length < 2 || path[0] !== 'zones') return null;
	const idx = path[1];
	if (typeof idx !== 'number') return null;
	return { zoneIndex: idx };
}

function zoneSelectionToPath(sel: ZoneSelection): NodePath {
	if (!sel) return [];
	return ['zones', sel.zoneIndex];
}

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
	const selection = useMemo(() => pathToZoneSelection(selectedPath), [selectedPath]);

	return (
		<div className="h-full">
			<ZoneListViewport
				data={zoneData}
				selected={selection}
				onSelect={(sel) => selectPath(zoneSelectionToPath(sel))}
			/>
		</div>
	);
}

// Center pane — hosts the resource's 3D viewport.
//
// Phase B only knows how to render TrafficData, because that's our only
// resource schema so far. The shim translates between the schema editor's
// path-based selection and the TrafficDataViewport's older {hullIndex, sub}
// model so we can reuse 700 lines of viewport code without porting it.

import { useMemo } from 'react';
import type { ParsedTrafficData } from '@/lib/core/trafficData';
import { TrafficDataViewport } from '@/components/trafficdata/TrafficDataViewport';
import type { TrafficDataSelection } from '@/components/trafficdata/useTrafficSelection';
import { useSchemaEditor } from './context';
import type { NodePath } from '@/lib/schema/walk';
import { PolygonSoupListViewport } from './viewports/PolygonSoupListViewport';

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
// Component
// ---------------------------------------------------------------------------

export function ViewportPane() {
	const { resource, data, selectedPath, selectPath } = useSchemaEditor();

	if (resource.key === 'trafficData') {
		return <TrafficDataViewportShim data={data} selectedPath={selectedPath} selectPath={selectPath} />;
	}
	if (resource.key === 'polygonSoupList') {
		return <PolygonSoupListViewport />;
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

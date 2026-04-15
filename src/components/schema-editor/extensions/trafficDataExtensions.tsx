// Phase C — adapters that wrap the existing Phase 1/2 TrafficData tabs as
// schema-editor extensions. Each adapter translates between:
//   - the schema editor's `(path, value, setValue, setData, data, resource)`
//     extension contract, and
//   - the tabs' original `(data, hullIndex?, onChange, selection?, ...)` props.
//
// This is how we reuse ~1500 lines of Phase 1/2 UI code without rewriting
// anything. The schema stays the source of truth for navigation + simple
// fields; the tabs remain the source of truth for complex list editors
// where the default form would be a regression.

import React, { useMemo, useRef } from 'react';
import type { SchemaExtensionProps, ExtensionRegistry } from '../context';
import type { ParsedTrafficData } from '@/lib/core/trafficData';
import type { TrafficDataSelection } from '@/components/trafficdata/useTrafficSelection';
import { useSchemaEditor } from '../context';
import type { NodePath } from '@/lib/schema/walk';

// Phase 1/2 tab imports.
import { FlowTypesTab } from '@/components/trafficdata/FlowTypesTab';
import { PaintColoursTab } from '@/components/trafficdata/PaintColoursTab';
import { SectionsTab } from '@/components/trafficdata/SectionsTab';
import { LaneRungsTab } from '@/components/trafficdata/LaneRungsTab';
import { JunctionsTab } from '@/components/trafficdata/JunctionsTab';
import { SectionFlowsTab } from '@/components/trafficdata/SectionFlowsTab';
import { StaticVehiclesTab } from '@/components/trafficdata/StaticVehiclesTab';
import { NeighboursTab } from '@/components/trafficdata/NeighboursTab';
import { SectionSpansTab } from '@/components/trafficdata/SectionSpansTab';
import { LightTriggersTab } from '@/components/trafficdata/LightTriggersTab';
// Root-level extension tabs (Part 1 of Phase C migration).
import { OverviewTab } from '@/components/trafficdata/OverviewTab';
import { KillZonesTab } from '@/components/trafficdata/KillZonesTab';
import { VehiclesTab } from '@/components/trafficdata/VehiclesTab';
import { TrafficLightsTab } from '@/components/trafficdata/TrafficLightsTab';

// ---------------------------------------------------------------------------
// Selection shim — convert between schema paths and TrafficDataSelection
// ---------------------------------------------------------------------------

// Same logic as ViewportPane.tsx. Kept local so extensions stay self-
// contained and don't depend on the viewport module.
function pathToSelection(path: NodePath): TrafficDataSelection {
	if (path.length < 2 || path[0] !== 'hulls') return null;
	const hullIndex = path[1];
	if (typeof hullIndex !== 'number') return null;
	if (path.length < 4) return { hullIndex };
	const list = path[2];
	const idx = path[3];
	if (typeof list !== 'string' || typeof idx !== 'number') return { hullIndex };
	switch (list) {
		case 'sections':         return { hullIndex, sub: { type: 'section', index: idx } };
		case 'rungs':            return { hullIndex, sub: { type: 'rung', index: idx } };
		case 'junctions':        return { hullIndex, sub: { type: 'junction', index: idx } };
		case 'lightTriggers':    return { hullIndex, sub: { type: 'lightTrigger', index: idx } };
		case 'staticTrafficVehicles': return { hullIndex, sub: { type: 'staticVehicle', index: idx } };
		default:                 return { hullIndex };
	}
}

function selectionToPath(sel: TrafficDataSelection): NodePath {
	if (!sel) return [];
	const base: NodePath = ['hulls', sel.hullIndex];
	if (!sel.sub) return base;
	switch (sel.sub.type) {
		case 'section':       return [...base, 'sections', sel.sub.index];
		case 'rung':          return [...base, 'rungs', sel.sub.index];
		case 'junction':      return [...base, 'junctions', sel.sub.index];
		case 'lightTrigger':  return [...base, 'lightTriggers', sel.sub.index];
		case 'staticVehicle': return [...base, 'staticTrafficVehicles', sel.sub.index];
	}
}

// Hook that bridges the schema editor's selection state to the
// TrafficDataSelection shape Phase 1/2 tabs expect. `scrollToIndexRef` is
// returned as a throwaway; tabs write to it after add/detail-click but
// nothing in adapter mode reads it back.
function useTabSelectionBridge() {
	const { selectedPath, selectPath } = useSchemaEditor();
	const selected = useMemo(() => pathToSelection(selectedPath), [selectedPath]);
	const onSelect = (sel: TrafficDataSelection) => selectPath(selectionToPath(sel));
	const scrollToIndexRef = useRef<((index: number) => void) | null>(null);
	return { selected, onSelect, scrollToIndexRef };
}

// ---------------------------------------------------------------------------
// Root-level adapters — tab owns full ParsedTrafficData
// ---------------------------------------------------------------------------

// Pattern: the tab takes `data + onChange(data)`. Extension owns a specific
// list path. We pass `setData` through as `onChange` so the tab can edit
// whichever fields of the root it wants; Phase 1/2 tabs only ever edit
// their own list, so behavior is identical to the pre-schema editor.

export const FlowTypesExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => (
	<FlowTypesTab
		data={data as ParsedTrafficData}
		onChange={setData as (next: ParsedTrafficData) => void}
	/>
);

export const PaintColoursExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => (
	<PaintColoursTab
		data={data as ParsedTrafficData}
		onChange={setData as (next: ParsedTrafficData) => void}
	/>
);

// Overview — the tab has an onHullClick callback that the classic editor
// used to switch active hull. In the schema editor we route it through the
// tree selection so clicking a hull in the summary jumps to that hull node.
export const OverviewExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => {
	const { selectPath } = useSchemaEditor();
	return (
		<OverviewTab
			data={data as ParsedTrafficData}
			onChange={setData as (next: ParsedTrafficData) => void}
			onHullClick={(i) => selectPath(['hulls', i])}
		/>
	);
};

export const KillZonesExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => (
	<KillZonesTab
		data={data as ParsedTrafficData}
		onChange={setData as (next: ParsedTrafficData) => void}
	/>
);

export const VehiclesExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => (
	<VehiclesTab
		data={data as ParsedTrafficData}
		onChange={setData as (next: ParsedTrafficData) => void}
	/>
);

export const TrafficLightsExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => (
	<TrafficLightsTab
		data={data as ParsedTrafficData}
		onChange={setData as (next: ParsedTrafficData) => void}
	/>
);

// ---------------------------------------------------------------------------
// Per-hull adapters — path is ['hulls', N, '<field>']
// ---------------------------------------------------------------------------

// Helper: extract hullIndex from an extension path. All hull-level
// extensions are registered on a specific hulls[N].<field> list, so
// path[1] is guaranteed to be the hull index.
function hullIndexFromPath(path: NodePath): number {
	const idx = path[1];
	if (typeof idx !== 'number') {
		throw new Error(`hull-level extension expected path[1] to be a number, got ${typeof idx}`);
	}
	return idx;
}

export const SectionsExtension: React.FC<SchemaExtensionProps> = ({ path, data, setData }) => {
	const hullIndex = hullIndexFromPath(path);
	const { selected, onSelect, scrollToIndexRef } = useTabSelectionBridge();
	return (
		<SectionsTab
			data={data as ParsedTrafficData}
			hullIndex={hullIndex}
			onChange={setData as (next: ParsedTrafficData) => void}
			selected={selected}
			onSelect={onSelect}
			scrollToIndexRef={scrollToIndexRef}
		/>
	);
};

export const LaneRungsExtension: React.FC<SchemaExtensionProps> = ({ path, data, setData }) => {
	const hullIndex = hullIndexFromPath(path);
	const { scrollToIndexRef } = useTabSelectionBridge();
	return (
		<LaneRungsTab
			data={data as ParsedTrafficData}
			hullIndex={hullIndex}
			onChange={setData as (next: ParsedTrafficData) => void}
			scrollToIndexRef={scrollToIndexRef}
		/>
	);
};

export const JunctionsExtension: React.FC<SchemaExtensionProps> = ({ path, data, setData }) => {
	const hullIndex = hullIndexFromPath(path);
	const { selected, onSelect, scrollToIndexRef } = useTabSelectionBridge();
	return (
		<JunctionsTab
			data={data as ParsedTrafficData}
			hullIndex={hullIndex}
			onChange={setData as (next: ParsedTrafficData) => void}
			selected={selected}
			onSelect={onSelect}
			scrollToIndexRef={scrollToIndexRef}
		/>
	);
};

export const SectionFlowsExtension: React.FC<SchemaExtensionProps> = ({ path, data, setData }) => {
	const hullIndex = hullIndexFromPath(path);
	return (
		<SectionFlowsTab
			data={data as ParsedTrafficData}
			hullIndex={hullIndex}
			onChange={setData as (next: ParsedTrafficData) => void}
		/>
	);
};

export const StaticVehiclesExtension: React.FC<SchemaExtensionProps> = ({ path, data, setData }) => {
	const hullIndex = hullIndexFromPath(path);
	const { selected, onSelect, scrollToIndexRef } = useTabSelectionBridge();
	return (
		<StaticVehiclesTab
			data={data as ParsedTrafficData}
			hullIndex={hullIndex}
			onChange={setData as (next: ParsedTrafficData) => void}
			selected={selected}
			onSelect={onSelect}
			scrollToIndexRef={scrollToIndexRef}
		/>
	);
};

export const NeighboursExtension: React.FC<SchemaExtensionProps> = ({ path, data, setData }) => {
	const hullIndex = hullIndexFromPath(path);
	return (
		<NeighboursTab
			data={data as ParsedTrafficData}
			hullIndex={hullIndex}
			onChange={setData as (next: ParsedTrafficData) => void}
		/>
	);
};

export const SectionSpansExtension: React.FC<SchemaExtensionProps> = ({ path, data, setData }) => {
	const hullIndex = hullIndexFromPath(path);
	return (
		<SectionSpansTab
			data={data as ParsedTrafficData}
			hullIndex={hullIndex}
			onChange={setData as (next: ParsedTrafficData) => void}
		/>
	);
};

export const LightTriggersExtension: React.FC<SchemaExtensionProps> = ({ path, data, setData }) => {
	const hullIndex = hullIndexFromPath(path);
	const { selected, onSelect, scrollToIndexRef } = useTabSelectionBridge();
	return (
		<LightTriggersTab
			data={data as ParsedTrafficData}
			hullIndex={hullIndex}
			onChange={setData as (next: ParsedTrafficData) => void}
			selected={selected}
			onSelect={onSelect}
			scrollToIndexRef={scrollToIndexRef}
		/>
	);
};

// ---------------------------------------------------------------------------
// Registry bundle — hand this map to SchemaEditorProvider.
// ---------------------------------------------------------------------------

export const trafficDataExtensions: ExtensionRegistry = {
	FlowTypesTab: FlowTypesExtension,
	PaintColoursTab: PaintColoursExtension,
	SectionsTab: SectionsExtension,
	LaneRungsTab: LaneRungsExtension,
	JunctionsTab: JunctionsExtension,
	SectionFlowsTab: SectionFlowsExtension,
	StaticVehiclesTab: StaticVehiclesExtension,
	NeighboursTab: NeighboursExtension,
	SectionSpansTab: SectionSpansExtension,
	LightTriggersTab: LightTriggersExtension,
	// Root-level propertyGroup extensions.
	OverviewTab: OverviewExtension,
	KillZonesTab: KillZonesExtension,
	VehiclesTab: VehiclesExtension,
	TrafficLightsTab: TrafficLightsExtension,
};

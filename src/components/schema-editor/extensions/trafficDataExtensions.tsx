// Adapters that wrap Phase 1/2 TrafficData tabs as schema-editor extensions.
// Each adapter translates between:
//   - the schema editor's `(path, value, setValue, setData, data, resource)`
//     extension contract, and
//   - the tabs' original `(data, hullIndex?, onChange, selection?, ...)` props.
//
// We only keep extensions that offer something the default schema-driven
// form genuinely can't:
//   - virtualization for lists with thousands of items (Sections, LaneRungs)
//   - paired-array coupling the schema can't express on its own (KillZones,
//     Vehicles, TrafficLights)
//   - aggregate views the schema can't synthesize (Overview, FlowTypes refs)
//   - visualization-heavy UI (PaintColours swatches, FlowTypes cards)
//
// Extensions for Junctions, SectionFlows, StaticVehicles, Neighbours,
// SectionSpans, and LightTriggers were removed in favor of the default form
// because they were pure re-skins of what the generic renderer produces.
// SectionSpans specifically was replaced by a schema-level `derive` hook on
// TrafficSectionSpan that re-computes mfMaxVehicleRecip from muMaxVehicles
// at mutation time.

import React, { useRef } from 'react';
import type { SchemaExtensionProps, ExtensionRegistry } from '../context';
import type { ParsedTrafficData } from '@/lib/core/trafficData';
import type { TrafficDataSelection } from '@/components/trafficdata/useTrafficSelection';
import { useSchemaEditor } from '../context';
import type { NodePath } from '@/lib/schema/walk';

// Kept tabs — these still carry weight.
import { FlowTypesTab } from '@/components/trafficdata/FlowTypesTab';
import { PaintColoursTab } from '@/components/trafficdata/PaintColoursTab';
import { SectionsTab } from '@/components/trafficdata/SectionsTab';
import { LaneRungsTab } from '@/components/trafficdata/LaneRungsTab';
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

function useTabSelectionBridge() {
	const { selectedPath, selectPath } = useSchemaEditor();
	const selected = React.useMemo(() => pathToSelection(selectedPath), [selectedPath]);
	const onSelect = (sel: TrafficDataSelection) => selectPath(selectionToPath(sel));
	const scrollToIndexRef = useRef<((index: number) => void) | null>(null);
	return { selected, onSelect, scrollToIndexRef };
}

// ---------------------------------------------------------------------------
// Root-level adapters — tab owns full ParsedTrafficData
// ---------------------------------------------------------------------------

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

// Overview — onHullClick routes through the schema editor's tree selection
// so clicking a hull in the summary jumps to that hull node.
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

// ---------------------------------------------------------------------------
// Registry bundle — hand this map to SchemaEditorProvider.
// ---------------------------------------------------------------------------

export const trafficDataExtensions: ExtensionRegistry = {
	// Per-hull lists worth specializing.
	SectionsTab: SectionsExtension,
	LaneRungsTab: LaneRungsExtension,
	// Root-level aggregate / paired-array / visualization tabs.
	FlowTypesTab: FlowTypesExtension,
	PaintColoursTab: PaintColoursExtension,
	OverviewTab: OverviewExtension,
	KillZonesTab: KillZonesExtension,
	VehiclesTab: VehiclesExtension,
	TrafficLightsTab: TrafficLightsExtension,
};

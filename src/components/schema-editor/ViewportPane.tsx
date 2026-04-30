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
import { TrafficDataOverlay } from './viewports/TrafficDataOverlay';
import type { ParsedStreetData } from '@/lib/core/streetData';
import { StreetDataOverlay } from './viewports/StreetDataOverlay';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import { TriggerDataOverlay } from './viewports/TriggerDataOverlay';
import { useSchemaEditor } from './context';
import type { NodePath } from '@/lib/schema/walk';
import type { ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';
import { PolygonSoupListOverlay } from './viewports/PolygonSoupListOverlay';
import { RenderableViewport } from './viewports/RenderableViewport';
import { TextureViewport } from './viewports/TextureViewport';
import type { ParsedAISections } from '@/lib/core/aiSections';
import { AISectionsOverlay } from './viewports/AISectionsOverlay';
import type { ParsedZoneList } from '@/lib/core/zoneList';
import { WorldViewport } from './viewports/WorldViewport';
import { ZoneListOverlay } from './viewports/ZoneListOverlay';

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
		return <PolygonSoupListViewportShim data={data} selectedPath={selectedPath} selectPath={selectPath} />;
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

// TrafficData runs through the WorldViewport chrome (issue #13). The
// overlay matches all selection paths directly — including the PVS-cell
// `['pvs', 'hullPvsSets', N]` shape — and derives `activeTab` /
// `activeHullIndex` internally. ViewportPane stays path-only.
function TrafficDataViewportShim({
	data,
	selectedPath,
	selectPath,
}: {
	data: unknown;
	selectedPath: NodePath;
	selectPath: (path: NodePath) => void;
}) {
	const { setAtPath } = useSchemaEditor();
	const trafficData = data as ParsedTrafficData;

	return (
		<WorldViewport>
			<TrafficDataOverlay
				data={trafficData}
				selectedPath={selectedPath}
				onSelect={selectPath}
				onChange={(next) => setAtPath([], next)}
			/>
		</WorldViewport>
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

// TriggerData runs through the WorldViewport chrome (issue #14). The
// overlay matches all eight path shapes directly, including the two
// player-start singletons. The viewport is read-only today but `onChange`
// is wired for future in-scene edits.
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

	return (
		<WorldViewport>
			<TriggerDataOverlay
				data={triggerData}
				selectedPath={selectedPath}
				onSelect={selectPath}
				onChange={(next) => setAtPath([], next)}
			/>
		</WorldViewport>
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

// PolygonSoupList runs through the WorldViewport chrome (issue #15). The
// overlay matches `['soups', S, 'polygons', P]` paths directly. The
// multi-resource state (all models + visibility + click routing across
// resources) comes from PolygonSoupListContext provided by
// PolygonSoupListPage — see the HITL comment on issue #15 for the
// page-level picker rationale.
function PolygonSoupListViewportShim({
	data,
	selectedPath,
	selectPath,
}: {
	data: unknown;
	selectedPath: NodePath;
	selectPath: (path: NodePath) => void;
}) {
	const { setAtPath } = useSchemaEditor();
	const pslData = data as ParsedPolygonSoupList;

	return (
		<WorldViewport>
			<PolygonSoupListOverlay
				data={pslData}
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

// WorldViewportComposition — issue #18 entry point.
//
// The single <WorldViewport> host that the WorkspacePage's centre pane
// renders. Walks every loaded EditableBundle, mounts the matching overlay
// for each World-viewport-family resource (one per single-instance
// resource, one per instance for multi-instance types), and keeps every
// overlay rendering simultaneously. Two Bundles loaded → AI sections
// from one and polygon soups from the other show up in the same scene.
//
// What this owns:
//   - The single <WorldViewport> chrome (Canvas + camera + lighting).
//   - The per-overlay React-prop wiring: `data` from the right Bundle's
//     parsed-resource map (ADR-0002), `selectedPath` derived from the
//     Workspace Selection (`selection.path` only when this overlay's
//     `(bundleId, resourceKey, index)` matches; `[]` otherwise).
//   - The cross-Bundle `onSelect` wrapper that injects `bundleId` before
//     forwarding to `select()`. Overlays still emit bare NodePath
//     (ADR-0001) — this layer translates between schema-path-land and
//     Workspace-Selection-land.
//   - The `onChange` wrapper that funnels in-scene edits to
//     `setResourceAt(bundleId, key, index, next)`.
//
// Issue #19 (Visibility cascade): the inner component drops every overlay
// whose `(bundleId, resourceKey, index)` reads as hidden via the
// Workspace's `isVisible`. Toggling a Bundle off makes every descendant
// disappear from the scene; toggling it back on restores any prior per-
// instance toggles (the cascade is one-way — see `isVisibleIn` in the
// helpers module).
//
// What this DOESN'T own:
//   - Mounting / dismounting the WorldViewport on Selection change. As
//     long as both selections are world-family the chrome stays mounted —
//     CenterViewport is the gate that swaps in renderable / texture
//     viewports for those non-world-coord resource types (those WILL
//     remount, since they're not WorldViewport's at all).
//   - Selection. Hiding a selected resource does NOT clear the Selection
//     (CONTEXT.md / "Selection") — the inspector keeps showing its Tools,
//     the overlay just stops contributing to the scene.
//   - PolygonSoupList Workspace-awareness. The overlay still reads
//     `useFirstLoadedBundle()` internally (ADR-0004) — multi-Bundle
//     PolygonSoupList rendering is deferred and tracked separately.

import { useCallback, useMemo } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { WorldViewport } from '@/components/schema-editor/viewports/WorldViewport';
import { AISectionsOverlay } from '@/components/schema-editor/viewports/AISectionsOverlay';
import { StreetDataOverlay } from '@/components/schema-editor/viewports/StreetDataOverlay';
import { TrafficDataOverlay } from '@/components/schema-editor/viewports/TrafficDataOverlay';
import { TriggerDataOverlay } from '@/components/schema-editor/viewports/TriggerDataOverlay';
import { ZoneListOverlay } from '@/components/schema-editor/viewports/ZoneListOverlay';
import { PolygonSoupListOverlay } from '@/components/schema-editor/viewports/PolygonSoupListOverlay';
import type { ParsedAISections } from '@/lib/core/aiSections';
import type { ParsedStreetData } from '@/lib/core/streetData';
import type { ParsedTrafficData } from '@/lib/core/trafficData';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import type { ParsedZoneList } from '@/lib/core/zoneList';
import type { ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';
import type { NodePath } from '@/lib/schema/walk';
import type { WorkspaceContextValue } from '@/context/WorkspaceContext.types';
import {
	filterOverlaysByVisibility,
	listWorldOverlays,
	selectedPathFor,
	type OverlayDescriptor,
	type WorldViewportFamilyKey,
} from './WorldViewportComposition.helpers';

// ---------------------------------------------------------------------------
// Per-key overlay rendering
// ---------------------------------------------------------------------------

type OverlayBindings = {
	descriptor: OverlayDescriptor;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
	onChange: (next: unknown) => void;
};

function renderOverlay({ descriptor, selectedPath, onSelect, onChange }: OverlayBindings) {
	const key = `${descriptor.bundleId}::${descriptor.resourceKey}::${descriptor.index}`;
	switch (descriptor.resourceKey) {
		case 'aiSections':
			return (
				<AISectionsOverlay
					key={key}
					data={descriptor.model as ParsedAISections}
					selectedPath={selectedPath}
					onSelect={onSelect}
					onChange={onChange as (next: ParsedAISections) => void}
				/>
			);
		case 'streetData':
			return (
				<StreetDataOverlay
					key={key}
					data={descriptor.model as ParsedStreetData}
					selectedPath={selectedPath}
					onSelect={onSelect}
					onChange={onChange as (next: ParsedStreetData) => void}
				/>
			);
		case 'trafficData':
			return (
				<TrafficDataOverlay
					key={key}
					data={descriptor.model as ParsedTrafficData}
					selectedPath={selectedPath}
					onSelect={onSelect}
					onChange={onChange as (next: ParsedTrafficData) => void}
				/>
			);
		case 'triggerData':
			return (
				<TriggerDataOverlay
					key={key}
					data={descriptor.model as ParsedTriggerData}
					selectedPath={selectedPath}
					onSelect={onSelect}
					onChange={onChange as (next: ParsedTriggerData) => void}
				/>
			);
		case 'zoneList':
			return (
				<ZoneListOverlay
					key={key}
					data={descriptor.model as ParsedZoneList}
					selectedPath={selectedPath}
					onSelect={onSelect}
				/>
			);
		case 'polygonSoupList':
			// PolygonSoupList still reads `useFirstLoadedBundle()` internally
			// (ADR-0004) — until that's Workspace-aware (out of scope, per
			// issue #18) only bundles[0]'s polygon soups will actually
			// render data, regardless of how many descriptors we mount.
			// Mounting it once per Bundle anyway keeps the overlay
			// participating in the composition for the day the deeper
			// refactor lands.
			return (
				<PolygonSoupListOverlay
					key={key}
					data={descriptor.model as ParsedPolygonSoupList}
					selectedPath={selectedPath}
					onSelect={onSelect}
					onChange={onChange as (next: ParsedPolygonSoupList) => void}
				/>
			);
		default: {
			// Exhaustiveness check — adding a new family key without a render
			// branch above is a compile-time error (the assignment to
			// `_exhaustive: never` fails) so the composition can never silently
			// drop a registered overlay type.
			const _exhaustive: never = descriptor.resourceKey;
			void _exhaustive;
			return null;
		}
	}
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Inner-component layer used by both `WorldViewportComposition` and the test
 * harness. Pure in `bundles` / `selection` / the two callbacks — no dialog
 * machinery, no companion-bundle plumbing — so it composes cleanly with a
 * stub workspace value if a future test wants to mount the chrome.
 */
export function WorldViewportCompositionInner({
	bundles,
	selection,
	select,
	setResourceAt,
	isVisible,
}: {
	bundles: WorkspaceContextValue['bundles'];
	selection: WorkspaceContextValue['selection'];
	select: WorkspaceContextValue['select'];
	setResourceAt: WorkspaceContextValue['setResourceAt'];
	isVisible: WorkspaceContextValue['isVisible'];
}) {
	const overlays = useMemo(
		() => filterOverlaysByVisibility(listWorldOverlays(bundles), isVisible),
		[bundles, isVisible],
	);

	// Stable per-(bundleId, key, index) callback factories. We can't memoise
	// each one with useCallback (the descriptor list is dynamic), but a
	// single useCallback over the closure-captured Workspace methods means
	// every overlay re-renders only when the descriptor list itself moves.
	const makeOnSelect = useCallback(
		(d: OverlayDescriptor) => (path: NodePath) => {
			select({
				bundleId: d.bundleId,
				resourceKey: d.resourceKey,
				index: d.index,
				path,
			});
		},
		[select],
	);

	const makeOnChange = useCallback(
		(d: OverlayDescriptor) => (next: unknown) => {
			setResourceAt(d.bundleId, d.resourceKey, d.index, next);
		},
		[setResourceAt],
	);

	const children = useMemo(
		() =>
			overlays.map((descriptor) =>
				renderOverlay({
					descriptor,
					selectedPath: selectedPathFor(selection, descriptor),
					onSelect: makeOnSelect(descriptor),
					onChange: makeOnChange(descriptor),
				}),
			),
		[overlays, selection, makeOnSelect, makeOnChange],
	);

	return <WorldViewport>{children}</WorldViewport>;
}

/**
 * Top-level wrapper that wires the inner component to the Workspace context.
 * Mount this from `WorkspacePage` — it owns nothing of its own beyond the
 * hook lookup so the composition stays straightforward to reason about.
 */
export function WorldViewportComposition() {
	const { bundles, selection, select, setResourceAt, isVisible } = useWorkspace();
	return (
		<WorldViewportCompositionInner
			bundles={bundles}
			selection={selection}
			select={select}
			setResourceAt={setResourceAt}
			isVisible={isVisible}
		/>
	);
}

// Re-export the family typing so consumers (CenterViewport's branch) can
// reuse the same membership predicate without duplicating the key list.
export {
	WORLD_VIEWPORT_FAMILY_KEYS,
	isWorldViewportFamilyKey,
	type WorldViewportFamilyKey,
} from './WorldViewportComposition.helpers';

export default WorldViewportComposition;

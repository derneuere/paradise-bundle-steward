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
// PolygonSoupList: the overlay renders the *union* of every PSL instance in
// its Bundle as one batched mesh, but it no longer reads the workspace to
// find those siblings — the composition hands them down via the
// `bundleSoups` prop (sourced from `descriptor.bundleSiblings`). This closes
// the multi-Bundle leak from ADR-0004's original single-Bundle deviation
// (issue #23): a PSL instance in `bundles[1]` now batches its own Bundle's
// soups, not whatever `bundles[0]` happened to be.
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

import { useCallback, useMemo } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { WorldViewport } from '@/components/schema-editor/viewports/WorldViewport';
import { TrackGeometry } from '@/components/schema-editor/viewports/TrackGeometry';
import { PropGeometry } from '@/components/schema-editor/viewports/PropGeometry';
import { PropCellGridOverlay } from '@/components/schema-editor/viewports/PropCellGridOverlay';
import { PropTransformOverlay } from '@/components/schema-editor/viewports/PropTransformOverlay';
import { PolygonSoupListOverlay } from '@/components/schema-editor/viewports/PolygonSoupListOverlay';
import { INSTANCE_LIST_TYPE_ID } from '@/lib/core/instanceList';
import { PROP_GRAPHICS_LIST_TYPE_ID } from '@/lib/core/propGraphicsList';
import { pickRenderBinding } from '@/lib/editor/bindings';
import type { ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';
import type { ParsedPropInstanceData } from '@/lib/core/propInstanceData';
import type { NodePath } from '@/lib/schema/walk';

const EMPTY_PATH: NodePath = [];
import type { WorkspaceContextValue } from '@/context/WorkspaceContext.types';
import {
	dedupePolygonSoupOverlays,
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
	/** True when this descriptor's `(bundleId, resourceKey, index)` is the
	 *  current Workspace selection — gates the overlay's HTML-slot tools so
	 *  inactive sibling overlays don't stack their box-select / snap toggles
	 *  on top of the active one (issue #24 follow-up). */
	isActive: boolean;
	/** PSL-only — the selected instance index inside this Bundle, propagated
	 *  from the workspace selection. The lead PSL overlay needs this to
	 *  highlight the right slice of the batched union even when the user
	 *  selected a non-lead instance. Ignored for other overlay types. */
	activeSoupIndex?: number;
	/** PSL-only — 3D-pick callback that routes the clicked instance index
	 *  (which may differ from the lead's own index after dedupe) through
	 *  `select(...)`. Ignored for other overlay types. */
	onPickInstancePoly?: (
		modelIndex: number,
		soupIndex: number,
		polyIndex: number,
	) => void;
};

function renderOverlay({ descriptor, selectedPath, onSelect, onChange, isActive, activeSoupIndex, onPickInstancePoly }: OverlayBindings) {
	const key = `${descriptor.bundleId}::${descriptor.resourceKey}::${descriptor.index}`;

	// PolygonSoupList renders the *union* of every PSL instance in its
	// Bundle as one batched mesh. The composition supplies that union
	// via `bundleSoups` (ADR-0004 multi-Bundle resolution) so the overlay
	// never has to read the workspace itself — that's the bit that used
	// to leak across Bundles by always reaching for `bundles[0]`. Only
	// ONE PSL overlay is mounted per Bundle (see
	// `dedupePolygonSoupOverlays`); rendering the same N-instance union
	// from N descriptors used to peg the renderer. PSL uses extra props
	// (bundleSoups / activeSoupIndex / onPickInstancePoly) that don't fit
	// the generic WorldOverlayProps shape, so it stays special-cased.
	if (descriptor.resourceKey === 'polygonSoupList') {
		return (
			<PolygonSoupListOverlay
				key={key}
				data={descriptor.model as ParsedPolygonSoupList}
				bundleSoups={descriptor.bundleSiblings as (ParsedPolygonSoupList | null)[]}
				activeSoupIndex={activeSoupIndex}
				onPickInstancePoly={onPickInstancePoly}
				selectedPath={selectedPath}
				onSelect={onSelect}
				onChange={onChange as (next: ParsedPolygonSoupList) => void}
				isActive={isActive}
			/>
		);
	}

	// All other world-family overlays (aiSections / streetData /
	// trafficData / triggerData / zoneList) come straight off the editor
	// profile registered for the resource key — no per-key switch here
	// means new versioned profiles (e.g. AISections V4/V6) automatically
	// participate once their profile lands in the registry (ADR-0008).
	const binding = pickRenderBinding(descriptor.resourceKey, descriptor.model);
	const Overlay = binding?.overlay;
	if (!Overlay) return null;
	return (
		<Overlay
			key={key}
			data={descriptor.model}
			selectedPath={selectedPath}
			onSelect={onSelect}
			onChange={onChange}
			isActive={isActive}
			bundleId={descriptor.bundleId}
			index={descriptor.index}
		/>
	);
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
function WorldViewportCompositionInner({
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
	// Visibility-filter first, then dedupe PSL: keeping the order means
	// per-instance hides still drop their indexes from the lead's
	// bundleSoups (the dedupe step reads the surviving set out of the
	// post-filter list).
	const overlays = useMemo(() => {
		// A bundle with a PropGraphicsList draws its props as real meshes via
		// <PropGeometry> below, which also owns the marker-box fallback + picking.
		// Drop the box-only PropInstanceData overlay for those bundles so props
		// don't double-draw (mesh + box). Bundles with PropInstanceData but no
		// catalogue keep the box overlay.
		const pglBundleIds = new Set(
			bundles
				.filter((b) => b.parsed.resources.some((r) => r.resourceTypeId === PROP_GRAPHICS_LIST_TYPE_ID))
				.map((b) => b.id),
		);
		const list = filterOverlaysByVisibility(listWorldOverlays(bundles), isVisible).filter(
			(d) => !(d.resourceKey === 'propInstanceData' && pglBundleIds.has(d.bundleId)),
		);
		return dedupePolygonSoupOverlays(list);
	}, [bundles, isVisible]);

	// Track-unit backdrop geometry: one <TrackGeometry> per loaded bundle that
	// carries an InstanceList (0x23). Unlike overlays this needs the bundle's
	// raw bytes + import table (not a parsed model), so it's mounted directly
	// rather than going through the overlay-binding path (ADR-0002). Hidden
	// when the bundle is toggled off; the heavy decode is memoized inside
	// TrackGeometry on the bundle identity.
	const trackChildren = useMemo(
		() =>
			bundles
				.filter(
					(b) =>
						isVisible({ bundleId: b.id }) &&
						b.parsed.resources.some((r) => r.resourceTypeId === INSTANCE_LIST_TYPE_ID),
				)
				.map((b) => (
					<TrackGeometry key={`track::${b.id}`} bundle={b.parsed} buffer={b.originalArrayBuffer} />
				)),
		[bundles, isVisible],
	);

	// Every loaded bundle paired with its bytes — prop Models live in companion
	// bundles (GLOBALPROPS.BIN), so each <PropGeometry> resolves across all of
	// them. Memoised on the bundle list so it stays stable across selection.
	const allSources = useMemo(
		() => bundles.map((b) => ({ bundle: b.parsed, buffer: b.originalArrayBuffer })),
		[bundles],
	);

	// Real prop meshes: one <PropGeometry> per bundle that carries BOTH a
	// PropGraphicsList (the type→Model catalogue) and a PropInstanceData (the
	// placements). It joins them and draws the actual prop geometry (with a
	// marker-box fallback for Models that aren't loaded yet), so the props look
	// real instead of grey boxes. Selection routes back to the PropInstanceData
	// instance so clicking a prop still works exactly as before.
	const propChildren = useMemo(
		() =>
			bundles
				.filter(
					(b) =>
						isVisible({ bundleId: b.id }) &&
						isVisible({ bundleId: b.id, resourceKey: 'propInstanceData', index: 0 }) &&
						b.parsed.resources.some((r) => r.resourceTypeId === PROP_GRAPHICS_LIST_TYPE_ID) &&
						(b.parsedResourcesAll.get('propInstanceData')?.[0] ?? null) != null,
				)
				.map((b) => {
					const pid = b.parsedResourcesAll.get('propInstanceData')![0] as ParsedPropInstanceData;
					const externals = allSources.filter((s) => s.bundle !== b.parsed);
					const selectedPath =
						selection?.bundleId === b.id && selection.resourceKey === 'propInstanceData'
							? selection.path
							: EMPTY_PATH;
					return (
						<PropGeometry
							key={`prop::${b.id}`}
							pid={pid}
							bundle={b.parsed}
							buffer={b.originalArrayBuffer}
							externals={externals}
							selectedPath={selectedPath}
							onSelect={(path) =>
								select({ bundleId: b.id, resourceKey: 'propInstanceData', index: 0, path })
							}
						/>
					);
				}),
		[bundles, allSources, isVisible, selection, select],
	);

	// Prop cell grid: one <PropCellGridOverlay> per visible bundle that carries a
	// PropInstanceData (whether or not it also has a PropGraphicsList, so it shows
	// for both the real-mesh and box-fallback prop paths). It superimposes the
	// 100 m streaming grid + cell-id labels so the user can read/verify a prop's
	// cell. Its chrome toggle only registers when propInstanceData is the active
	// selection, so it doesn't fight sibling overlays for the HTML slot.
	const cellGridChildren = useMemo(
		() =>
			bundles
				.filter(
					(b) =>
						isVisible({ bundleId: b.id }) &&
						isVisible({ bundleId: b.id, resourceKey: 'propInstanceData', index: 0 }) &&
						(b.parsedResourcesAll.get('propInstanceData')?.[0] ?? null) != null,
				)
				.map((b) => {
					const pid = b.parsedResourcesAll.get('propInstanceData')![0] as ParsedPropInstanceData;
					const isSelected =
						selection?.bundleId === b.id && selection.resourceKey === 'propInstanceData';
					return (
						<PropCellGridOverlay
							key={`cellgrid::${b.id}`}
							data={pid}
							selectedPath={isSelected ? selection!.path : EMPTY_PATH}
							onSelect={(path) =>
								select({ bundleId: b.id, resourceKey: 'propInstanceData', index: 0, path })
							}
							isActive={isSelected}
						/>
					);
				}),
		[bundles, isVisible, selection, select],
	);

	// Prop transform gizmo + marquee: one <PropTransformOverlay> per visible
	// bundle with a PropInstanceData (box or mesh path alike). It owns the
	// move/rotate gizmo and box-select, editing instance transforms via
	// setResourceAt. Mounted alongside the cell grid (separate concern); its
	// HTML-slot marquee only registers while propInstanceData is the active
	// selection.
	const propTransformChildren = useMemo(
		() =>
			bundles
				.filter(
					(b) =>
						isVisible({ bundleId: b.id }) &&
						isVisible({ bundleId: b.id, resourceKey: 'propInstanceData', index: 0 }) &&
						(b.parsedResourcesAll.get('propInstanceData')?.[0] ?? null) != null,
				)
				.map((b) => {
					const pid = b.parsedResourcesAll.get('propInstanceData')![0] as ParsedPropInstanceData;
					const isSelected =
						selection?.bundleId === b.id && selection.resourceKey === 'propInstanceData';
					return (
						<PropTransformOverlay
							key={`proptransform::${b.id}`}
							data={pid}
							selectedPath={isSelected ? selection!.path : EMPTY_PATH}
							onSelect={(path) =>
								select({ bundleId: b.id, resourceKey: 'propInstanceData', index: 0, path })
							}
							onChange={(next) => setResourceAt(b.id, 'propInstanceData', 0, next)}
							isActive={isSelected}
						/>
					);
				}),
		[bundles, isVisible, selection, select, setResourceAt],
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
			overlays.map((descriptor) => {
				// PSL-specific routing: only one overlay is mounted per Bundle's
				// PSL (the lead). Forward any PSL selection inside that Bundle
				// to the lead so the highlight/outline tracks the user's actual
				// selection instead of just the lead's index.
				const isPSLLead = descriptor.resourceKey === 'polygonSoupList';
				// Only an Instance-level (or deeper) selection focuses a
				// specific PSL instance — Bundle / Resource-type-level selections
				// leave the lead pointing at its own descriptor index.
				const psLeadHasSelection =
					isPSLLead &&
					selection?.bundleId === descriptor.bundleId &&
					selection.resourceKey === 'polygonSoupList' &&
					selection.index !== undefined;
				const selectedPath = psLeadHasSelection
					? selection!.path
					: selectedPathFor(selection, descriptor);
				const activeSoupIndex = psLeadHasSelection ? selection!.index! : descriptor.index;
				// `isActive` gates whether this overlay's HTML-slot tools
				// (marquee, snap toggle, status badge, context menus) register
				// with the chrome. Only the descriptor matching the current
				// instance- or schema-level selection is "active". For PSL,
				// the single lead overlay represents the whole batched union,
				// so any PSL-instance selection in its Bundle activates the
				// lead — `psLeadHasSelection` already captures that.
				const isActive = isPSLLead
					? psLeadHasSelection
					: selection != null &&
						selection.bundleId === descriptor.bundleId &&
						selection.resourceKey === descriptor.resourceKey &&
						selection.index === descriptor.index;
				// 3D-pick handler for PSL: the clicked face's `modelIndex` may
				// differ from the lead descriptor's own index (one lead covers
				// every PSL instance in the Bundle), so we route the pick
				// through `select(...)` with the picked index instead of going
				// through the lead's `onSelect` (which would be locked to the
				// lead's index).
				const onPickInstancePoly = isPSLLead
					? (modelIndex: number, soupIndex: number, polyIndex: number) => {
						select({
							bundleId: descriptor.bundleId,
							resourceKey: 'polygonSoupList',
							index: modelIndex,
							path: ['soups', soupIndex, 'polygons', polyIndex],
						});
					}
					: undefined;
				return renderOverlay({
					descriptor,
					selectedPath,
					onSelect: makeOnSelect(descriptor),
					onChange: makeOnChange(descriptor),
					isActive,
					activeSoupIndex: isPSLLead ? activeSoupIndex : undefined,
					onPickInstancePoly,
				});
			}),
		[overlays, selection, select, makeOnSelect, makeOnChange],
	);

	return (
		<WorldViewport>
			{trackChildren}
			{propChildren}
			{cellGridChildren}
			{propTransformChildren}
			{children}
		</WorldViewport>
	);
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
export { isWorldViewportFamilyKey } from './WorldViewportComposition.helpers';

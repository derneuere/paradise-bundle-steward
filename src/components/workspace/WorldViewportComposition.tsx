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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { WorldViewport } from '@/components/schema-editor/viewports/WorldViewport';
import { AISectionsOverlay } from '@/components/schema-editor/viewports/AISectionsOverlay';
import { StreetDataOverlay } from '@/components/schema-editor/viewports/StreetDataOverlay';
import { TrafficDataOverlay } from '@/components/schema-editor/viewports/TrafficDataOverlay';
import { TriggerDataOverlay } from '@/components/schema-editor/viewports/TriggerDataOverlay';
import { ZoneListOverlay } from '@/components/schema-editor/viewports/ZoneListOverlay';
import { PolygonSoupListOverlay } from '@/components/schema-editor/viewports/PolygonSoupListOverlay';
import {
	PolygonSoupListContext,
	encodeSoupPoly,
	type PolygonSoupListContextValue,
} from '@/components/schema-editor/viewports/polygonSoupListContext';
import type { ParsedAISections } from '@/lib/core/aiSections';
import type { ParsedStreetData } from '@/lib/core/streetData';
import type { ParsedTrafficData } from '@/lib/core/trafficData';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import type { ParsedZoneList } from '@/lib/core/zoneList';
import type { ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';
import type { NodePath } from '@/lib/schema/walk';
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
	switch (descriptor.resourceKey) {
		case 'aiSections':
			return (
				<AISectionsOverlay
					key={key}
					data={descriptor.model as ParsedAISections}
					selectedPath={selectedPath}
					onSelect={onSelect}
					onChange={onChange as (next: ParsedAISections) => void}
					isActive={isActive}
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
					isActive={isActive}
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
					isActive={isActive}
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
			// PolygonSoupList renders the *union* of every PSL instance in its
			// Bundle as one batched mesh. The composition supplies that union
			// via `bundleSoups` (ADR-0004 multi-Bundle resolution) so the
			// overlay never has to read the workspace itself — that's the bit
			// that used to leak across Bundles by always reaching for
			// `bundles[0]`. Only ONE PSL overlay is mounted per Bundle (see
			// `dedupePolygonSoupOverlays`); rendering the same N-instance
			// union from N descriptors used to peg the renderer.
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
	// Visibility-filter first, then dedupe PSL: keeping the order means
	// per-instance hides still drop their indexes from the lead's
	// bundleSoups (the dedupe step reads the surviving set out of the
	// post-filter list).
	const overlays = useMemo(
		() => dedupePolygonSoupOverlays(filterOverlaysByVisibility(listWorldOverlays(bundles), isVisible)),
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
		<PSLBulkProvider
			bundles={bundles}
			selection={selection}
			select={select}
			isVisible={isVisible}
		>
			<WorldViewport>{children}</WorldViewport>
		</PSLBulkProvider>
	);
}

// ---------------------------------------------------------------------------
// PSL bulk-selection provider
// ---------------------------------------------------------------------------
//
// Re-creates the legacy PolygonSoupListPage's box-select / bulk-poly state
// for the unified Workspace. The legacy page owned a `Set<string>` of poly
// path keys plus the `PolygonSoupListContext` callbacks the overlay reads
// to (a) render the marquee selector at all, and (b) highlight bulk polys
// in 3D. None of that survived the move to `WorldViewportComposition`, so
// PSL's box-select went missing once the legacy /polygonsoups route was
// retired.
//
// Bulk state is reset whenever the active `(bundleId, index)` changes — the
// legacy page did the same in `switchResource(...)`. We don't currently
// surface the bulk-edit panel in the workspace; this provider just makes
// the marquee + 3D highlight available so the user can build a selection
// visually. Wiring the bulk-edit UI is a follow-up.

const POLY_PATH_RE = /^soups\/(\d+)\/polygons\/(\d+)$/;

function parsePolyPathKey(key: string): { soup: number; poly: number } | null {
	const m = POLY_PATH_RE.exec(key);
	if (!m) return null;
	return { soup: Number(m[1]), poly: Number(m[2]) };
}

function pathToKey(path: NodePath): string {
	return path.join('/');
}

function selectionPolyAddress(
	selection: WorkspaceContextValue['selection'],
): { soup: number; poly: number } | null {
	if (!selection || selection.path.length < 4) return null;
	if (selection.path[0] !== 'soups' || selection.path[2] !== 'polygons') return null;
	const soup = selection.path[1];
	const poly = selection.path[3];
	if (typeof soup !== 'number' || typeof poly !== 'number') return null;
	return { soup, poly };
}

function PSLBulkProvider({
	bundles,
	selection,
	select,
	isVisible,
	children,
}: {
	bundles: WorkspaceContextValue['bundles'];
	selection: WorkspaceContextValue['selection'];
	select: WorkspaceContextValue['select'];
	isVisible: WorkspaceContextValue['isVisible'];
	children: ReactNode;
}) {
	// Bulk path-keys for the currently-active PSL resource. Reset whenever
	// the user switches to a different `(bundleId, index)` so each instance
	// gets a fresh box-select session — same UX as the legacy page.
	const [bulkPaths, setBulkPaths] = useState<Set<string>>(() => new Set());
	const activeKey =
		selection?.resourceKey === 'polygonSoupList' && selection.index !== undefined
			? `${selection.bundleId}:${selection.index}`
			: null;
	useEffect(() => {
		setBulkPaths(new Set());
	}, [activeKey]);

	const ctxValue = useMemo<PolygonSoupListContextValue | null>(() => {
		if (
			!selection ||
			selection.resourceKey !== 'polygonSoupList' ||
			selection.index === undefined
		) {
			return null;
		}
		const bundle = bundles.find((b) => b.id === selection.bundleId);
		if (!bundle) return null;
		const list = bundle.parsedResourcesAll.get('polygonSoupList') as
			| (ParsedPolygonSoupList | null)[]
			| undefined;
		if (!list) return null;
		const selectedModelIndex = selection.index;

		const visibleSet = new Set<number>();
		for (let i = 0; i < list.length; i++) {
			if (
				isVisible({
					bundleId: selection.bundleId,
					resourceKey: 'polygonSoupList',
					index: i,
				})
			) {
				visibleSet.add(i);
			}
		}

		const selectedPolys = new Set<number>();
		for (const key of bulkPaths) {
			const addr = parsePolyPathKey(key);
			if (addr) selectedPolys.add(encodeSoupPoly(addr.soup, addr.poly));
		}

		const onSelect = (
			modelIndex: number,
			soupIndex: number,
			polyIndex: number,
			modifiers?: { shift?: boolean; ctrl?: boolean },
		) => {
			const targetPath: NodePath = ['soups', soupIndex, 'polygons', polyIndex];
			if (modifiers?.ctrl) {
				// Ctrl/Cmd+click: toggle this polygon in the bulk set without
				// moving the inspector — same semantics as the legacy page.
				if (modelIndex !== selectedModelIndex) return;
				setBulkPaths((prev) => {
					const k = pathToKey(targetPath);
					const next = new Set(prev);
					if (next.has(k)) next.delete(k);
					else next.add(k);
					return next;
				});
				return;
			}
			// Plain / shift click: navigate the inspector to the clicked poly.
			// (Shift-extend across the bulk range needs the schema tree's
			// anchor path, which the workspace's hierarchy doesn't expose
			// here — fall back to plain navigation for now.)
			select({
				bundleId: selection.bundleId,
				resourceKey: 'polygonSoupList',
				index: modelIndex,
				path: targetPath,
			});
		};

		const onMarqueeApply = (
			modelIndex: number,
			polys: ReadonlyArray<{ soup: number; poly: number }>,
			mode: 'add' | 'remove',
		) => {
			if (modelIndex !== selectedModelIndex || polys.length === 0) return;
			setBulkPaths((prev) => {
				const next = new Set(prev);
				for (const { soup, poly } of polys) {
					const k = pathToKey(['soups', soup, 'polygons', poly]);
					if (mode === 'add') next.add(k);
					else next.delete(k);
				}
				return next;
			});
		};

		return {
			models: list,
			selectedModelIndex,
			onSelect,
			selectedPolysInCurrentModel: selectedPolys,
			visibleModelIndexes: visibleSet,
			treeSelectedPoly: selectionPolyAddress(selection),
			onMarqueeApply,
		};
	}, [bundles, selection, select, isVisible, bulkPaths]);

	if (!ctxValue) return <>{children}</>;
	return (
		<PolygonSoupListContext.Provider value={ctxValue}>
			{children}
		</PolygonSoupListContext.Provider>
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
export {
	WORLD_VIEWPORT_FAMILY_KEYS,
	isWorldViewportFamilyKey,
	type WorldViewportFamilyKey,
} from './WorldViewportComposition.helpers';

export default WorldViewportComposition;

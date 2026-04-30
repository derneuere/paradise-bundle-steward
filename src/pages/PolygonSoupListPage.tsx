// Schema-driven editor for PolygonSoupList (resource type 0x43 —
// colloquially "worldcol").
//
// Unlike the single-resource TrafficDataPage, WORLDCOL.BIN has hundreds of
// PolygonSoupList resources — one per track unit. This page shows ALL of
// them in the 3D viewport and lets the user pick which one the schema
// editor (tree + inspector) should operate on. Clicking a face in the
// viewport also switches the active resource and navigates the tree to the
// clicked polygon.
//
// Collection picker:
// When the bundle has >1 PSL resource the HierarchyTree consumes a
// MultiResourcePickerContext provided here, which gives it:
//   - Sort / search / hide-empty controls in its header
//   - One top-level row per resource (with an eye icon to toggle viewport
//     visibility, alt-click to solo)
//   - Click-to-select semantics that swap the inspector to that resource
// Visibility is decoupled from selection: the user can hide the resource
// they're editing, or leave other resources rendered in context.
//
// Bulk edit:
// Ctrl/Cmd+clicking polygon rows in the hierarchy tree toggles them in a
// bulk selection. The "Bulk edit" side panel only appears while that
// selection has at least one polygon, and lets the user rewrite one
// collision-tag field on every selected polygon at once, leaving all
// other fields per-polygon untouched. The 3D viewport mirrors the bulk
// selection as an amber tint so the user can see which polys they're
// editing in context. Switching resources clears the bulk selection.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFirstLoadedBundle, useFirstLoadedBundleId, useWorkspace } from '@/context/WorkspaceContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { SchemaBulkSelectionContext } from '@/components/schema-editor/bulkSelectionContext';
import {
	MultiResourcePickerContext,
	type MultiResourcePickerValue,
	type PickerRow,
} from '@/components/schema-editor/multiResourcePickerContext';
import {
	ShortcutsHelp,
	PICKER_SHORTCUTS,
	SCHEMA_TREE_SHORTCUTS,
	BULK_SHORTCUTS,
	type ShortcutGroup,
} from '@/components/schema-editor/ShortcutsHelp';
import { polygonSoupListResourceSchema } from '@/lib/schema/resources/polygonSoupList';
import { polygonSoupListHandler } from '@/lib/core/registry/handlers/polygonSoupList';
import type { ParsedPolygonSoupList, PolygonSoup, PolygonSoupPoly } from '@/lib/core/polygonSoupList';
import {
	PolygonSoupListContext,
	encodeSoupPoly,
} from '@/components/schema-editor/viewports/polygonSoupListContext';
import {
	polygonSoupListExtensions,
	AISectionPicker,
	FlagCheckbox,
} from '@/components/schema-editor/extensions/collisionTagExtension';
import {
	decodeCollisionTag,
	setAiSectionIndex,
	setSurfaceId,
	setTrafficInfo,
	setFlagFatal,
	setFlagDriveable,
	setFlagSuperfatal,
	trafficInfoLabel,
	SURFACE_ID_MAX,
	TRAFFIC_INFO_MAX,
} from '@/lib/core/collisionTag';
import type { NodePath } from '@/lib/schema/walk';
import type { PickerEntry, PickerResourceCtx } from '@/lib/core/registry/handler';

const PSL_TYPE_ID = 0x43;
const PSL_HANDLER_KEY = 'polygonSoupList';

// Shortcuts surfaced in the page's "Shortcuts" popover. Shared presets cover
// the picker / tree / bulk gestures; the viewport group is PSL-specific
// because only this editor has a 3D scene that raycasts back to a polygon.
const PSL_SHORTCUT_GROUPS: ShortcutGroup[] = [
	PICKER_SHORTCUTS,
	SCHEMA_TREE_SHORTCUTS,
	{
		title: '3D viewport',
		items: [
			{ keys: ['Click', 'polygon'], label: 'Jump the inspector to that polygon (and switch resources if needed)' },
			{ keys: ['Shift', 'Click', 'polygon'], label: 'Extend the bulk selection from the current polygon to this one (same soup)' },
			{ keys: ['Ctrl', 'Click', 'polygon'], label: 'Toggle a polygon in the bulk selection without moving the inspector' },
			{ keys: ['Drag'], label: 'Orbit the camera around the scene' },
			{ keys: ['Right-Drag'], label: 'Pan' },
			{ keys: ['Scroll'], label: 'Zoom in / out' },
		],
	},
	{
		title: 'Box select (marquee)',
		items: [
			{ keys: ['B'], label: 'Toggle box-select mode (cursor turns to a crosshair)' },
			{ keys: ['Drag'], label: 'In box-select mode: rectangle marquee — adds every polygon inside to the bulk selection' },
			{ keys: ['Alt', 'Drag'], label: 'In box-select mode: hold Alt on release to remove the rectangle\u2019s polygons from the bulk set' },
			{ keys: ['Esc'], label: 'Exit box-select mode' },
		],
	},
	BULK_SHORTCUTS,
];

// ---------------------------------------------------------------------------
// Path / key helpers
// ---------------------------------------------------------------------------

// Bulk selection is keyed by `pathKey(path)` — the same '/'-joined form the
// HierarchyTree uses for React keys and expansion state. That keeps the
// styled-row lookup and the tree's internal bookkeeping in lockstep without
// introducing a second identifier convention.
function pathKey(path: NodePath): string {
	return path.join('/') || '__root__';
}

// A polygon path is exactly `['soups', S, 'polygons', P]` where S and P are
// numbers. Anything else is a tree row that doesn't correspond to an
// editable polygon — onBulkToggle silently ignores those.
type PolyAddress = { soup: number; poly: number };
function parsePolyPath(path: NodePath): PolyAddress | null {
	if (
		path.length === 4 &&
		path[0] === 'soups' &&
		typeof path[1] === 'number' &&
		path[2] === 'polygons' &&
		typeof path[3] === 'number'
	) {
		return { soup: path[1], poly: path[3] };
	}
	return null;
}

function parsePolyPathKey(key: string): PolyAddress | null {
	const parts = key.split('/');
	if (parts.length !== 4 || parts[0] !== 'soups' || parts[2] !== 'polygons') return null;
	const soup = Number(parts[1]);
	const poly = Number(parts[3]);
	if (!Number.isFinite(soup) || !Number.isFinite(poly)) return null;
	return { soup, poly };
}

// ---------------------------------------------------------------------------
// Bulk-edit summary — folds the decoded collision-tag fields of every poly
// in `selection` into either a single shared value or `null` ("mixed").
// ---------------------------------------------------------------------------

type BulkSummary = {
	aiSectionIndex: number | null;
	surfaceId: number | null;
	trafficInfo: number | null;
	fatal: boolean | null;
	driveable: boolean | null;
	superfatal: boolean | null;
};

function foldBulk(polys: PolygonSoupPoly[]): BulkSummary {
	const summary: BulkSummary = {
		aiSectionIndex: null,
		surfaceId: null,
		trafficInfo: null,
		fatal: null,
		driveable: null,
		superfatal: null,
	};
	if (polys.length === 0) return summary;
	const first = decodeCollisionTag(polys[0].collisionTag);
	summary.aiSectionIndex = first.aiSectionIndex;
	summary.surfaceId = first.surfaceId;
	summary.trafficInfo = first.trafficInfo;
	summary.fatal = first.fatal;
	summary.driveable = first.driveable;
	summary.superfatal = first.superfatal;
	for (let i = 1; i < polys.length; i++) {
		const d = decodeCollisionTag(polys[i].collisionTag);
		if (summary.aiSectionIndex !== d.aiSectionIndex) summary.aiSectionIndex = null;
		if (summary.surfaceId !== d.surfaceId) summary.surfaceId = null;
		if (summary.trafficInfo !== d.trafficInfo) summary.trafficInfo = null;
		if (summary.fatal !== d.fatal) summary.fatal = null;
		if (summary.driveable !== d.driveable) summary.driveable = null;
		if (summary.superfatal !== d.superfatal) summary.superfatal = null;
	}
	return summary;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

const PolygonSoupListPage = () => {
	const { getResources, setResourceAt } = useWorkspace();
	const bundleId = useFirstLoadedBundleId();
	const activeBundle = useFirstLoadedBundle();
	const uiResources = activeBundle?.resources ?? [];
	const models = useMemo(
		() => (bundleId ? [...getResources<ParsedPolygonSoupList>(bundleId, PSL_HANDLER_KEY)] : []),
		[bundleId, getResources],
	);

	// Correlate parsed models with their bundle-level UIResource (carries
	// debug-name, id, flags). parseAllBundleResourcesViaRegistry walks
	// `bundle.resources` in order and appends to each handler's list, so the
	// Nth PSL model matches the Nth PSL-typed UIResource.
	const pslUIResources = useMemo(
		() => uiResources.filter((r) => r.raw?.resourceTypeId === PSL_TYPE_ID),
		[uiResources],
	);

	// Build the per-model picker ctx once so the handler's labelOf / sortKey
	// compare functions see stable object identities. Lengths can diverge if
	// a parse fails and falls through to null — fall back to `Resource_<idx>`
	// when the UIResource is missing.
	const pickerCtxs = useMemo<PickerResourceCtx[]>(() => {
		const out: PickerResourceCtx[] = [];
		for (let i = 0; i < models.length; i++) {
			const ui = pslUIResources[i];
			out.push({
				id: ui?.id ?? `__psl:${i}__`,
				name: ui?.name ?? `Resource_${i}`,
				index: i,
			});
		}
		return out;
	}, [models.length, pslUIResources]);

	// -------------------------------------------------------------------------
	// Picker state (sort / search / hide-empty / visibility / selection)
	// -------------------------------------------------------------------------

	const [sortKey, setSortKey] = useState<string>(
		polygonSoupListHandler.picker?.defaultSort ?? 'index',
	);
	const [searchQuery, setSearchQuery] = useState('');
	const [hideEmpty, setHideEmpty] = useState(false);

	// Visibility state. Default everything visible when a bundle loads; a
	// ref tracks which bundle's visibility set we have so swapping bundles
	// re-initializes cleanly without resurrecting a prior bundle's hides.
	const initBundleRef = useRef<number>(0);
	const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set());
	useEffect(() => {
		if (pickerCtxs.length === 0) return;
		// Reset when the PSL resource set changes (new bundle or reparse).
		const bundleKey = pickerCtxs.map((c) => c.id).join('|').length;
		if (initBundleRef.current !== bundleKey) {
			initBundleRef.current = bundleKey;
			setVisibleIds(new Set(pickerCtxs.map((c) => c.id)));
		}
	}, [pickerCtxs]);

	// Selection lives here so the tree-embedded picker and the viewport
	// click handler stay in sync. Seeded lazily on first non-empty models
	// list so we don't pick index 0 before we know the sort order.
	// `selectedPath` is driven in controlled mode on SchemaEditorProvider —
	// this is what lets us switch the edited resource without remounting
	// the 3D viewport (which would tear down the WebGL context, force
	// geometry rebuild, and snap the camera back to the auto-fit pose).
	const [selectedIndex, setSelectedIndex] = useState<number>(-1);
	const [selectedPath, setSelectedPath] = useState<NodePath>([]);
	const [bulkPaths, setBulkPaths] = useState<ReadonlySet<string>>(() => new Set());

	// -------------------------------------------------------------------------
	// Build sorted + filtered picker rows
	// -------------------------------------------------------------------------

	const pickerConfig = polygonSoupListHandler.picker!;

	const allEntries = useMemo<PickerEntry<ParsedPolygonSoupList>[]>(
		() => models.map((m, i) => ({ model: m, ctx: pickerCtxs[i] })),
		[models, pickerCtxs],
	);

	const sortedEntries = useMemo(() => {
		const active = pickerConfig.sortKeys.find((k) => k.id === sortKey) ?? pickerConfig.sortKeys[0];
		return [...allEntries].sort((a, b) => active.compare(a, b));
	}, [allEntries, sortKey, pickerConfig]);

	const filteredEntries = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		const textOf = pickerConfig.searchText ?? ((_m: unknown, ctx: PickerResourceCtx) => ctx.name);
		return sortedEntries.filter((e) => {
			if (hideEmpty) {
				const label = pickerConfig.labelOf(e.model, e.ctx);
				if (label.badges?.some((b) => b.label === 'empty')) return false;
			}
			if (!q) return true;
			return textOf(e.model, e.ctx).toLowerCase().includes(q);
		});
	}, [sortedEntries, searchQuery, hideEmpty, pickerConfig]);

	// Seed selection on first non-empty entry list. Defaulting to the first
	// sorted + populated row matches the old `firstPopulated` behavior
	// without the extra useMemo dance.
	useEffect(() => {
		if (selectedIndex !== -1) return;
		if (sortedEntries.length === 0) return;
		const firstPopulated = sortedEntries.find((e) => e.model != null && e.model.soups.length > 0);
		const target = firstPopulated ?? sortedEntries[0];
		setSelectedIndex(target.ctx.index);
	}, [sortedEntries, selectedIndex]);

	// Always include the selected resource in the picker rows, even when a
	// filter would hide it — otherwise the tree's subtree dangles with no
	// parent row above it. Users who don't want it visible can pick
	// something else first.
	const pickerRows = useMemo<PickerRow[]>(() => {
		const rows = filteredEntries.map<PickerRow>((e) => ({
			modelIndex: e.ctx.index,
			ctx: e.ctx,
			model: e.model,
			label: pickerConfig.labelOf(e.model, e.ctx),
			visible: visibleIds.has(e.ctx.id),
		}));
		if (selectedIndex >= 0 && !rows.some((r) => r.modelIndex === selectedIndex)) {
			const sel = allEntries[selectedIndex];
			if (sel) {
				rows.unshift({
					modelIndex: sel.ctx.index,
					ctx: sel.ctx,
					model: sel.model,
					label: pickerConfig.labelOf(sel.model, sel.ctx),
					visible: visibleIds.has(sel.ctx.id),
				});
			}
		}
		return rows;
	}, [filteredEntries, allEntries, selectedIndex, visibleIds, pickerConfig]);

	// Bundle-order indexes the viewport should actually render. Derived from
	// `visibleIds` rather than `pickerRows` so hidden-by-filter resources
	// don't disappear from the 3D scene when the user types in the search
	// box.
	const visibleModelIndexes = useMemo<Set<number>>(() => {
		const out = new Set<number>();
		for (const ctx of pickerCtxs) {
			if (visibleIds.has(ctx.id)) out.add(ctx.index);
		}
		return out;
	}, [pickerCtxs, visibleIds]);

	// -------------------------------------------------------------------------
	// Selection / visibility handlers
	// -------------------------------------------------------------------------

	// Used by the picker rows, the 3D viewport click handler, and the initial
	// seed effect above. `nextPath` replaces the previous "initialPath" state:
	// with controlled selection it's just the next `selectedPath`, applied
	// even when `nextIndex === prev` (so clicking a polygon in the currently
	// open resource still navigates the hierarchy tree — previously a no-op
	// because the key-based remount didn't trigger).
	const switchResource = useCallback((nextIndex: number, nextPath: NodePath = []) => {
		setSelectedIndex((prev) => {
			if (prev !== nextIndex) setBulkPaths(new Set());
			return nextIndex;
		});
		setSelectedPath(nextPath);
	}, []);

	const onToggleVisible = useCallback((resourceId: string) => {
		setVisibleIds((prev) => {
			const next = new Set(prev);
			if (next.has(resourceId)) next.delete(resourceId);
			else next.add(resourceId);
			return next;
		});
	}, []);

	// Alt-click = solo. First press hides everything except `resourceId`.
	// If that resource is already soloed (it's the only visible one),
	// pressing again restores full visibility — the quickest way back to
	// the full scene without having to click every eye in turn.
	const onSoloVisible = useCallback(
		(resourceId: string) => {
			setVisibleIds((prev) => {
				const onlySelf = prev.size === 1 && prev.has(resourceId);
				if (onlySelf) return new Set(pickerCtxs.map((c) => c.id));
				return new Set([resourceId]);
			});
		},
		[pickerCtxs],
	);

	// -------------------------------------------------------------------------
	// Bulk-edit wiring (unchanged from pre-picker layout)
	// -------------------------------------------------------------------------

	const currentModel = selectedIndex >= 0 ? (models[selectedIndex] ?? null) : null;

	const handleChange = useCallback(
		(next: unknown) => {
			if (!bundleId) return;
			setResourceAt(bundleId, PSL_HANDLER_KEY, selectedIndex, next);
		},
		[setResourceAt, selectedIndex, bundleId],
	);

	const onBulkToggle = useCallback((path: NodePath) => {
		const addr = parsePolyPath(path);
		if (!addr) return;
		const key = pathKey(path);
		setBulkPaths((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);

	// Apply a marquee (box-select) drag to the bulk set. `mode === 'add'`
	// unions the picked polys; `mode === 'remove'` subtracts them. The
	// viewport already filters to a single model, but we re-check here to
	// keep the bulkPaths invariant ("only paths in the currently-selected
	// resource") explicit at the call site rather than implicit upstream.
	const onMarqueeApply = useCallback(
		(
			modelIndex: number,
			polys: ReadonlyArray<{ soup: number; poly: number }>,
			mode: 'add' | 'remove',
		) => {
			if (modelIndex !== selectedIndex || polys.length === 0) return;
			setBulkPaths((prev) => {
				const next = new Set(prev);
				for (const { soup, poly } of polys) {
					const key = pathKey(['soups', soup, 'polygons', poly]);
					if (mode === 'add') next.add(key);
					else next.delete(key);
				}
				return next;
			});
		},
		[selectedIndex],
	);

	// Union every polygon between `from` and `to` into the bulk set. Both
	// paths must be polygons in the SAME soup — the step size is 1 polygon
	// and "in between" has no natural meaning across different soups (they
	// don't share an index space). When the two soups differ we fall back
	// to just adding the endpoint, so shift+click on a mismatched row still
	// extends the selection by at least one polygon rather than silently
	// no-oping.
	const onBulkRange = useCallback((from: NodePath, to: NodePath) => {
		const toAddr = parsePolyPath(to);
		if (!toAddr) return;
		const fromAddr = parsePolyPath(from);
		setBulkPaths((prev) => {
			const next = new Set(prev);
			if (!fromAddr || fromAddr.soup !== toAddr.soup) {
				next.add(pathKey(to));
				return next;
			}
			const lo = Math.min(fromAddr.poly, toAddr.poly);
			const hi = Math.max(fromAddr.poly, toAddr.poly);
			for (let p = lo; p <= hi; p++) {
				next.add(pathKey(['soups', toAddr.soup, 'polygons', p]));
			}
			return next;
		});
	}, []);

	// Declared here (after onBulkToggle / onBulkRange) so the ctrl / shift
	// branches can close over fully-initialised values rather than relying
	// on hoist-at-call-time lookups.
	const handleViewportSelect = useCallback(
		(
			modelIndex: number,
			soupIndex: number,
			polyIndex: number,
			modifiers?: { shift?: boolean; ctrl?: boolean },
		) => {
			const targetPath: NodePath = ['soups', soupIndex, 'polygons', polyIndex];
			if (modifiers?.ctrl) {
				// Ctrl/Cmd+click in 3D: toggle bulk on just this polygon,
				// don't move the inspector away from the current edit target.
				onBulkToggle(targetPath);
				return;
			}
			if (modifiers?.shift && selectedIndex === modelIndex && selectedPath.length > 0) {
				// Shift+click in 3D: extend the bulk range from the current
				// inspector selection to this polygon (same soup only).
				// Inspector follows so the anchor moves forward.
				onBulkRange(selectedPath, targetPath);
				setSelectedPath(targetPath);
				return;
			}
			switchResource(modelIndex, targetPath);
		},
		[switchResource, selectedIndex, selectedPath, onBulkToggle, onBulkRange],
	);

	const clearBulk = useCallback(() => setBulkPaths(new Set()), []);

	const selectedPolysInCurrentModel = useMemo(() => {
		const s = new Set<number>();
		for (const key of bulkPaths) {
			const addr = parsePolyPathKey(key);
			if (addr) s.add(encodeSoupPoly(addr.soup, addr.poly));
		}
		return s;
	}, [bulkPaths]);

	const selectedPolyRecords = useMemo(() => {
		if (!currentModel) return [];
		const out: { key: string; addr: PolyAddress; ref: PolygonSoupPoly }[] = [];
		for (const key of bulkPaths) {
			const addr = parsePolyPathKey(key);
			if (!addr) continue;
			const soup = currentModel.soups[addr.soup];
			if (!soup) continue;
			const poly = soup.polygons[addr.poly];
			if (!poly) continue;
			out.push({ key, addr, ref: poly });
		}
		return out;
	}, [bulkPaths, currentModel]);

	const bulkSummary = useMemo(
		() => foldBulk(selectedPolyRecords.map((r) => r.ref)),
		[selectedPolyRecords],
	);

	const applyBulk = useCallback(
		(updater: (raw: number) => number) => {
			if (!currentModel || selectedPolyRecords.length === 0 || !bundleId) return;
			const soupPatches = new Map<number, PolygonSoup>();
			for (const rec of selectedPolyRecords) {
				let soup = soupPatches.get(rec.addr.soup);
				if (!soup) {
					const original = currentModel.soups[rec.addr.soup];
					soup = { ...original, polygons: original.polygons.slice() };
					soupPatches.set(rec.addr.soup, soup);
				}
				const poly = soup.polygons[rec.addr.poly];
				soup.polygons[rec.addr.poly] = {
					...poly,
					collisionTag: updater(poly.collisionTag),
				};
			}
			const next: ParsedPolygonSoupList = {
				...currentModel,
				soups: currentModel.soups.map((s, i) => soupPatches.get(i) ?? s),
			};
			setResourceAt(bundleId, PSL_HANDLER_KEY, selectedIndex, next);
		},
		[currentModel, selectedPolyRecords, selectedIndex, setResourceAt, bundleId],
	);

	const bulkSelectionContextValue = useMemo(
		() => ({
			bulkPathKeys: bulkPaths,
			onBulkToggle,
			onBulkRange,
			// PSL has its own collisionTag-aware BulkEditPanel rendered as a
			// side column; opt out of the inspector-pane generic panel so
			// users don't see two bulk panels at once.
			suppressGenericInspectorPanel: true,
		}),
		[bulkPaths, onBulkToggle, onBulkRange],
	);

	// -------------------------------------------------------------------------
	// Picker context value
	// -------------------------------------------------------------------------

	const pickerContextValue = useMemo<MultiResourcePickerValue | null>(() => {
		if (models.length <= 1) return null;
		return {
			handlerKey: PSL_HANDLER_KEY,
			rows: pickerRows,
			selectedModelIndex: selectedIndex,
			onSelectModel: (i) => switchResource(i, []),
			onToggleVisible,
			onSoloVisible,
			sortKey,
			onSortKeyChange: setSortKey,
			sortKeys: pickerConfig.sortKeys,
			searchQuery,
			onSearchQueryChange: setSearchQuery,
			hideEmpty,
			onHideEmptyChange: setHideEmpty,
		};
	}, [
		models.length,
		pickerRows,
		selectedIndex,
		switchResource,
		onToggleVisible,
		onSoloVisible,
		sortKey,
		pickerConfig.sortKeys,
		searchQuery,
		hideEmpty,
	]);

	// -------------------------------------------------------------------------
	// Early-outs
	// -------------------------------------------------------------------------

	if (models.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Polygon Soup List — Schema Editor</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle containing a polygon soup list (e.g. WORLDCOL.BIN) to begin.
					</div>
				</CardContent>
			</Card>
		);
	}

	if (selectedIndex < 0) {
		// Selection is still being seeded on first render — render nothing
		// visible rather than mounting the schema editor with a bogus model.
		return null;
	}

	if (!currentModel) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Polygon Soup List — Schema Editor</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Resource #{selectedIndex} failed to parse — pick a different one.
					</div>
				</CardContent>
			</Card>
		);
	}

	const bulkCount = selectedPolyRecords.length;
	const bulkActive = bulkCount > 0;

	return (
		<div className="h-full min-h-0 flex flex-col gap-3">
			<div className="shrink-0">
				<div className="flex items-center gap-3">
					<h2 className="text-lg font-semibold">Polygon Soup List — Schema Editor</h2>
					<ShortcutsHelp groups={PSL_SHORTCUT_GROUPS} />
				</div>
				<p className="text-xs text-muted-foreground mt-1">
					Per-track-unit collision geometry (resource type 0x43). WORLDCOL.BIN bundles one PolygonSoupList
					per chunk of the open world, each carrying packed vertex data, triangle / quad polygons, and an
					AABB tree for broad-phase hit-testing. Every polygon's collision tag encodes a surface ID (road,
					wall, vegetation, …), gameplay flags (fatal / driveable / superfatal) and an index back into the
					AISections resource that drives traffic AI — so edits here ripple into physics behaviour and AI
					routing at runtime.
				</p>
			</div>
			<div className="flex-1 min-h-0 flex gap-3">
				<div className="flex-1 min-w-0">
					<PolygonSoupListContext.Provider
						value={{
							models: models as (ParsedPolygonSoupList | null)[],
							selectedModelIndex: selectedIndex,
							onSelect: handleViewportSelect,
							selectedPolysInCurrentModel,
							visibleModelIndexes,
							treeSelectedPoly: parsePolyPath(selectedPath),
							onMarqueeApply,
						}}
					>
						<MultiResourcePickerContext.Provider value={pickerContextValue}>
							<SchemaBulkSelectionContext.Provider value={bulkSelectionContextValue}>
								<SchemaEditorProvider
									// Controlled selection: the page owns `selectedPath`
									// alongside `selectedIndex`, so switching resources
									// doesn't remount the provider (and, crucially, the
									// 3D viewport underneath it).
									resource={polygonSoupListResourceSchema}
									data={currentModel}
									onChange={handleChange}
									selectedPath={selectedPath}
									onSelectedPathChange={setSelectedPath}
									extensions={polygonSoupListExtensions}
								>
									<SchemaEditor />
								</SchemaEditorProvider>
							</SchemaBulkSelectionContext.Provider>
						</MultiResourcePickerContext.Provider>
					</PolygonSoupListContext.Provider>
				</div>
				{bulkActive && (
					<BulkEditPanel
						count={bulkCount}
						summary={bulkSummary}
						onClear={clearBulk}
						applyBulk={applyBulk}
					/>
				)}
			</div>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Bulk-edit side panel — only mounted while bulk selection has at least one
// polygon. Keeps draft state for the "Apply N to the selection" inputs.
// ---------------------------------------------------------------------------

type BulkEditPanelProps = {
	count: number;
	summary: BulkSummary;
	onClear: () => void;
	applyBulk: (updater: (raw: number) => number) => void;
};

function BulkEditPanel({ count, summary, onClear, applyBulk }: BulkEditPanelProps) {
	const [aiDraft, setAiDraft] = useState<number | null>(summary.aiSectionIndex);
	const [surfaceDraft, setSurfaceDraft] = useState<string>(
		summary.surfaceId == null ? '' : String(summary.surfaceId),
	);
	const [trafficDraft, setTrafficDraft] = useState<string>(
		summary.trafficInfo == null ? '' : String(summary.trafficInfo),
	);

	// When the selection becomes homogeneous for a field, seed the draft so
	// the "Apply" button previews the value the user would leave in place.
	// Mixed values don't overwrite the draft so the user can still type.
	useEffect(() => {
		if (summary.aiSectionIndex != null) setAiDraft(summary.aiSectionIndex);
	}, [summary.aiSectionIndex]);
	useEffect(() => {
		if (summary.surfaceId != null) setSurfaceDraft(String(summary.surfaceId));
	}, [summary.surfaceId]);
	useEffect(() => {
		if (summary.trafficInfo != null) setTrafficDraft(String(summary.trafficInfo));
	}, [summary.trafficInfo]);

	const applyAiSection = () => {
		if (aiDraft == null) return;
		applyBulk((raw) => setAiSectionIndex(raw, aiDraft));
	};

	const applySurface = () => {
		const v = parseInt(surfaceDraft, 10);
		if (!Number.isFinite(v) || v < 0 || v > SURFACE_ID_MAX) return;
		applyBulk((raw) => setSurfaceId(raw, v));
	};

	const applyTraffic = () => {
		const v = parseInt(trafficDraft, 10);
		if (!Number.isFinite(v) || v < 0 || v > TRAFFIC_INFO_MAX) return;
		applyBulk((raw) => setTrafficInfo(raw, v));
	};

	return (
		<div className="w-80 shrink-0 overflow-auto rounded border border-amber-500/40 bg-background/60">
			<div className="p-3 border-b border-amber-500/40 flex items-center justify-between gap-2 bg-amber-500/5">
				<div>
					<div className="text-sm font-medium">Bulk edit</div>
					<div className="text-[11px] text-muted-foreground">
						{count} polygon{count === 1 ? '' : 's'} selected
					</div>
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 text-xs"
					onClick={onClear}
				>
					Clear
				</Button>
			</div>
			<div className="p-3 space-y-4">
				{/* AI section index */}
				<div className="space-y-1">
					<div className="text-[11px] font-medium text-muted-foreground">AI section index</div>
					<AISectionPicker
						value={summary.aiSectionIndex ?? aiDraft}
						onChange={(v) => setAiDraft(v)}
						placeholder={summary.aiSectionIndex == null ? '(mixed)' : undefined}
					/>
					<Button
						size="sm"
						className="h-7 text-xs w-full"
						disabled={aiDraft == null}
						onClick={applyAiSection}
					>
						Apply AI section to {count}
					</Button>
				</div>

				{/* Surface ID */}
				<div className="space-y-1">
					<div className="text-[11px] font-medium text-muted-foreground">Surface ID</div>
					<Input
						type="number"
						min={0}
						max={SURFACE_ID_MAX}
						value={surfaceDraft}
						placeholder={summary.surfaceId == null ? '(mixed)' : undefined}
						className="h-8 font-mono text-xs"
						onChange={(e) => setSurfaceDraft(e.target.value)}
					/>
					<Button
						size="sm"
						className="h-7 text-xs w-full"
						disabled={surfaceDraft === ''}
						onClick={applySurface}
					>
						Apply surface to {count}
					</Button>
				</div>

				{/* Flags */}
				<div className="space-y-2">
					<div className="text-[11px] font-medium text-muted-foreground">Flags</div>
					<div className="space-y-2">
						<BulkFlagRow
							label="Fatal (wreck)"
							value={summary.fatal}
							onApply={(v) => applyBulk((raw) => setFlagFatal(raw, v))}
							count={count}
						/>
						<BulkFlagRow
							label="Driveable"
							value={summary.driveable}
							onApply={(v) => applyBulk((raw) => setFlagDriveable(raw, v))}
							count={count}
						/>
						<BulkFlagRow
							label="Superfatal"
							value={summary.superfatal}
							onApply={(v) => applyBulk((raw) => setFlagSuperfatal(raw, v))}
							count={count}
						/>
					</div>
				</div>

				{/* Traffic info */}
				<div className="space-y-1">
					<div className="text-[11px] font-medium text-muted-foreground">Traffic info</div>
					<Input
						type="number"
						min={0}
						max={TRAFFIC_INFO_MAX}
						value={trafficDraft}
						placeholder={summary.trafficInfo == null ? '(mixed)' : undefined}
						className="h-8 font-mono text-xs"
						onChange={(e) => setTrafficDraft(e.target.value)}
					/>
					{trafficDraft !== '' && (
						<div className="text-[10px] text-muted-foreground font-mono">
							{trafficInfoLabel(parseInt(trafficDraft, 10))}
						</div>
					)}
					<Button
						size="sm"
						className="h-7 text-xs w-full"
						disabled={trafficDraft === ''}
						onClick={applyTraffic}
					>
						Apply traffic to {count}
					</Button>
				</div>
			</div>
		</div>
	);
}

// Per-flag bulk row: shows the indeterminate state, lets the user pick a
// target value, and fires an Apply that rewrites that flag on every
// selected polygon.
function BulkFlagRow({
	label,
	value,
	onApply,
	count,
}: {
	label: string;
	value: boolean | null;
	onApply: (next: boolean) => void;
	count: number;
}) {
	const [draft, setDraft] = useState<boolean>(value ?? false);

	useEffect(() => {
		if (value != null) setDraft(value);
	}, [value]);

	return (
		<div className="flex items-center justify-between gap-2">
			<FlagCheckbox
				label={label}
				value={draft}
				onChange={setDraft}
			/>
			<Button
				variant="outline"
				size="sm"
				className="h-6 text-[10px] px-2"
				onClick={() => onApply(draft)}
			>
				Apply to {count}
			</Button>
		</div>
	);
}

export default PolygonSoupListPage;

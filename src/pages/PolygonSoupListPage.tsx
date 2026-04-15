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
// Bulk edit:
// Ctrl/Cmd+clicking polygon rows in the hierarchy tree toggles them in a
// bulk selection. The "Bulk edit" side panel only appears while that
// selection has at least one polygon, and lets the user rewrite one
// collision-tag field on every selected polygon at once, leaving all
// other fields per-polygon untouched. The 3D viewport mirrors the bulk
// selection as an amber tint so the user can see which polys they're
// editing in context. Switching resources (via the dropdown or a
// cross-model viewport click) clears the bulk selection.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBundle } from '@/context/BundleContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { SchemaBulkSelectionContext } from '@/components/schema-editor/bulkSelectionContext';
import { polygonSoupListResourceSchema } from '@/lib/schema/resources/polygonSoupList';
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

// Build a dropdown label for a PSL resource. Shows the resource index, soup
// count, and total triangle count so the user can pick the interesting ones
// (the 159 empty stubs in WORLDCOL get a " · empty" suffix).
function pslLabel(model: ParsedPolygonSoupList | null, index: number): string {
	if (model == null) return `#${index} · parse failed`;
	const soupCount = model.soups.length;
	if (soupCount === 0) return `#${index} · empty`;
	let triCount = 0;
	for (const s of model.soups) {
		for (const p of s.polygons) triCount += p.vertexIndices[3] === 0xFF ? 1 : 2;
	}
	return `#${index} · ${soupCount} soup${soupCount === 1 ? '' : 's'} · ${triCount.toLocaleString()} tris`;
}

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
	const { getResources, setResourceAt } = useBundle();
	const models = getResources<ParsedPolygonSoupList>('polygonSoupList');

	// Default to the first populated resource so the schema editor opens on
	// something useful instead of the 48-byte empty stub at index 0.
	const firstPopulated = useMemo(() => {
		for (let i = 0; i < models.length; i++) {
			if (models[i] && (models[i] as ParsedPolygonSoupList).soups.length > 0) return i;
		}
		return 0;
	}, [models]);

	const [selectedIndex, setSelectedIndex] = useState<number>(firstPopulated);
	// Initial path for the schema editor — re-keyed whenever the selected
	// resource changes so the SchemaEditorProvider remounts with fresh state.
	// Viewport click → (modelIndex, soupIndex, polyIndex) populates this to
	// navigate the tree to the clicked polygon on the first render after
	// the resource swap.
	const [initialPath, setInitialPath] = useState<(string | number)[]>([]);

	// Bulk selection for the current resource. Keyed by pathKey so the
	// HierarchyTree can cheaply check membership via `bulkPathKeys.has(...)`.
	// Cleared on resource change (see `switchResource` below).
	const [bulkPaths, setBulkPaths] = useState<ReadonlySet<string>>(() => new Set());

	const currentModel = models[selectedIndex] ?? null;

	const handleChange = useCallback(
		(next: unknown) => setResourceAt('polygonSoupList', selectedIndex, next),
		[setResourceAt, selectedIndex],
	);

	// Central place to switch the active resource. Clears the bulk selection
	// because it's scoped to whichever resource the tree is currently showing.
	const switchResource = useCallback((nextIndex: number, nextInitialPath: (string | number)[] = []) => {
		setSelectedIndex((prev) => {
			if (prev !== nextIndex) setBulkPaths(new Set());
			return nextIndex;
		});
		setInitialPath(nextInitialPath);
	}, []);

	const handleViewportSelect = useCallback(
		(modelIndex: number, soupIndex: number, polyIndex: number) => {
			switchResource(modelIndex, ['soups', soupIndex, 'polygons', polyIndex]);
		},
		[switchResource],
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

	const clearBulk = useCallback(() => setBulkPaths(new Set()), []);

	// Viewport-friendly set: encodeSoupPoly(s, p) for each entry. Since the
	// bulk selection is always scoped to the current resource, every entry
	// belongs in this model.
	const selectedPolysInCurrentModel = useMemo(() => {
		const s = new Set<number>();
		for (const key of bulkPaths) {
			const addr = parsePolyPathKey(key);
			if (addr) s.add(encodeSoupPoly(addr.soup, addr.poly));
		}
		return s;
	}, [bulkPaths]);

	// Resolve the actual PolygonSoupPoly refs for the bulk panel. Stale
	// entries (pointing at a soup/poly that no longer exists) are silently
	// dropped — they can linger if a mutation shrinks a soup's polygons list.
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

	// Apply one field-level setter to every polygon in the bulk selection.
	// Clones only the soups that actually contain a selected polygon so the
	// rest of the resource stays structurally shared and the writer skips
	// re-emission on unchanged regions.
	const applyBulk = useCallback(
		(updater: (raw: number) => number) => {
			if (!currentModel || selectedPolyRecords.length === 0) return;
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
			setResourceAt('polygonSoupList', selectedIndex, next);
		},
		[currentModel, selectedPolyRecords, selectedIndex, setResourceAt],
	);

	// Stable bulk context value for the tree. Re-created only when bulkPaths
	// or onBulkToggle identity changes, so tree rows don't thrash.
	const bulkSelectionContextValue = useMemo(
		() => ({ bulkPathKeys: bulkPaths, onBulkToggle }),
		[bulkPaths, onBulkToggle],
	);

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
			<div className="flex items-center gap-4 shrink-0">
				<div className="flex-1">
					<h2 className="text-lg font-semibold">Polygon Soup List — Schema Editor</h2>
					<p className="text-xs text-muted-foreground">
						Collision mesh resource (0x43). Click a polygon in the 3D view to open it in the inspector. Hold <kbd className="px-1 py-0.5 bg-muted rounded border text-[10px] font-mono">Ctrl</kbd>/<kbd className="px-1 py-0.5 bg-muted rounded border text-[10px] font-mono">⌘</kbd> while clicking polygons in the hierarchy tree to build a bulk selection.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">Resource</span>
					<Select
						value={String(selectedIndex)}
						onValueChange={(v) => switchResource(Number(v), [])}
					>
						<SelectTrigger className="h-8 w-72">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="max-h-[60vh]">
							{models.map((m, i) => (
								<SelectItem key={i} value={String(i)}>
									{pslLabel(m as ParsedPolygonSoupList | null, i)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
			<div className="flex-1 min-h-0 flex gap-3">
				<div className="flex-1 min-w-0">
					<PolygonSoupListContext.Provider
						value={{
							models: models as (ParsedPolygonSoupList | null)[],
							selectedModelIndex: selectedIndex,
							onSelect: handleViewportSelect,
							selectedPolysInCurrentModel,
						}}
					>
						<SchemaBulkSelectionContext.Provider value={bulkSelectionContextValue}>
							<SchemaEditorProvider
								// Key on selectedIndex so the provider remounts with a fresh
								// initialPath whenever the user (or the viewport) picks a
								// different resource.
								key={`psl-${selectedIndex}`}
								resource={polygonSoupListResourceSchema}
								data={currentModel}
								onChange={handleChange}
								initialPath={initialPath}
								extensions={polygonSoupListExtensions}
							>
								<SchemaEditor />
							</SchemaEditorProvider>
						</SchemaBulkSelectionContext.Provider>
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

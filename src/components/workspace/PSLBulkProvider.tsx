// PSLBulkProvider — workspace-wide owner of the PolygonSoupList bulk-edit
// state. Used to live inside `WorldViewportComposition` when the only
// consumer was the overlay; lifted out so the inspector pane's
// `BulkEditPanel` can read the same state (issue #24 follow-up).
//
// The provider exposes two contexts:
//
//   - `PolygonSoupListContext` — consumed by `PolygonSoupListOverlay`
//      inside the WorldViewport. Drives the box-select marquee, 3D bulk
//      highlight, and 3D click → bulk toggle / inspector navigate.
//
//   - `WorkspacePSLBulkContext` — exposes `count`, `summary`, `applyBulk`,
//      `onClear` so the workspace's inspector pane can mount the shared
//      `BulkEditPanel` next to the schema-driven inspector form.
//
// Bulk state resets whenever the active `(bundleId, index)` changes — same
// UX as the legacy PolygonSoupListPage. We don't currently surface the
// shift-extend behaviour (the workspace tree's anchor path isn't exposed
// to the overlay) but the bulk Set itself is identical.

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react';
import {
	PolygonSoupListContext,
	encodeSoupPoly,
	type PolygonSoupListContextValue,
} from '@/components/schema-editor/viewports/polygonSoupListContext';
import {
	foldBulk,
	parsePolyPath,
	parsePolyPathKey,
	type BulkSummary,
} from '@/components/polygonSoupList/BulkEditPanel';
import type {
	ParsedPolygonSoupList,
	PolygonSoup,
	PolygonSoupPoly,
} from '@/lib/core/polygonSoupList';
import type { NodePath } from '@/lib/schema/walk';
import type { WorkspaceContextValue } from '@/context/WorkspaceContext.types';

const PSL_KEY = 'polygonSoupList';

// ---------------------------------------------------------------------------
// Workspace-side context — for the inspector pane's BulkEditPanel
// ---------------------------------------------------------------------------

export type WorkspacePSLBulkValue = {
	count: number;
	summary: BulkSummary;
	applyBulk: (updater: (raw: number) => number) => void;
	onClear: () => void;
};

const WorkspacePSLBulkContext = createContext<WorkspacePSLBulkValue | null>(null);

/** Returns the active PSL bulk-edit handle when the user has at least one
 *  polygon in the bulk set; `null` otherwise. The inspector pane mounts
 *  `BulkEditPanel` only when this returns a non-null value. */
export function useWorkspacePSLBulk(): WorkspacePSLBulkValue | null {
	return useContext(WorkspacePSLBulkContext);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

function pathToKey(path: NodePath): string {
	return path.join('/');
}

export function PSLBulkProvider({
	bundles,
	selection,
	select,
	setResourceAt,
	isVisible,
	children,
}: {
	bundles: WorkspaceContextValue['bundles'];
	selection: WorkspaceContextValue['selection'];
	select: WorkspaceContextValue['select'];
	setResourceAt: WorkspaceContextValue['setResourceAt'];
	isVisible: WorkspaceContextValue['isVisible'];
	children: ReactNode;
}) {
	// Bulk path-keys for the currently-active PSL resource. Reset whenever
	// the user switches `(bundleId, index)` so each instance gets a fresh
	// box-select session — same UX as the legacy PolygonSoupListPage.
	const [bulkPaths, setBulkPaths] = useState<Set<string>>(() => new Set());
	const activeKey =
		selection?.resourceKey === PSL_KEY && selection.index !== undefined
			? `${selection.bundleId}:${selection.index}`
			: null;
	useEffect(() => {
		setBulkPaths(new Set());
	}, [activeKey]);

	const onClear = useCallback(() => setBulkPaths(new Set()), []);

	// Resolve the active PSL bundle + model once per render so both the
	// overlay-side and inspector-side context values can reuse it.
	const active = useMemo(() => {
		if (
			!selection ||
			selection.resourceKey !== PSL_KEY ||
			selection.index === undefined
		) {
			return null;
		}
		const bundle = bundles.find((b) => b.id === selection.bundleId);
		if (!bundle) return null;
		const list = bundle.parsedResourcesAll.get(PSL_KEY) as
			| (ParsedPolygonSoupList | null)[]
			| undefined;
		if (!list) return null;
		const model = list[selection.index] ?? null;
		return {
			bundleId: selection.bundleId,
			selectedModelIndex: selection.index,
			list,
			model,
		};
	}, [bundles, selection]);

	// Selected polygon records (paired with their address + model ref) —
	// drives both the overlay's encoded `Set<number>` and the inspector
	// panel's `summary`.
	const selectedPolyRecords = useMemo(() => {
		if (!active?.model) return [] as { addr: { soup: number; poly: number }; ref: PolygonSoupPoly }[];
		const out: { addr: { soup: number; poly: number }; ref: PolygonSoupPoly }[] = [];
		for (const key of bulkPaths) {
			const addr = parsePolyPathKey(key);
			if (!addr) continue;
			const soup = active.model.soups[addr.soup];
			if (!soup) continue;
			const poly = soup.polygons[addr.poly];
			if (!poly) continue;
			out.push({ addr, ref: poly });
		}
		return out;
	}, [active?.model, bulkPaths]);

	const summary = useMemo(
		() => foldBulk(selectedPolyRecords.map((r) => r.ref)),
		[selectedPolyRecords],
	);

	const applyBulk = useCallback(
		(updater: (raw: number) => number) => {
			if (!active?.model || selectedPolyRecords.length === 0) return;
			const soupPatches = new Map<number, PolygonSoup>();
			for (const rec of selectedPolyRecords) {
				let soup = soupPatches.get(rec.addr.soup);
				if (!soup) {
					const original = active.model.soups[rec.addr.soup];
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
				...active.model,
				soups: active.model.soups.map((s, i) => soupPatches.get(i) ?? s),
			};
			setResourceAt(active.bundleId, PSL_KEY, active.selectedModelIndex, next);
		},
		[active, selectedPolyRecords, setResourceAt],
	);

	// Overlay-side context: drives marquee + 3D bulk highlight.
	const pslCtxValue = useMemo<PolygonSoupListContextValue | null>(() => {
		if (!active) return null;

		const visibleSet = new Set<number>();
		for (let i = 0; i < active.list.length; i++) {
			if (
				isVisible({
					bundleId: active.bundleId,
					resourceKey: PSL_KEY,
					index: i,
				})
			) {
				visibleSet.add(i);
			}
		}

		const selectedPolys = new Set<number>();
		for (const rec of selectedPolyRecords) {
			selectedPolys.add(encodeSoupPoly(rec.addr.soup, rec.addr.poly));
		}

		const onSelect = (
			modelIndex: number,
			soupIndex: number,
			polyIndex: number,
			modifiers?: { shift?: boolean; ctrl?: boolean },
		) => {
			const targetPath: NodePath = ['soups', soupIndex, 'polygons', polyIndex];
			if (modifiers?.ctrl) {
				if (modelIndex !== active.selectedModelIndex) return;
				setBulkPaths((prev) => {
					const k = pathToKey(targetPath);
					const next = new Set(prev);
					if (next.has(k)) next.delete(k);
					else next.add(k);
					return next;
				});
				return;
			}
			select({
				bundleId: active.bundleId,
				resourceKey: PSL_KEY,
				index: modelIndex,
				path: targetPath,
			});
		};

		const onMarqueeApply = (
			modelIndex: number,
			polys: ReadonlyArray<{ soup: number; poly: number }>,
			mode: 'add' | 'remove',
		) => {
			if (modelIndex !== active.selectedModelIndex || polys.length === 0) return;
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
			models: active.list,
			selectedModelIndex: active.selectedModelIndex,
			onSelect,
			selectedPolysInCurrentModel: selectedPolys,
			visibleModelIndexes: visibleSet,
			treeSelectedPoly:
				selection?.path != null ? parsePolyPath(selection.path) : null,
			onMarqueeApply,
		};
	}, [active, selectedPolyRecords, isVisible, select, selection?.path]);

	// Workspace-side context: drives the BulkEditPanel mount. Null when
	// either no PSL is active or the bulk set is empty — the inspector
	// pane uses null to mean "don't render the panel."
	const workspaceBulkValue = useMemo<WorkspacePSLBulkValue | null>(() => {
		if (!active || selectedPolyRecords.length === 0) return null;
		return {
			count: selectedPolyRecords.length,
			summary,
			applyBulk,
			onClear,
		};
	}, [active, selectedPolyRecords.length, summary, applyBulk, onClear]);

	// PolygonSoupListContext only mounts when there's an active PSL — keeps
	// the overlay's `usePolygonSoupListContext()` returning null on
	// non-PSL workspaces so the marquee + 3D-pick callbacks gracefully
	// fall back to the composition's `onPickInstancePoly` prop.
	const overlay = pslCtxValue ? (
		<PolygonSoupListContext.Provider value={pslCtxValue}>
			{children}
		</PolygonSoupListContext.Provider>
	) : (
		<>{children}</>
	);

	return (
		<WorkspacePSLBulkContext.Provider value={workspaceBulkValue}>
			{overlay}
		</WorkspacePSLBulkContext.Provider>
	);
}

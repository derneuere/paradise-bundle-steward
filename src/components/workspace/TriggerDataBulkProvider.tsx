// TriggerDataBulkProvider — workspace-wide owner of the TriggerData bulk-
// select state. Sibling of `AISectionsBulkProvider`; the workspace mounts
// both and they coexist (their bulks are independent — selecting trigger
// regions doesn't touch the AI bulk and vice versa).
//
// The provider exposes two contexts:
//
//   - `TriggerDataBulkContext` — consumed by `TriggerDataOverlay`. Carries
//     the per-(bundleId, index) bulk Set, plus the marquee `onApplyPaths`
//     entry point. Resolved through `forInstance(bundleId, index)` exactly
//     like `useAISectionsBulk()`.
//
//   - `WorkspaceTriggerDataBulkContext` — consumed by `WorkspaceHierarchy`
//     (tree-row Ctrl/Shift + future amber decoration) and `BulkPanelStack`.
//     Surfaces every non-empty bulk across every loaded bundle.
//
// Why the bulk persists across selection changes (mirrors AI Sections,
// deviates from PSL): users curate a multi-region selection in TriggerData,
// hop the inspector elsewhere to compare, and come back. Resetting on
// inspector navigation would silently destroy that work. The bulk is keyed
// by `(bundleId, resourceKey, index)` and clears only on bundle close or
// explicit `[✕]` from the panel stack.
//
// Multi-bundle: each (bundleId, index) has its own bulk Set. Bulks coexist;
// clearing one doesn't affect any other.

import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from 'react';
import {
	applyPaths,
	rangeAddEntries,
	toggleEntry,
} from './triggerDataBulk';
import type { NodePath } from '@/lib/schema/walk';
import type {
	BundleId,
	WorkspaceContextValue,
} from '@/context/WorkspaceContext.types';

const TRIGGER_KEY = 'triggerData';

// ---------------------------------------------------------------------------
// Storage shape
// ---------------------------------------------------------------------------

// Each (bundleId, index) gets its own bulk Set. The outer key is
// `${bundleId}::${index}` — both pieces are stable identifiers (bundle
// filename + Bundle-relative resource index). Closed-bundle entries are
// pruned in `pruneClosedBundleBulks` below.
type BulkKey = string;
function bulkKeyOf(bundleId: BundleId, index: number): BulkKey {
	return `${bundleId}::${index}`;
}

type BulkEntry = {
	bundleId: BundleId;
	index: number;
	paths: ReadonlySet<string>;
	/** Wall-clock ms of the most recent toggle/range/clear-add. Drives the
	 *  panel-stack ordering: most-recently-touched panel rises to the top. */
	lastTouchedAt: number;
};

type BulkMap = ReadonlyMap<BulkKey, BulkEntry>;

// ---------------------------------------------------------------------------
// Overlay-side context — consumed by TriggerDataOverlay. Resolves a per-
// instance handle so the same overlay component, mounted twice across two
// bundles, gets two independent bulk Sets.
// ---------------------------------------------------------------------------

export type TriggerDataBulkInstanceValue = {
	/** Path-keyed Set for THIS (bundleId, index) instance — `'landmarks/3'`,
	 *  `'roamingLocations/5'`, etc. Empty when no entries are in the bulk. */
	bulkPathKeys: ReadonlySet<string>;
	/** Batch-apply schema paths to the bulk Set in one pass. The 3D marquee
	 *  emits a hit-array spanning every entry inside the dragged rectangle
	 *  and dispatches once with `mode === 'add'` (default) or `'remove'` (Alt).
	 *  Non-entry paths are silently dropped — see `applyPaths`. */
	onApplyPaths: (paths: ReadonlyArray<NodePath>, mode: 'add' | 'remove') => void;
	/** Clear this instance's bulk. */
	onClear: () => void;
};

export type TriggerDataBulkValue = {
	/** Resolve the bulk handle for one specific overlay instance. The
	 *  WorldViewportComposition feeds `(bundleId, index)`; legacy single-
	 *  resource pages can call this with their own identity (or skip the
	 *  context entirely and accept an empty bulk). */
	forInstance: (bundleId: BundleId, index: number) => TriggerDataBulkInstanceValue;
};

const TriggerDataBulkContext = createContext<TriggerDataBulkValue | null>(null);

/** Returns the workspace TriggerData bulk lookup. `null` when no provider
 *  is mounted (legacy per-resource page routes). Overlays read this once
 *  and resolve their own instance via `forInstance(bundleId, index)`. */
export function useTriggerDataBulk(): TriggerDataBulkValue | null {
	return useContext(TriggerDataBulkContext);
}

// ---------------------------------------------------------------------------
// Workspace-side context — consumed by WorkspaceHierarchy (tree-row
// Ctrl/Shift semantics + amber decoration) and BulkPanelStack.
// ---------------------------------------------------------------------------

export type WorkspaceTriggerDataBulkSummary = {
	bundleId: BundleId;
	index: number;
	count: number;
	lastTouchedAt: number;
	pathKeys: ReadonlySet<string>;
};

export type WorkspaceTriggerDataBulkValue = {
	/** All non-empty bulks across every loaded bundle. Caller-side sort on
	 *  `lastTouchedAt` produces the panel-stack ordering. */
	summaries: readonly WorkspaceTriggerDataBulkSummary[];
	/** Total path-keys count for `(bundleId, index)`. Cheap O(1) lookup
	 *  for the tree's resource-row badge. */
	getCount: (bundleId: BundleId, index: number) => number;
	/** Path-keyed Set for `(bundleId, index)` — the tree paints rows whose
	 *  schema path stringifies to a member. Returns null when the bulk is
	 *  empty, so the tree doesn't have to allocate empty Sets. */
	getPathKeys: (
		bundleId: BundleId,
		index: number,
	) => ReadonlySet<string> | null;
	/** Tree-row Ctrl-click bulk-toggle. Path is normalised to the containing
	 *  entry; non-entry paths are silently ignored. */
	onBulkToggle: (bundleId: BundleId, index: number, path: NodePath) => void;
	onBulkRange: (
		bundleId: BundleId,
		index: number,
		from: NodePath,
		to: NodePath,
	) => void;
	/** Batch-apply schema paths to `(bundleId, index)`'s bulk in one pass.
	 *  Mirrors `onBulkToggle`'s sub-path normalisation but folds many paths
	 *  into a single state update — the 3D marquee emits all hits at once
	 *  rather than dispatching per-entry. */
	onBulkApplyPaths: (
		bundleId: BundleId,
		index: number,
		paths: ReadonlyArray<NodePath>,
		mode: 'add' | 'remove',
	) => void;
	/** Clear the bulk for `(bundleId, index)` — drives the panel `[✕]`. */
	onClear: (bundleId: BundleId, index: number) => void;
};

const WorkspaceTriggerDataBulkContext =
	createContext<WorkspaceTriggerDataBulkValue | null>(null);

export function useWorkspaceTriggerDataBulk(): WorkspaceTriggerDataBulkValue | null {
	return useContext(WorkspaceTriggerDataBulkContext);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

function pruneClosedBundleBulks(
	prev: BulkMap,
	loadedBundleIds: ReadonlySet<BundleId>,
): BulkMap {
	let changed = false;
	const next = new Map(prev);
	for (const [k, entry] of prev) {
		if (!loadedBundleIds.has(entry.bundleId)) {
			next.delete(k);
			changed = true;
		}
	}
	return changed ? next : prev;
}

export function TriggerDataBulkProvider({
	bundles,
	children,
}: {
	bundles: WorkspaceContextValue['bundles'];
	children: ReactNode;
}) {
	const [bulks, setBulks] = useState<BulkMap>(() => new Map());

	// Drop entries whose bundle was closed. Mirrors AISectionsBulkProvider's
	// in-render reduce: derive the loaded set, prune, and only setState when
	// the resulting Map identity differs from the current one. No useEffect.
	const loadedBundleIds = useMemo(() => {
		const s = new Set<BundleId>();
		for (const b of bundles) s.add(b.id);
		return s;
	}, [bundles]);
	const prunedBulks = useMemo(
		() => pruneClosedBundleBulks(bulks, loadedBundleIds),
		[bulks, loadedBundleIds],
	);
	if (prunedBulks !== bulks) {
		// React documents synchronous setState during render as legal when the
		// new value is a pure function of the old. See "Storing information
		// from previous renders" in the React docs.
		setBulks(prunedBulks);
	}

	const writeEntry = useCallback(
		(
			bundleId: BundleId,
			index: number,
			updater: (paths: ReadonlySet<string>) => Set<string>,
		) => {
			setBulks((prev) => {
				const k = bulkKeyOf(bundleId, index);
				const cur = prev.get(k);
				const nextPaths = updater(cur?.paths ?? new Set<string>());
				const next = new Map(prev);
				if (nextPaths.size === 0) {
					next.delete(k);
				} else {
					next.set(k, {
						bundleId,
						index,
						paths: nextPaths,
						lastTouchedAt: Date.now(),
					});
				}
				return next;
			});
		},
		[],
	);

	// ---- Workspace-side handlers ----

	const onWsToggle = useCallback(
		(bundleId: BundleId, index: number, path: NodePath) => {
			writeEntry(bundleId, index, (paths) => toggleEntry(paths, path));
		},
		[writeEntry],
	);

	const onWsRange = useCallback(
		(bundleId: BundleId, index: number, from: NodePath, to: NodePath) => {
			writeEntry(bundleId, index, (paths) => rangeAddEntries(paths, from, to));
		},
		[writeEntry],
	);

	const onWsApplyPaths = useCallback(
		(
			bundleId: BundleId,
			index: number,
			paths: ReadonlyArray<NodePath>,
			mode: 'add' | 'remove',
		) => {
			writeEntry(bundleId, index, (cur) => applyPaths(cur, paths, mode));
		},
		[writeEntry],
	);

	const onWsClear = useCallback(
		(bundleId: BundleId, index: number) => {
			writeEntry(bundleId, index, () => new Set<string>());
		},
		[writeEntry],
	);

	const summaries = useMemo<readonly WorkspaceTriggerDataBulkSummary[]>(() => {
		const out: WorkspaceTriggerDataBulkSummary[] = [];
		for (const entry of bulks.values()) {
			if (entry.paths.size === 0) continue;
			out.push({
				bundleId: entry.bundleId,
				index: entry.index,
				count: entry.paths.size,
				lastTouchedAt: entry.lastTouchedAt,
				pathKeys: entry.paths,
			});
		}
		return out;
	}, [bulks]);

	const getCount = useCallback(
		(bundleId: BundleId, index: number) =>
			bulks.get(bulkKeyOf(bundleId, index))?.paths.size ?? 0,
		[bulks],
	);

	const getPathKeys = useCallback(
		(bundleId: BundleId, index: number) => {
			const e = bulks.get(bulkKeyOf(bundleId, index));
			return e && e.paths.size > 0 ? e.paths : null;
		},
		[bulks],
	);

	const workspaceValue = useMemo<WorkspaceTriggerDataBulkValue>(
		() => ({
			summaries,
			getCount,
			getPathKeys,
			onBulkToggle: onWsToggle,
			onBulkRange: onWsRange,
			onBulkApplyPaths: onWsApplyPaths,
			onClear: onWsClear,
		}),
		[summaries, getCount, getPathKeys, onWsToggle, onWsRange, onWsApplyPaths, onWsClear],
	);

	// ---- Overlay-side context ----

	const overlayValue = useMemo<TriggerDataBulkValue>(() => {
		const forInstance = (
			bundleId: BundleId,
			index: number,
		): TriggerDataBulkInstanceValue => {
			const entry = bulks.get(bulkKeyOf(bundleId, index));
			const bulkPathKeys = entry ? entry.paths : new Set<string>();
			return {
				bulkPathKeys,
				onApplyPaths: (paths, mode) => {
					writeEntry(bundleId, index, (cur) => applyPaths(cur, paths, mode));
				},
				onClear: () => {
					writeEntry(bundleId, index, () => new Set<string>());
				},
			};
		};
		return { forInstance };
	}, [bulks, writeEntry]);

	return (
		<WorkspaceTriggerDataBulkContext.Provider value={workspaceValue}>
			<TriggerDataBulkContext.Provider value={overlayValue}>
				{children}
			</TriggerDataBulkContext.Provider>
		</WorkspaceTriggerDataBulkContext.Provider>
	);
}

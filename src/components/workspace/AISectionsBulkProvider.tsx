// AISectionsBulkProvider — workspace-wide owner of the AI Sections bulk-
// select state. Sibling of `PSLBulkProvider`; the workspace mounts both and
// they coexist (their bulks are independent — selecting AI sections doesn't
// touch the PSL bulk and vice versa).
//
// The provider exposes two contexts:
//
//   - `AISectionsBulkContext` — consumed by `AISectionsOverlay` and
//     `AISectionsLegacyOverlay`. Carries the per-(bundleId, index) bulk Set
//     keyed by `selectionKey({ kind: 'section', indices: [i] })` so the
//     hook-driven `useBatchedSelection` can decide which sections to paint
//     yellow. Also exposes the click-toggle / range-extend / clear ops the
//     overlay calls when the user Ctrl/Shift-clicks a section in 3D.
//
//   - `WorkspaceAISectionsBulkContext` — consumed by `WorkspaceHierarchy`
//     and the right-sidebar `BulkPanelStack`. Surfaces the path-keyed Set
//     the tree paints amber, plus the `(bundleId, resourceKey)`-aggregated
//     count for the resource-row badge.
//
// Why the bulk persists across selection changes (deviates from PSL):
// the user's stated workflow is to bulk-select V4 sections, navigate the
// inspector to V12 WORLDCOL to compare terrain, then come back to export.
// Resetting the bulk when the inspector moves off AI Sections — which is
// what PSL does — would silently destroy the selection mid-workflow. So
// the bulk is keyed by `(bundleId, resourceKey, index)` and only clears
// when the bundle is closed or the user explicitly hits the panel's [✕].
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
import { selectionKey } from '@/components/schema-editor/viewports/selection';
import {
	parseSectionPathKey,
	rangeAddSections,
	toggleSection,
} from './aiSectionsBulk';
import type { NodePath } from '@/lib/schema/walk';
import type {
	BundleId,
	WorkspaceContextValue,
} from '@/context/WorkspaceContext.types';

const AI_KEY = 'aiSections';

// ---------------------------------------------------------------------------
// Storage shape
// ---------------------------------------------------------------------------

// Each (bundleId, index) gets its own bulk Set. The outer key is
// `${bundleId}::${index}` — both pieces are stable identifiers (bundle
// filename + Bundle-relative resource index). When a bundle is closed the
// `WorkspaceBulkWrapper` listens for the bundles list shrinking and prunes
// dead entries; see `pruneClosedBundleBulks` below.
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
// Overlay-side context — consumed by AISectionsOverlay /
// AISectionsLegacyOverlay. Each overlay instance asks for its own
// (bundleId, index) bulk so the bulk-rendering branch keeps drawing portals
// + boundary lines even when the inspector navigates AWAY from this
// overlay's resource (the "leave portals on screen" promise of Slice 1).
//
// The bulk Set surfaces in the Selection-key shape `useBatchedSelection`
// expects (`'section:5'`), not the schema-path shape the workspace stores.
// The provider does the translation per call.
// ---------------------------------------------------------------------------

export type AISectionsBulkInstanceValue = {
	/** Selection-key set for THIS (bundleId, index) instance. Empty when no
	 *  sections are in the bulk for this overlay. */
	bulkSet: ReadonlySet<string>;
	/** Toggle a section index in this instance's bulk. */
	onToggleSection: (sectionIndex: number) => void;
	/** Extend the bulk from `fromIndex` to `toIndex` inclusive. */
	onRangeSection: (fromIndex: number | null, toIndex: number) => void;
	/** Clear this instance's bulk. */
	onClear: () => void;
};

export type AISectionsBulkValue = {
	/** Resolve the bulk handle for one specific overlay instance. The
	 *  WorldViewportComposition feeds `(bundleId, index)` from the
	 *  descriptor; legacy single-resource pages can call this with their
	 *  page-scoped identity (or skip it entirely and accept an empty bulk). */
	forInstance: (bundleId: BundleId, index: number) => AISectionsBulkInstanceValue;
};

const AISectionsBulkContext = createContext<AISectionsBulkValue | null>(null);

/** Returns the workspace AI Sections bulk lookup. `null` when no provider
 *  is mounted (legacy per-resource page routes). Overlays read this once
 *  and resolve their own instance via `forInstance(bundleId, index)`. */
export function useAISectionsBulk(): AISectionsBulkValue | null {
	return useContext(AISectionsBulkContext);
}

// ---------------------------------------------------------------------------
// Workspace-side context — consumed by WorkspaceHierarchy (tree-row
// Ctrl/Shift semantics + amber decoration) and BulkPanelStack (the right-
// sidebar panel list). Carries every non-empty bulk across every loaded
// bundle, so panels survive when the user navigates away from AI Sections.
// ---------------------------------------------------------------------------

export type WorkspaceAISectionsBulkSummary = {
	bundleId: BundleId;
	index: number;
	count: number;
	lastTouchedAt: number;
	pathKeys: ReadonlySet<string>;
};

export type WorkspaceAISectionsBulkValue = {
	/** All non-empty bulks across every loaded bundle. Caller-side sort
	 *  on `lastTouchedAt` produces the panel-stack ordering. */
	summaries: readonly WorkspaceAISectionsBulkSummary[];
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
	/** Tree-row Ctrl/Shift-click bulk-toggle. Path is normalised to the
	 *  containing section; non-section paths are silently ignored. */
	onBulkToggle: (bundleId: BundleId, index: number, path: NodePath) => void;
	onBulkRange: (
		bundleId: BundleId,
		index: number,
		from: NodePath,
		to: NodePath,
	) => void;
	/** Clear the bulk for `(bundleId, index)` — drives the panel `[✕]`. */
	onClear: (bundleId: BundleId, index: number) => void;
};

const WorkspaceAISectionsBulkContext =
	createContext<WorkspaceAISectionsBulkValue | null>(null);

export function useWorkspaceAISectionsBulk(): WorkspaceAISectionsBulkValue | null {
	return useContext(WorkspaceAISectionsBulkContext);
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

function deriveSelectionKeySet(paths: ReadonlySet<string>): Set<string> {
	const out = new Set<string>();
	for (const key of paths) {
		const addr = parseSectionPathKey(key);
		if (!addr) continue;
		out.add(selectionKey({ kind: 'section', indices: [addr.sectionIndex] }));
	}
	return out;
}

export function AISectionsBulkProvider({
	bundles,
	children,
}: {
	bundles: WorkspaceContextValue['bundles'];
	children: ReactNode;
}) {
	const [bulks, setBulks] = useState<BulkMap>(() => new Map());

	// Drop entries whose bundle was closed. Reading the bundles list and
	// deriving from it keeps this side-effect-free — no useEffect, just a
	// direct reduce in render whose result is fed back via setBulks if the
	// loaded set changed. Mirrors PSL's `useResetOnChange` pattern but
	// scoped to "prune dead bundles" rather than "reset on instance switch".
	const loadedBundleIds = useMemo(() => {
		const s = new Set<BundleId>();
		for (const b of bundles) s.add(b.id);
		return s;
	}, [bundles]);
	// Prune happens lazily inside the mutation callbacks; we also do a
	// best-effort sync here whenever the loaded set narrows. The next state
	// shape comparison uses object identity so a no-op narrowing returns
	// the same Map reference.
	const prunedBulks = useMemo(
		() => pruneClosedBundleBulks(bulks, loadedBundleIds),
		[bulks, loadedBundleIds],
	);
	if (prunedBulks !== bulks) {
		// Synchronous setState during render — React documents this as legal
		// when the new value is a pure function of the old value; it triggers
		// an extra render but converges in one tick. See the React docs on
		// "Storing information from previous renders".
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
			writeEntry(bundleId, index, (paths) => toggleSection(paths, path));
		},
		[writeEntry],
	);

	const onWsRange = useCallback(
		(bundleId: BundleId, index: number, from: NodePath, to: NodePath) => {
			writeEntry(bundleId, index, (paths) => rangeAddSections(paths, from, to));
		},
		[writeEntry],
	);

	const onWsClear = useCallback(
		(bundleId: BundleId, index: number) => {
			writeEntry(bundleId, index, () => new Set<string>());
		},
		[writeEntry],
	);

	const summaries = useMemo<readonly WorkspaceAISectionsBulkSummary[]>(() => {
		const out: WorkspaceAISectionsBulkSummary[] = [];
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

	const workspaceValue = useMemo<WorkspaceAISectionsBulkValue>(
		() => ({
			summaries,
			getCount,
			getPathKeys,
			onBulkToggle: onWsToggle,
			onBulkRange: onWsRange,
			onClear: onWsClear,
		}),
		[summaries, getCount, getPathKeys, onWsToggle, onWsRange, onWsClear],
	);

	// ---- Overlay-side context ----
	//
	// Resolved per-instance via `forInstance(bundleId, index)`. The variant
	// (V12 vs legacy) is sniffed from the model so 3D-emitted toggles produce
	// paths in the right schema shape.
	const overlayValue = useMemo<AISectionsBulkValue>(() => {
		const forInstance = (
			bundleId: BundleId,
			index: number,
		): AISectionsBulkInstanceValue => {
			const entry = bulks.get(bulkKeyOf(bundleId, index));
			const bulkSet = entry ? deriveSelectionKeySet(entry.paths) : new Set<string>();
			const variant = guessVariantFromInstance(bundles, bundleId, index);

			return {
				bulkSet,
				onToggleSection: (sectionIndex: number) => {
					const path: NodePath =
						variant === 'v12'
							? ['sections', sectionIndex]
							: ['legacy', 'sections', sectionIndex];
					writeEntry(bundleId, index, (paths) => toggleSection(paths, path));
				},
				onRangeSection: (fromIndex: number | null, toIndex: number) => {
					const toPath: NodePath =
						variant === 'v12'
							? ['sections', toIndex]
							: ['legacy', 'sections', toIndex];
					const fromPath: NodePath =
						fromIndex == null
							? []
							: variant === 'v12'
								? ['sections', fromIndex]
								: ['legacy', 'sections', fromIndex];
					writeEntry(bundleId, index, (paths) =>
						rangeAddSections(paths, fromPath, toPath),
					);
				},
				onClear: () => {
					writeEntry(bundleId, index, () => new Set<string>());
				},
			};
		};
		return { forInstance };
	}, [bulks, bundles, writeEntry]);

	return (
		<WorkspaceAISectionsBulkContext.Provider value={workspaceValue}>
			<AISectionsBulkContext.Provider value={overlayValue}>
				{children}
			</AISectionsBulkContext.Provider>
		</WorkspaceAISectionsBulkContext.Provider>
	);
}

// Walk the loaded model to figure out which AI Sections variant it is. The
// V12 root is `{ kind: 'v12', sections: [...] }`; the V4/V6 root is
// `{ kind: 'v4' | 'v6', legacy: { sections: [...] } }`. We branch on the
// `legacy` field's presence — schema-shape-driven, no peeking at parser
// internals. Falls back to 'v12' for unknown shapes since that's the
// editable-path default.
function guessVariantFromInstance(
	bundles: WorkspaceContextValue['bundles'],
	bundleId: BundleId,
	index: number,
): 'v12' | 'legacy' {
	const bundle = bundles.find((b) => b.id === bundleId);
	if (!bundle) return 'v12';
	const list = bundle.parsedResourcesAll.get(AI_KEY);
	const model = list?.[index];
	if (model && typeof model === 'object' && 'legacy' in (model as object)) {
		return 'legacy';
	}
	return 'v12';
}

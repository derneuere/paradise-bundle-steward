// WorkspaceContext — implementation of the multi-Bundle Workspace described
// in WorkspaceContext.types.ts.
//
// Phase #16 (foundation slice): the provider is wired for the multi-Bundle
// shape from day one — internal storage is a list-of-EditableBundle, every
// API takes `(bundleId, key)`, history and selection are Workspace-scoped —
// but this slice still only loads ONE Bundle at a time. `loadBundle`
// replaces whatever is currently loaded, just like the legacy single-Bundle
// editor; the same-name prompt, additive load, and `closeBundle` semantics
// land in #2.
//
// What's typed and what's not: every member of WorkspaceContextValue is
// satisfied. Companion bundles (the shader-page texture sources) and the
// transient `isLoading` flag live on a sibling hook so the typed surface
// stays narrow without breaking the legacy single-Bundle pages.

import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { toast } from 'sonner';
import {
	getPlatformName,
	parseBundle,
	writeBundleFresh,
} from '@/lib/core/bundle';
import {
	getHandlerByKey,
	getHandlerByTypeId,
} from '@/lib/core/registry';
import { u64ToBigInt } from '@/lib/core/u64';
import {
	parseDebugDataFromXml,
	type DebugResource,
} from '@/lib/core/bundle/debugData';
import type { ParsedBundle, Platform } from '@/lib/core/types';
import { makeEditableBundle } from './WorkspaceContext.bundle';
import {
	canRedo as historyCanRedo,
	canUndo as historyCanUndo,
	recordCommit,
	recordRedo,
	recordUndo,
	type HistoryStack,
} from '@/lib/history';
import type {
	BundleId,
	EditableBundle,
	HistoryCommit,
	VisibilityNode,
	WorkspaceContextValue,
	WorkspaceProviderProps,
	WorkspaceSelection,
} from './WorkspaceContext.types';
import {
	applyResourceWriteToBundle,
	clearBundleDirty,
	isVisibleIn,
	visibilityKey as makeVisibilityKey,
	visibilityKeysForBundle,
} from './WorkspaceContext.helpers';

// ---------------------------------------------------------------------------
// Companion bundles — read-only "loaded alongside" bundles
// ---------------------------------------------------------------------------

// Companion bundles live OUTSIDE the typed Workspace surface — they're not
// editable, not dirty-tracked, not part of Selection / Visibility. Today the
// only consumer is ShaderPage's texture catalogue: a vehicle bundle wants
// access to WORLDTEX0.BIN's textures so the shader preview can render real
// pixels. Putting them in the typed `bundles` list would put them in the
// tree, the WorldViewport, undo, etc. — none of which makes sense for a
// "borrowed" bundle. So they ride along on a parallel field that's exposed
// via `useWorkspaceCompanion`, never via `useWorkspace`.
export type SecondaryBundle = {
	name: string;
	bundle: ParsedBundle;
	arrayBuffer: ArrayBuffer;
	debugResources: DebugResource[];
};

async function parseEditableBundle(file: File): Promise<EditableBundle> {
	const arrayBuffer = await file.arrayBuffer();
	return makeEditableBundle(arrayBuffer, file.name);
}

// ---------------------------------------------------------------------------
// Internal context value — superset of WorkspaceContextValue
// ---------------------------------------------------------------------------

type InternalValue = WorkspaceContextValue & {
	// Companion-bundle handles + transient flags. Read via dedicated hooks
	// below so the typed `useWorkspace()` surface stays exactly as documented.
	__isLoading: boolean;
	__secondaryBundles: SecondaryBundle[];
	__loadSecondaryBundle: (file: File) => Promise<void>;
	__removeSecondaryBundle: (name: string) => void;
};

const WorkspaceContext = createContext<InternalValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
	const [bundles, setBundles] = useState<EditableBundle[]>([]);
	const [selection, setSelection] = useState<WorkspaceSelection>(null);
	const [visibility, setVisibility] = useState<Map<string, boolean>>(
		() => new Map(),
	);
	// Single global history stack — one per ADR-0006. Entries are pushed on
	// every setResource/setResourceAt; `future` is the redo branch.
	const [history, setHistory] = useState<HistoryStack<HistoryCommit>>(() => ({
		past: [],
		future: [],
	}));
	const [isLoading, setIsLoading] = useState(false);
	const [secondaryBundles, setSecondaryBundles] = useState<SecondaryBundle[]>([]);

	// Bundle helpers ---------------------------------------------------------

	const getBundle = useCallback(
		(bundleId: BundleId) => bundles.find((b) => b.id === bundleId),
		[bundles],
	);

	const replaceBundle = useCallback(
		(bundleId: BundleId, updater: (bundle: EditableBundle) => EditableBundle) => {
			setBundles((prev) =>
				prev.map((b) => (b.id === bundleId ? updater(b) : b)),
			);
		},
		[],
	);

	// Resource access --------------------------------------------------------

	const getResource = useCallback(
		<T,>(bundleId: BundleId, key: string): T | null => {
			const b = bundles.find((x) => x.id === bundleId);
			if (!b) return null;
			return ((b.parsedResources.get(key) as T | undefined) ?? null);
		},
		[bundles],
	);

	const getResources = useCallback(
		<T,>(bundleId: BundleId, key: string): readonly (T | null)[] => {
			const b = bundles.find((x) => x.id === bundleId);
			if (!b) return [];
			return ((b.parsedResourcesAll.get(key) as (T | null)[] | undefined) ?? []);
		},
		[bundles],
	);

	// Single internal write funnel for all model edits — delegates to the
	// pure reducer in WorkspaceContext.helpers so the user-edit and undo-
	// restore paths share one definition of "what an edit looks like."
	const applyResourceValue = useCallback(
		(bundleId: BundleId, key: string, index: number, next: unknown | null) => {
			replaceBundle(bundleId, (b) => applyResourceWriteToBundle(b, key, index, next));
		},
		[replaceBundle],
	);

	const setResourceAt = useCallback(
		<T,>(bundleId: BundleId, key: string, index: number, value: T) => {
			const b = bundles.find((x) => x.id === bundleId);
			if (!b) return;
			const previous = b.parsedResourcesAll.get(key)?.[index] ?? null;
			setHistory((prev) =>
				recordCommit<HistoryCommit>(prev, {
					bundleId,
					resourceKey: key,
					index,
					previous,
					next: value as unknown,
				}),
			);
			applyResourceValue(bundleId, key, index, value);
		},
		[bundles, applyResourceValue],
	);

	const setResource = useCallback(
		<T,>(bundleId: BundleId, key: string, value: T) =>
			setResourceAt(bundleId, key, 0, value),
		[setResourceAt],
	);

	// Selection --------------------------------------------------------------

	const select = useCallback((next: WorkspaceSelection) => {
		setSelection(next);
	}, []);

	// Visibility -------------------------------------------------------------

	const isVisible = useCallback(
		(node: VisibilityNode): boolean => isVisibleIn(visibility, node),
		[visibility],
	);

	const setVisibilityFn = useCallback(
		(node: VisibilityNode, visible: boolean) => {
			const key = makeVisibilityKey(node);
			setVisibility((prev) => {
				const next = new Map(prev);
				next.set(key, visible);
				return next;
			});
		},
		[],
	);

	// Undo / redo ------------------------------------------------------------

	const undo = useCallback(() => {
		setHistory((prev) => {
			const top = prev.past[prev.past.length - 1];
			if (!top) return prev;
			// Read the current value from the live bundles array — same
			// reasoning as in BundleContext: the source of truth is the model
			// store, not the history stack, so non-tracked replaces (load,
			// save) don't desync.
			const live = bundles.find((b) => b.id === top.bundleId);
			const actualCurrent: HistoryCommit = {
				bundleId: top.bundleId,
				resourceKey: top.resourceKey,
				index: top.index,
				previous: top.previous,
				next: live?.parsedResourcesAll.get(top.resourceKey)?.[top.index] ?? null,
			};
			const out = recordUndo(prev, actualCurrent);
			if (!out) return prev;
			applyResourceValue(top.bundleId, top.resourceKey, top.index, top.previous);
			return out.stack;
		});
	}, [bundles, applyResourceValue]);

	const redo = useCallback(() => {
		setHistory((prev) => {
			const head = prev.future[0];
			if (!head) return prev;
			const live = bundles.find((b) => b.id === head.bundleId);
			const actualCurrent: HistoryCommit = {
				bundleId: head.bundleId,
				resourceKey: head.resourceKey,
				index: head.index,
				previous: live?.parsedResourcesAll.get(head.resourceKey)?.[head.index] ?? null,
				next: head.next,
			};
			const out = recordRedo(prev, actualCurrent);
			if (!out) return prev;
			applyResourceValue(head.bundleId, head.resourceKey, head.index, head.next);
			return out.stack;
		});
	}, [bundles, applyResourceValue]);

	const canUndo = historyCanUndo(history);
	const canRedo = historyCanRedo(history);

	// Load / close / save ----------------------------------------------------

	const loadBundle = useCallback(async (file: File) => {
		setIsLoading(true);
		try {
			const next = await parseEditableBundle(file);
			// Phase #16: open replaces. The same-name prompt and additive
			// multi-Bundle load land in #2.
			setBundles([next]);
			setSelection(null);
			setVisibility(new Map());
			setHistory({ past: [], future: [] });
			toast.success(`Loaded bundle: ${file.name}`, {
				description: `${next.parsed.resources.length} resources found, Platform: ${getPlatformName(next.parsed.header.platform)}`,
			});
		} catch (error) {
			console.error('Error parsing bundle:', error);
			toast.error('Failed to parse bundle file', {
				description: error instanceof Error ? error.message : 'Unknown error occurred',
			});
		} finally {
			setIsLoading(false);
		}
	}, []);

	const closeBundle = useCallback(async (bundleId: BundleId) => {
		setBundles((prev) => prev.filter((b) => b.id !== bundleId));
		// Drop selection / visibility / history entries that referenced the
		// closed Bundle. History prunes to keep undo coherent — restoring a
		// closed Bundle's previous value would resurrect the Bundle silently.
		setSelection((prev) => (prev?.bundleId === bundleId ? null : prev));
		setVisibility((prev) => {
			const dropped = visibilityKeysForBundle(prev, bundleId);
			if (dropped.length === 0) return prev;
			const next = new Map(prev);
			for (const key of dropped) next.delete(key);
			return next;
		});
		setHistory((prev) => ({
			past: prev.past.filter((c) => c.bundleId !== bundleId),
			future: prev.future.filter((c) => c.bundleId !== bundleId),
		}));
	}, []);

	const saveBundle = useCallback(
		async (bundleId: BundleId, targetPlatform?: number) => {
			const b = bundles.find((x) => x.id === bundleId);
			if (!b) {
				toast.error('Bundle not found');
				return;
			}
			try {
				// Two override paths emitted in parallel — same logic as the
				// pre-Workspace exporter. See BundleContext for the long
				// explanation; the short version is "edited resources become
				// per-id overrides, untouched ones pass through byte-exact."
				const byResourceId = buildByResourceIdOverrides(
					b.parsed,
					b.parsedResourcesAll,
					b.dirtyMulti,
				);

				const filteredSingleResource = new Map<string, unknown>();
				for (const [k, model] of b.parsedResources) {
					if (b.dirtyMulti.has(`${k}:0`)) filteredSingleResource.set(k, model);
				}

				const outBuffer = writeBundleFresh(
					b.parsed,
					b.originalArrayBuffer,
					{
						includeDebugData: true,
						platform: targetPlatform as Platform | undefined,
						overrides: {
							resources: keyedOverridesToTypeIdMap(filteredSingleResource),
							byResourceId,
						},
					},
				);

				const blob = new Blob([outBuffer], { type: 'application/octet-stream' });
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				// Save back to the original filename — see CONTEXT.md /
				// "Bundle filename." Game references files by name; renaming
				// is not a validated capability, so the download keeps the
				// load-time identifier.
				a.download = b.id;
				document.body.appendChild(a);
				a.click();
				a.remove();
				setTimeout(() => URL.revokeObjectURL(url), 0);

				// Clear dirty bookkeeping on the saved Bundle. History stays —
				// the user can still undo edits made before the save.
				replaceBundle(bundleId, clearBundleDirty);

				toast.success('Exported bundle', {
					description: `Size: ${(outBuffer.byteLength / 1024).toFixed(1)} KB`,
				});
			} catch (error) {
				console.error('Error exporting bundle:', error);
				toast.error('Failed to export bundle', {
					description: error instanceof Error ? error.message : 'Unknown error',
				});
			}
		},
		[bundles, replaceBundle],
	);

	const saveAll = useCallback(async () => {
		for (const b of bundles) {
			if (b.isModified) await saveBundle(b.id);
		}
	}, [bundles, saveBundle]);

	// Companion bundles ------------------------------------------------------

	const loadSecondaryBundle = useCallback(async (file: File) => {
		try {
			const arrayBuffer = await file.arrayBuffer();
			const bundle = parseBundle(arrayBuffer);
			const debugResources = bundle.debugData
				? parseDebugDataFromXml(bundle.debugData)
				: [];
			setSecondaryBundles((prev) => {
				const filtered = prev.filter((b) => b.name !== file.name);
				return [...filtered, { name: file.name, bundle, arrayBuffer, debugResources }];
			});
			const textureCount = bundle.resources.filter(
				(r) => r.resourceTypeId === 0x0,
			).length;
			toast.success(`Loaded companion bundle: ${file.name}`, {
				description: `${bundle.resources.length} resources (${textureCount} textures)`,
			});
		} catch (error) {
			toast.error('Failed to parse companion bundle', {
				description: error instanceof Error ? error.message : 'Unknown',
			});
		}
	}, []);

	const removeSecondaryBundle = useCallback((name: string) => {
		setSecondaryBundles((prev) => prev.filter((b) => b.name !== name));
	}, []);

	// Memoise the public value to keep consumers stable when only secondary
	// state moves. Internal extras are tagged with `__` — they're an
	// implementation detail of the companion-state hooks below.
	const value = useMemo<InternalValue>(
		() => ({
			bundles,
			getBundle,
			loadBundle,
			closeBundle,
			saveBundle,
			saveAll,
			getResource,
			getResources,
			setResource,
			setResourceAt,
			selection,
			select,
			isVisible,
			setVisibility: setVisibilityFn,
			canUndo,
			canRedo,
			undo,
			redo,
			__isLoading: isLoading,
			__secondaryBundles: secondaryBundles,
			__loadSecondaryBundle: loadSecondaryBundle,
			__removeSecondaryBundle: removeSecondaryBundle,
		}),
		[
			bundles,
			getBundle,
			loadBundle,
			closeBundle,
			saveBundle,
			saveAll,
			getResource,
			getResources,
			setResource,
			setResourceAt,
			selection,
			select,
			isVisible,
			setVisibilityFn,
			canUndo,
			canRedo,
			undo,
			redo,
			isLoading,
			secondaryBundles,
			loadSecondaryBundle,
			removeSecondaryBundle,
		],
	);

	return (
		<WorkspaceContext.Provider value={value}>
			{children}
		</WorkspaceContext.Provider>
	);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useWorkspace(): WorkspaceContextValue {
	const ctx = useContext(WorkspaceContext);
	if (!ctx) {
		throw new Error('useWorkspace must be used within a WorkspaceProvider');
	}
	return ctx;
}

/**
 * Companion-bundle handles plus the transient `isLoading` flag. Kept
 * separate from `useWorkspace()` so the typed Workspace surface stays
 * exactly as documented in WorkspaceContext.types.ts. ShaderPage and the
 * BundleLayout's load-spinner are the consumers today.
 */
export function useWorkspaceCompanion(): {
	isLoading: boolean;
	secondaryBundles: SecondaryBundle[];
	loadSecondaryBundle: (file: File) => Promise<void>;
	removeSecondaryBundle: (name: string) => void;
} {
	const ctx = useContext(WorkspaceContext);
	if (!ctx) {
		throw new Error('useWorkspaceCompanion must be used within a WorkspaceProvider');
	}
	return {
		isLoading: ctx.__isLoading,
		secondaryBundles: ctx.__secondaryBundles,
		loadSecondaryBundle: ctx.__loadSecondaryBundle,
		removeSecondaryBundle: ctx.__removeSecondaryBundle,
	};
}

/**
 * Convenience hook for legacy single-Bundle pages and layouts: returns the
 * first loaded Bundle's id, or null if the Workspace is empty. Pages that
 * still operate on "the" loaded Bundle (every per-resource page right now)
 * use this to feed `bundleId` into the Bundle-keyed resource APIs without
 * threading it through a prop chain.
 *
 * This is a *single-Bundle convenience*, not an "active Bundle" fallback —
 * once #2 lands additive load and the WorkspaceEditor manages selection
 * across many Bundles, the legacy pages will still pin to bundles[0] (the
 * single-Bundle workflow stays single-Bundle), and the WorkspaceEditor
 * itself won't use this hook at all.
 */
export function useActiveBundleId(): BundleId | null {
	const { bundles } = useWorkspace();
	return bundles[0]?.id ?? null;
}

// Effect helper used by some pages to react to bundle changes. Kept here
// so the import surface is symmetrical with `useWorkspace`.
export function useActiveBundle(): EditableBundle | null {
	const { bundles } = useWorkspace();
	return bundles[0] ?? null;
}

// ---------------------------------------------------------------------------
// Internal helpers — exporter override builders
// ---------------------------------------------------------------------------

function keyedOverridesToTypeIdMap(map: Map<string, unknown>): Record<number, unknown> {
	const out: Record<number, unknown> = {};
	for (const [key, model] of map) {
		const handler = getHandlerByKey(key);
		if (!handler || !handler.caps.write) continue;
		out[handler.typeId] = model;
	}
	return out;
}

function buildByResourceIdOverrides(
	bundle: ParsedBundle,
	parsedResourcesAll: Map<string, (unknown | null)[]>,
	dirty: Set<string>,
): Record<string, unknown> {
	if (dirty.size === 0) return {};
	const out: Record<string, unknown> = {};
	const typeCounters = new Map<number, number>();
	for (const resource of bundle.resources) {
		const typeId = resource.resourceTypeId;
		const nBefore = typeCounters.get(typeId) ?? 0;
		typeCounters.set(typeId, nBefore + 1);

		const handler = getHandlerByTypeId(typeId);
		if (!handler || !handler.caps.write) continue;
		if (!dirty.has(`${handler.key}:${nBefore}`)) continue;
		const list = parsedResourcesAll.get(handler.key);
		if (!list) continue;
		const model = list[nBefore];
		if (model == null) continue;

		const idHex = `0x${u64ToBigInt(resource.resourceId)
			.toString(16)
			.toUpperCase()
			.padStart(16, '0')}`;
		out[idHex] = model;
	}
	return out;
}

// Silence dead-import warnings if a future refactor stops using one of
// these — keeps the diff minimal when adding/removing exports.
void useEffect;
void useRef;

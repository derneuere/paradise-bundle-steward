// WorkspaceContext — the editor session that holds one or more editable
// Bundles, evolved from the single-Bundle BundleContext that ships today.
//
// This file holds the *interface* — the shape of the React context value, the
// supporting types, and the per-Bundle data record. Implementation lives in
// WorkspaceContext.tsx (TODO: not yet written; this types file is the design
// artefact for the multi-Bundle refactor).
//
// Vocabulary in CONTEXT.md: Workspace, Bundle, Bundle addressing, Bundle
// filename, Visibility, Selection, Tools, Workspace editor.
//
// Load-bearing decisions are recorded as ADRs and should not be re-litigated
// without re-reading them:
//
//   - docs/adr/0001 — WorldViewport overlay selection currency is `NodePath`.
//                     Overlays still emit bare paths; the WorkspaceEditor
//                     wraps the emit to inject `bundleId` for Selection.
//   - docs/adr/0002 — WorldViewport overlays receive resource data via React
//                     props. PolygonSoupListOverlay's documented exception
//                     (ADR-0004) becomes a Workspace-aware lookup.
//   - docs/adr/0005 — Saves remain browser downloads; File System Access API
//                     deferred. Each `saveBundle` call triggers a download.
//   - docs/adr/0006 — Workspace undo/redo is a single global stack. ⌘Z
//                     undoes the most recent edit anywhere in the Workspace,
//                     replacing the per-(handlerKey, index) stacks the
//                     pre-Workspace editor used.
//
// Usage shape:
//
//   const { bundles, getResource, setResourceAt, selection, select,
//           isVisible, setVisibility, undo, redo, saveBundle, saveAll }
//     = useWorkspace();
//
//   // Read a single-instance resource from a specific Bundle:
//   const ai = getResource<ParsedAISections>(bundleId, 'aiSections');
//
//   // Cross-Bundle click in the WorldViewport: page wraps the overlay's
//   // bare-NodePath emit and forwards to the Workspace-level Selection.
//   <AISectionsOverlay
//     data={ai}
//     selectedPath={selectionPathFor(bundleId)}
//     onSelect={(path) => select({ bundleId, path })}
//   />

import type { ParsedBundle } from '@/lib/core/types';
import type { DebugResource } from '@/lib/core/bundle/debugData';
import type { UIResource } from '@/lib/core/bundle';
import type { NodePath } from '@/lib/schema/walk';

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * A Bundle's identity throughout Steward — its on-disk filename. Treated as
 * immutable: every save writes back to this exact name (the game references
 * files by name, see CONTEXT.md / "Bundle filename"). The Workspace forbids
 * loading two Bundles with the same `BundleId`; same-name re-loads prompt
 * Replace / Cancel.
 */
export type BundleId = string;

/**
 * Key shape for per-(handlerKey, index) maps within a single Bundle —
 * `${handlerKey}:${index}`. Matches the existing `dirtyMulti` convention.
 * Index 0 for single-instance resources; 0..N for multi-instance types
 * (PolygonSoupList, etc.).
 */
export type DirtyKey = string;

// ---------------------------------------------------------------------------
// EditableBundle — one entry in the Workspace's `bundles` list
// ---------------------------------------------------------------------------

/**
 * A single Bundle as it lives in the Workspace. Each EditableBundle is
 * independently editable, independently dirty-tracked, independently saved.
 *
 * Keeping `originalArrayBuffer` per Bundle is what makes byte-exact
 * pass-through writes possible: untouched resources serialise from the
 * original bytes; only `dirtyMulti` entries take the re-encode path.
 */
export type EditableBundle = {
	/** Filename / canonical identifier. */
	id: BundleId;

	/** The full original file bytes — needed for the byte-exact pass-through writer. */
	originalArrayBuffer: ArrayBuffer;

	/** Parsed bundle (header + resource list, format-agnostic). */
	parsed: ParsedBundle;

	/** UI-formatted resource list — names, sizes, types — for display in trees / tables. */
	resources: UIResource[];

	/** XML-parsed debug names from the bundle's debug section, if present. */
	debugResources: DebugResource[];

	/**
	 * Single-instance parsed resources, keyed by `handlerKey`. The "primary"
	 * model per resource type — equivalent to today's `parsedResources` but
	 * scoped to this Bundle.
	 */
	parsedResources: Map<string, unknown>;

	/**
	 * Multi-instance parsed resources, keyed by `handlerKey`. Each entry is
	 * the array of every parsed instance for that resource type (e.g. all
	 * PolygonSoupList resources in this Bundle).
	 */
	parsedResourcesAll: Map<string, (unknown | null)[]>;

	/**
	 * Per-`(handlerKey, index)` dirty set. An entry is added on `setResourceAt`,
	 * cleared on save. Drives the multi-resource export path: only dirty
	 * entries become re-encode overrides, untouched ones pass through.
	 */
	dirtyMulti: Set<DirtyKey>;

	/**
	 * Bundle-wide modified flag — true if any resource in this Bundle has
	 * been edited since load (or since the most recent save). Used by the
	 * tree's per-Bundle dirty indicator and to disable the Save button when
	 * clean.
	 */
	isModified: boolean;
};

// ---------------------------------------------------------------------------
// Selection — what the Tools / inspector are focused on
// ---------------------------------------------------------------------------

/**
 * A focus into one node of the unified Workspace hierarchy (ADR-0007). The
 * unified tree spans four selectable levels — `resourceKey` and `index` are
 * left undefined to encode the coarser levels:
 *
 *   - **Bundle**: `{ bundleId, path: [] }` — `resourceKey`, `index` undefined.
 *     Inspector renders Bundle metadata.
 *   - **Resource type** (multi-instance): `{ bundleId, resourceKey, path: [] }` —
 *     `index` undefined. Inspector renders the instance list. Single-instance
 *     resources never produce this level — clicking the only row jumps
 *     straight to the Instance level (there is no `[N]` to pick from).
 *   - **Instance**: `{ bundleId, resourceKey, index, path: [] }`. Inspector
 *     renders the schema-root form via SchemaEditorProvider + InspectorPanel.
 *   - **Schema**: `{ bundleId, resourceKey, index, path: [...non-empty] }` —
 *     drilled into a sub-path inside an instance. Inspector renders the
 *     field form for that path.
 *
 * `null` means nothing is focused — inspector is empty, type-specific Tools
 * hide. There is *no* "active Bundle" concept independent of Selection — the
 * selected resource's Bundle is the only sense in which a Bundle is "active."
 */
export type WorkspaceSelection = {
	bundleId: BundleId;
	/** Undefined for Bundle-level selection. */
	resourceKey?: string;
	/** Undefined for Bundle / Resource-type-level selection. 0..N for instance-level. */
	index?: number;
	/** Sub-path inside the resource. Empty array means "the resource/instance root."
	 *  Always `[]` for Bundle and Resource-type-level selections. */
	path: NodePath;
} | null;

/**
 * Discriminated view of a non-null selection — derive once and switch on
 * `kind`. Cheaper than re-checking optional fields at every consumer.
 */
export type SelectionLevel = 'bundle' | 'resourceType' | 'instance' | 'schema';

export function selectionLevel(selection: WorkspaceSelection): SelectionLevel | null {
	if (!selection) return null;
	if (selection.resourceKey === undefined) return 'bundle';
	if (selection.index === undefined) return 'resourceType';
	if (selection.path.length === 0) return 'instance';
	return 'schema';
}

// ---------------------------------------------------------------------------
// Visibility — what contributes to the WorldViewport scene
// ---------------------------------------------------------------------------

/**
 * Addresses any node in the Workspace tree that can be toggled visible/hidden.
 * Coarser nodes cascade to their descendants when toggled.
 *
 *   { bundleId }                          — the whole Bundle (cascades to all its resources)
 *   { bundleId, resourceKey }             — every instance of one resource type in one Bundle
 *   { bundleId, resourceKey, index }      — one specific instance (e.g. one PolygonSoupList)
 */
export type VisibilityNode =
	| { bundleId: BundleId }
	| { bundleId: BundleId; resourceKey: string }
	| { bundleId: BundleId; resourceKey: string; index: number };

// ---------------------------------------------------------------------------
// History — the single global Workspace undo/redo stack (ADR-0006)
// ---------------------------------------------------------------------------

/**
 * One entry in the Workspace's global history stack. Records the (Bundle,
 * resource, instance) that was edited and the before/after snapshots needed
 * to step in either direction.
 *
 * The single global stack replaces the pre-Workspace per-`(handlerKey, index)`
 * stacks — see ADR-0006 for the rationale.
 */
export type HistoryCommit = {
	bundleId: BundleId;
	resourceKey: string;
	index: number;
	previous: unknown | null;
	next: unknown | null;
};

// ---------------------------------------------------------------------------
// WorkspaceContextValue — the React context API surface
// ---------------------------------------------------------------------------

export type WorkspaceContextValue = {
	// -------------------------------------------------------------------------
	// Bundles
	// -------------------------------------------------------------------------

	/** Every loaded Bundle. Order is load order. */
	bundles: readonly EditableBundle[];

	/** Lookup helper. Returns undefined if the BundleId isn't loaded. */
	getBundle: (bundleId: BundleId) => EditableBundle | undefined;

	/**
	 * Add a Bundle to the Workspace. Parses the file, registers the result.
	 *
	 * If a Bundle with the same filename is already loaded, surfaces a Replace
	 * / Cancel prompt to the user before proceeding (see CONTEXT.md /
	 * "Bundle filename"). Resolves once the prompt is answered and the
	 * resulting action completes.
	 */
	loadBundle: (file: File) => Promise<void>;

	/**
	 * Remove a Bundle from the Workspace. Warns the user if the Bundle is
	 * dirty (`isModified === true`). Clears any Selection / Visibility /
	 * history entries that referenced it.
	 */
	closeBundle: (bundleId: BundleId) => Promise<void>;

	/**
	 * Save one Bundle to a download with its original filename (ADR-0005).
	 * `targetPlatform` lets the writer cross-compile (PC → X360, etc.); omit
	 * to save in the source platform.
	 */
	saveBundle: (bundleId: BundleId, targetPlatform?: number) => Promise<void>;

	/**
	 * Save every dirty Bundle (each as its own download). Equivalent to
	 * iterating `bundles` and calling `saveBundle` for any with
	 * `isModified === true`.
	 */
	saveAll: () => Promise<void>;

	// -------------------------------------------------------------------------
	// Resource access — always Bundle-scoped (see CONTEXT.md / "Bundle addressing")
	// -------------------------------------------------------------------------

	/** Read a single-instance resource. Returns null if the Bundle doesn't have one. */
	getResource: <T>(bundleId: BundleId, key: string) => T | null;

	/** Read every instance of a multi-instance resource (PolygonSoupList, etc.). */
	getResources: <T>(bundleId: BundleId, key: string) => readonly (T | null)[];

	/**
	 * Replace a single-instance resource. Adds a `HistoryCommit` to the
	 * global stack, marks the (handlerKey, 0) dirty, sets the Bundle's
	 * `isModified` flag.
	 */
	setResource: <T>(bundleId: BundleId, key: string, value: T) => void;

	/**
	 * Replace one instance of a multi-instance resource. Same history /
	 * dirty bookkeeping as `setResource`.
	 */
	setResourceAt: <T>(
		bundleId: BundleId,
		key: string,
		index: number,
		value: T,
	) => void;

	// -------------------------------------------------------------------------
	// Selection — drives Tools / inspector (CONTEXT.md / "Selection")
	// -------------------------------------------------------------------------

	selection: WorkspaceSelection;

	/** Set or clear the Selection. Pass `null` to deselect. */
	select: (next: WorkspaceSelection) => void;

	// -------------------------------------------------------------------------
	// Visibility — drives WorldViewport scene composition (CONTEXT.md / "Visibility")
	// -------------------------------------------------------------------------

	/**
	 * True if `node` would render in the WorldViewport. Walks the cascade
	 * (toggling a Bundle off makes every descendant return false unless
	 * explicitly re-enabled). Always true for nodes the Visibility map has
	 * never seen — the default is visible.
	 */
	isVisible: (node: VisibilityNode) => boolean;

	/**
	 * Toggle a node visible or hidden. Cascades — hiding a `{ bundleId }`
	 * node hides every resource and every instance under it for the
	 * `isVisible` query, regardless of prior per-instance toggles.
	 */
	setVisibility: (node: VisibilityNode, visible: boolean) => void;

	/**
	 * Solo `node`: hide every peer at the same scope inside the same Bundle
	 * (Bundle never crosses Bundles), force-show the soloed node's ancestors
	 * so it's guaranteed to render, and clear any stale `false` on the node
	 * itself. A second call on the already-soloed node restores full
	 * visibility within scope. Drives the alt+click gesture on the unified
	 * Workspace tree (issue #26).
	 */
	soloVisibility: (node: VisibilityNode) => void;

	// -------------------------------------------------------------------------
	// Undo/redo — single global Workspace stack (ADR-0006)
	// -------------------------------------------------------------------------

	canUndo: boolean;
	canRedo: boolean;

	/** Step back one HistoryCommit. No-op when `canUndo === false`. */
	undo: () => void;

	/** Step forward one HistoryCommit. No-op when `canRedo === false`. */
	redo: () => void;
};

// ---------------------------------------------------------------------------
// Component / hook signatures
// ---------------------------------------------------------------------------

/**
 * The Provider component wrapping the React tree. Owns the Workspace state,
 * the global history, and the file-load / save side effects.
 *
 * Implementation lives in `./WorkspaceContext.tsx` (TODO).
 */
export type WorkspaceProviderProps = {
	children: import('react').ReactNode;
};

/**
 * The hook every consumer uses. Throws if called outside a `WorkspaceProvider`.
 *
 * Implementation lives in `./WorkspaceContext.tsx` (TODO).
 */
export type UseWorkspace = () => WorkspaceContextValue;

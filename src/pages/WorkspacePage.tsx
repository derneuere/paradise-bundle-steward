// WorkspaceEditor — three-pane editor for the multi-Bundle Workspace.
//
// Phase #17 (multi-Bundle slice): the tree is a list of Bundle nodes,
// each with its own resources nested below. Per-Bundle dirty indicator,
// Save, and close (×) live on the Bundle row. The toolbar adds an
// "Add Bundle" affordance plus a "Save All" command.
//
// Phase #18 (multi-Bundle WorldViewport composition): the centre pane's
// <WorldViewport> hosts overlays from EVERY loaded Bundle simultaneously.
// Two Bundles loaded → potentially many overlay children, all in one
// shared scene. Cross-Bundle clicks update the Selection only — the URL
// doesn't change and the WorldViewport doesn't remount.
//
// Phase #19 (Visibility tree toggles): every Bundle / Resource / multi-
// instance row in the tree gets an eye-icon toggle (except resources in
// the Standard-viewport family — challenge list, vehicle list, etc. —
// which have no scene contribution). The cascade lives in
// WorkspaceContext: hiding a Bundle hides every descendant for the
// `isVisible` query, regardless of per-instance overrides. The
// composition layer drops every overlay whose `(bundleId, resourceKey,
// index)` reads as hidden — the WorldViewport receives only what's
// visible. Selection is independent of Visibility (CONTEXT.md /
// "Selection"): a hidden-but-selected resource keeps its inspector / Tools.
//
//   ┌──────────────────────┬───────────────────────┬──────────────────┐
//   │  Workspace tree      │  WorldViewport host   │  Inspector       │
//   │  (left)              │  (centre)             │  (right)         │
//   │                      │                       │                  │
//   │  ▾ TRK_UNIT_07.BUN ●  │  three.js scene;      │  Schema-driven   │
//   │     ├ aiSec…          │  every loaded         │  form for the    │
//   │     ├ trgr…           │  Bundle's overlays    │  selected node   │
//   │     └ stre…           │  render here in a     │  (or generic     │
//   │  ▾ WORLDCOL.BIN       │  single scene.        │  empty state).   │
//   │     ├ pSoupList #0    │                       │                  │
//   │     └ pSoupList #1    │                       │                  │
//   │  + Add Bundle         │                       │                  │
//   └──────────────────────┴───────────────────────┴──────────────────┘

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import {
	ChevronDown,
	ChevronRight,
	Eye,
	EyeOff,
	Folder,
	FileText,
	Plus,
	Save,
	X,
} from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { HierarchyTree } from '@/components/schema-editor/HierarchyTree';
import { InspectorPanel } from '@/components/schema-editor/InspectorPanel';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { ViewportPane } from '@/components/schema-editor/ViewportPane';
import { ViewportErrorBoundary } from '@/components/common/ViewportErrorBoundary';
import {
	WorldViewportComposition,
	isWorldViewportFamilyKey,
} from '@/components/workspace/WorldViewportComposition';
import type { VisibilityNode } from '@/context/WorkspaceContext.types';
import { UndoRedoControls } from '@/components/UndoRedoControls';
import { useWorkspaceUndoRedoShortcuts } from '@/hooks/useWorkspaceUndoRedoShortcuts';
import { getSchemaByKey } from '@/lib/schema/resources';
import { getHandlerByKey } from '@/lib/core/registry';
import { aiSectionsExtensions } from '@/components/schema-editor/extensions/aiSectionsExtensions';
import { challengeListExtensions } from '@/components/schema-editor/extensions/challengeListExtensions';
import { polygonSoupListExtensions } from '@/components/schema-editor/extensions/collisionTagExtension';
import { renderableExtensions } from '@/components/schema-editor/extensions/renderableExtensions';
import { streetDataExtensions } from '@/components/schema-editor/extensions/streetDataExtensions';
import { trafficDataExtensions } from '@/components/schema-editor/extensions/trafficDataExtensions';
import { triggerDataExtensions } from '@/components/schema-editor/extensions/triggerDataExtensions';
import { vehicleListExtensions } from '@/components/schema-editor/extensions/vehicleListExtensions';
import type { ExtensionRegistry } from '@/components/schema-editor/context';
import type { NodePath } from '@/lib/schema/walk';
import type { EditableBundle } from '@/context/WorkspaceContext.types';
import {
	hasNavigableSchemaDepth,
	makeSchemaSelectionPathHandler,
} from './WorkspacePage.helpers';

// Extension registry per resource key. Mirrors what each per-resource page
// passes to its `SchemaEditorProvider`, so the workspace inspector renders
// the same tabs / custom panels users see on the legacy routes.
const EXTENSIONS_BY_KEY: Record<string, ExtensionRegistry> = {
	aiSections: aiSectionsExtensions,
	challengeList: challengeListExtensions,
	polygonSoupList: polygonSoupListExtensions,
	renderable: renderableExtensions,
	streetData: streetDataExtensions,
	trafficData: trafficDataExtensions,
	triggerData: triggerDataExtensions,
	vehicleList: vehicleListExtensions,
};

// ---------------------------------------------------------------------------
// Visibility — toggle UX
// ---------------------------------------------------------------------------

// A Visibility toggle is meaningful only for resources that contribute to the
// WorldViewport scene (CONTEXT.md / "Visibility"). Standard-viewport-family
// resources (challenge list, vehicle list, attrib sys vault, etc.) and
// non-world viewports (renderable, texture) have no scene contribution in
// the Workspace's WorldViewport, so their tree rows skip the eye icon.
function isVisibilityRelevantKey(key: string): boolean {
	return isWorldViewportFamilyKey(key);
}

// True if any resource in this Bundle has a Visibility-relevant node — used
// to hide the Bundle-level toggle for Bundles that contain only Standard /
// non-world resources, where the toggle would be a no-op.
function bundleHasVisibilityRelevantResource(
	bundle: EditableBundle,
): boolean {
	for (const [key, list] of bundle.parsedResourcesAll) {
		if (!isVisibilityRelevantKey(key)) continue;
		if (list.some((m) => m != null)) return true;
	}
	return false;
}

function VisibilityToggle({
	node,
	label,
}: {
	node: VisibilityNode;
	label: string;
}) {
	const { isVisible, setVisibility } = useWorkspace();
	const visible = isVisible(node);
	const onClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			setVisibility(node, !visible);
		},
		[node, visible, setVisibility],
	);
	return (
		<button
			type="button"
			onClick={onClick}
			className="shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
			title={visible ? `Hide ${label}` : `Show ${label}`}
			aria-label={visible ? `Hide ${label}` : `Show ${label}`}
			aria-pressed={visible}
		>
			{visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 opacity-60" />}
		</button>
	);
}

// ---------------------------------------------------------------------------
// Selected-resource schema subtree (issue #21)
// ---------------------------------------------------------------------------
//
// Integration-shape choice (HITL note from the issue): we picked option A —
// hoist a small "selected-resource hierarchy" sub-component into the tree
// pane, rendered nested under the matching ResourceRow, with its OWN
// SchemaEditorProvider scoped to the selected resource. The right-side
// SelectedResourceShell still mounts its own provider for Scene + Inspector;
// both providers are controlled by `WorkspaceContext.selection.path`, so a
// click in either tree updates the same global selection and the other side
// follows.
//
// We didn't pick option B (render the tree pane inside SelectedResourceShell's
// render-prop) because that mounts the provider conditionally above the tree
// pane — toggling between "no selection" and "selected" changes the tree
// pane's React parent (Fragment vs Provider), forcing WorkspaceTree to
// remount and losing its bundle expand/collapse state. Two providers cost a
// duplicate context dispatch on every selection move (cheap), but the tree
// pane stays mounted across selection changes.

function SelectedSchemaSubtree() {
	const { bundles, selection, select, setResourceAt } = useWorkspace();

	const selectedBundle = useMemo(
		() => (selection ? bundles.find((b) => b.id === selection.bundleId) : undefined),
		[bundles, selection],
	);
	const schema = selection ? getSchemaByKey(selection.resourceKey) : undefined;
	const data = useMemo(() => {
		if (!selection || !selectedBundle) return undefined;
		const list = selectedBundle.parsedResourcesAll.get(selection.resourceKey);
		return list?.[selection.index] ?? undefined;
	}, [selection, selectedBundle]);

	const onChange = useCallback(
		(next: unknown) => {
			if (!selection) return;
			setResourceAt(selection.bundleId, selection.resourceKey, selection.index, next);
		},
		[selection, setResourceAt],
	);

	const setPath = useMemo(
		() => makeSchemaSelectionPathHandler(selection, select),
		[selection, select],
	);

	if (!selection || !schema || data === undefined) return null;
	if (!hasNavigableSchemaDepth(schema)) return null;

	// Bounded height keeps HierarchyTree's virtualizer happy (it needs a
	// scrollable parent with finite height) while leaving the workspace-tree
	// scroll above it intact. The min-h floor stops the tree from collapsing
	// to nothing when several Bundles are loaded and the pane is short.
	return (
		<div
			className="border-t border-b bg-muted/10 flex flex-col"
			style={{ height: 'min(60vh, 420px)', minHeight: 200 }}
		>
			<SchemaEditorProvider
				resource={schema}
				data={data}
				onChange={onChange}
				selectedPath={selection.path}
				onSelectedPathChange={setPath}
				extensions={EXTENSIONS_BY_KEY[selection.resourceKey]}
			>
				<HierarchyTree />
			</SchemaEditorProvider>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Tree — list of Bundle nodes, each expandable to its resources
// ---------------------------------------------------------------------------

function WorkspaceTree({
	bundles,
	addBundle,
}: {
	bundles: readonly EditableBundle[];
	addBundle: () => void;
}) {
	// Default-expanded behaviour: with one Bundle the tree is fully open
	// (single-Bundle workflow stays as it always was). Once a second
	// Bundle is loaded, every Bundle collapses by default — the tree turns
	// into a Bundle picker. The user can still expand any of them manually
	// and we remember those overrides.
	const [overrides, setOverrides] = useState<Record<string, boolean>>({});
	const isExpanded = useCallback(
		(bundleId: string): boolean => {
			if (overrides[bundleId] !== undefined) return overrides[bundleId];
			return bundles.length <= 1;
		},
		[bundles.length, overrides],
	);
	const toggle = useCallback(
		(bundleId: string) => {
			setOverrides((prev) => {
				const current = prev[bundleId] !== undefined ? prev[bundleId] : bundles.length <= 1;
				return { ...prev, [bundleId]: !current };
			});
		},
		[bundles.length],
	);

	return (
		<div className="flex flex-col text-xs">
			{bundles.map((bundle) => (
				<BundleNode
					key={bundle.id}
					bundle={bundle}
					expanded={isExpanded(bundle.id)}
					onToggle={() => toggle(bundle.id)}
				/>
			))}
			<button
				type="button"
				onClick={addBundle}
				className="flex items-center gap-1.5 px-2 py-1.5 mx-2 mt-2 mb-2 text-xs text-muted-foreground border border-dashed rounded hover:bg-muted/60 hover:text-foreground transition-colors"
				title="Load another bundle into this workspace"
			>
				<Plus className="h-3 w-3" />
				<span>Add Bundle</span>
			</button>
		</div>
	);
}

function BundleNode({
	bundle,
	expanded,
	onToggle,
}: {
	bundle: EditableBundle;
	expanded: boolean;
	onToggle: () => void;
}) {
	const { selection, select, saveBundle, closeBundle } = useWorkspace();
	const entries = useMemo(() => {
		const out: { key: string; count: number }[] = [];
		for (const [key, list] of bundle.parsedResourcesAll) {
			if (list.length > 0) out.push({ key, count: list.length });
		}
		out.sort((a, b) => a.key.localeCompare(b.key));
		return out;
	}, [bundle.parsedResourcesAll]);

	const showVisibility = useMemo(
		() => bundleHasVisibilityRelevantResource(bundle),
		[bundle],
	);

	const onSave = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			void saveBundle(bundle.id);
		},
		[bundle.id, saveBundle],
	);
	const onClose = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			void closeBundle(bundle.id);
		},
		[bundle.id, closeBundle],
	);

	return (
		<div>
			<div
				className="flex items-center gap-1 px-2 py-1 font-medium border-b hover:bg-muted/40 cursor-pointer group"
				onClick={onToggle}
				title={`Toggle ${bundle.id}`}
			>
				{expanded ? (
					<ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
				) : (
					<ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
				)}
				<Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
				<span className="truncate flex-1 min-w-0" title={bundle.id}>
					{bundle.id}
				</span>
				{bundle.isModified && (
					<span
						className="text-[10px] text-yellow-600 shrink-0"
						title="Bundle has unsaved edits"
						aria-label="modified"
					>
						●
					</span>
				)}
				{showVisibility && (
					<VisibilityToggle
						node={{ bundleId: bundle.id }}
						label={bundle.id}
					/>
				)}
				<button
					type="button"
					onClick={onSave}
					disabled={!bundle.isModified}
					className="shrink-0 p-0.5 rounded text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
					title={
						bundle.isModified
							? 'Save this bundle (downloads to original filename)'
							: 'No changes to save'
					}
					aria-label={`Save ${bundle.id}`}
				>
					<Save className="h-3 w-3" />
				</button>
				<button
					type="button"
					onClick={onClose}
					className="shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
					title="Close this bundle"
					aria-label={`Close ${bundle.id}`}
				>
					<X className="h-3 w-3" />
				</button>
			</div>
			{expanded && (
				<div className="py-1">
					{entries.map((e) => {
						const handler = getHandlerByKey(e.key);
						const label = handler?.name ?? e.key;
						const isActiveSingle =
							e.count === 1 &&
							selection?.bundleId === bundle.id &&
							selection.resourceKey === e.key &&
							selection.index === 0;
						return e.count === 1 ? (
							<div key={e.key}>
								<ResourceRow
									bundleId={bundle.id}
									resourceKey={e.key}
									index={0}
									label={label}
									active={isActiveSingle}
									onClick={() =>
										select({
											bundleId: bundle.id,
											resourceKey: e.key,
											index: 0,
											path: [],
										})
									}
									showVisibility={isVisibilityRelevantKey(e.key)}
								/>
								{/* Schema subtree appears nested under the active ResourceRow
								    (issue #21). Only one ResourceRow can match the global
								    selection, so this never renders twice. */}
								{isActiveSingle && <SelectedSchemaSubtree />}
							</div>
						) : (
							<MultiResourceGroup
								key={e.key}
								bundleId={bundle.id}
								resourceKey={e.key}
								label={label}
								count={e.count}
								selection={selection}
								onSelect={(index) =>
									select({
										bundleId: bundle.id,
										resourceKey: e.key,
										index,
										path: [],
									})
								}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
}

function ResourceRow({
	bundleId,
	resourceKey,
	index,
	label,
	active,
	onClick,
	depth = 1,
	showVisibility = false,
}: {
	bundleId: string;
	resourceKey: string;
	index: number;
	label: string;
	active: boolean;
	onClick: () => void;
	depth?: number;
	showVisibility?: boolean;
}) {
	return (
		<div
			className={`flex w-full items-center gap-1.5 px-2 py-0.5 hover:bg-muted/60 ${
				active ? 'bg-muted text-foreground' : 'text-muted-foreground'
			}`}
			style={{ paddingLeft: 8 + depth * 14 }}
			title={resourceKey}
		>
			<button
				type="button"
				onClick={onClick}
				className="flex flex-1 min-w-0 items-center gap-1.5 text-left"
			>
				<FileText className="h-3 w-3 shrink-0" />
				<span className="truncate">{label}</span>
			</button>
			{showVisibility && (
				<VisibilityToggle
					node={{ bundleId, resourceKey, index }}
					label={`${resourceKey} #${index}`}
				/>
			)}
		</div>
	);
}

function MultiResourceGroup({
	bundleId,
	resourceKey,
	label,
	count,
	selection,
	onSelect,
}: {
	bundleId: string;
	resourceKey: string;
	label: string;
	count: number;
	selection: ReturnType<typeof useWorkspace>['selection'];
	onSelect: (index: number) => void;
}) {
	// Multi-instance keys (polygonSoupList, texture, shader, …) collapse to
	// a single header row by default. Auto-expand when one of their entries
	// is selected so the active row is always visible — keeps the user from
	// losing track after picking from a long shader bundle. Users can also
	// expand the group manually to reach per-instance Visibility toggles
	// (issue #19) without first picking a row to select.
	const someActive =
		selection?.bundleId === bundleId && selection.resourceKey === resourceKey;
	const [manualExpanded, setManualExpanded] = useState(false);
	const expanded = manualExpanded || someActive;
	const showVisibility = isVisibilityRelevantKey(resourceKey);
	return (
		<div>
			<div
				className="flex items-center gap-1.5 px-2 py-0.5 text-muted-foreground hover:bg-muted/40 cursor-pointer"
				style={{ paddingLeft: 8 + 14 }}
				title={resourceKey}
				onClick={() => setManualExpanded((v) => !v)}
			>
				{expanded ? (
					<ChevronDown className="h-3 w-3 shrink-0" />
				) : (
					<ChevronRight className="h-3 w-3 shrink-0" />
				)}
				<Folder className="h-3 w-3 shrink-0" />
				<span className="truncate flex-1 min-w-0">
					{label} <span className="text-[10px] opacity-70">({count})</span>
				</span>
				{showVisibility && (
					<VisibilityToggle
						node={{ bundleId, resourceKey }}
						label={`all ${resourceKey}`}
					/>
				)}
			</div>
			{expanded && (
				<>
					{Array.from({ length: count }).map((_, i) => {
						const isActive = someActive && selection!.index === i;
						return (
							<div key={i}>
								<ResourceRow
									bundleId={bundleId}
									resourceKey={resourceKey}
									index={i}
									label={`${label} #${i}`}
									active={isActive}
									onClick={() => onSelect(i)}
									depth={2}
									showVisibility={showVisibility}
								/>
								{/* Multi-instance: schema subtree mounts under the
								    actively-selected instance row (issue #21 acceptance:
								    "selecting a specific instance row shows that
								    instance's HierarchyTree"). */}
								{isActive && <SelectedSchemaSubtree />}
							</div>
						);
					})}
				</>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Inspector + viewport host — both consume the Selection
// ---------------------------------------------------------------------------

function SelectedResourceShell({
	children,
}: {
	children: (args: {
		schema: ReturnType<typeof getSchemaByKey>;
		data: unknown;
		path: NodePath;
		setPath: (next: NodePath) => void;
		onChange: (next: unknown) => void;
	}) => React.ReactNode;
}) {
	const { bundles, selection, select, setResourceAt } = useWorkspace();

	const selectedBundle = useMemo(
		() => (selection ? bundles.find((b) => b.id === selection.bundleId) : undefined),
		[bundles, selection],
	);
	const schema = selection ? getSchemaByKey(selection.resourceKey) : undefined;
	const data = useMemo(() => {
		if (!selection || !selectedBundle) return undefined;
		const list = selectedBundle.parsedResourcesAll.get(selection.resourceKey);
		return list?.[selection.index] ?? undefined;
	}, [selection, selectedBundle]);

	const onChange = useCallback(
		(next: unknown) => {
			if (!selection) return;
			setResourceAt(selection.bundleId, selection.resourceKey, selection.index, next);
		},
		[selection, setResourceAt],
	);

	const setPath = useCallback(
		(next: NodePath) => {
			if (!selection) return;
			select({
				bundleId: selection.bundleId,
				resourceKey: selection.resourceKey,
				index: selection.index,
				path: next,
			});
		},
		[selection, select],
	);

	// No selection: render whatever the children fallback wants.
	if (!selection) {
		return <>{children({ schema: undefined, data: undefined, path: [], setPath, onChange })}</>;
	}

	// Selection but no schema (e.g. shader, attribSysVault) — surface the
	// reason instead of silently failing. The legacy per-resource pages
	// remain the way to edit those resources today.
	if (!schema || data === undefined) {
		return <>{children({ schema: undefined, data, path: selection.path, setPath, onChange })}</>;
	}

	return (
		<SchemaEditorProvider
			resource={schema}
			data={data}
			onChange={onChange}
			selectedPath={selection.path}
			onSelectedPathChange={setPath}
			extensions={EXTENSIONS_BY_KEY[selection.resourceKey]}
		>
			{children({ schema, data, path: selection.path, setPath, onChange })}
		</SchemaEditorProvider>
	);
}

function CenterViewport() {
	const { bundles, selection } = useWorkspace();

	// World-viewport-family resources (AI sections, street/traffic/trigger
	// data, zone list, polygon soups) compose into a single shared
	// <WorldViewport> across every loaded Bundle (issue #18). Selection
	// changes within that family swap the inspector's Tools but DON'T
	// remount the chrome — the scene keeps every overlay rendered.
	//
	// Renderable / texture viewports are non-world-coord (per-vehicle 3D
	// scene; 2D image preview) so they get the legacy single-resource
	// ViewportPane shim. Switching to/from those WILL remount, since
	// they're not WorldViewport's at all.
	const useComposition =
		!selection || isWorldViewportFamilyKey(selection.resourceKey);

	if (useComposition) {
		// Empty Workspace + no Selection — the WorldViewport renders an
		// empty scene which is just a black canvas, so we skip it for a
		// clearer empty-state message. Once any Bundle is loaded the
		// composition takes over.
		if (bundles.length === 0) {
			return (
				<div className="h-full flex items-center justify-center text-xs text-muted-foreground">
					Select a resource from the tree to view it.
				</div>
			);
		}
		return (
			<ViewportErrorBoundary resetKey="workspace-world-composition">
				<WorldViewportComposition />
			</ViewportErrorBoundary>
		);
	}

	const schema = getSchemaByKey(selection.resourceKey);
	if (!schema) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
				No viewport available for {selection.resourceKey} yet.
				<br />
				Use the legacy per-resource page to edit this type.
			</div>
		);
	}
	// ViewportPane reads the active resource from the SchemaEditorProvider
	// — the SelectedResourceShell parent provides it.
	return (
		<ViewportErrorBoundary resetKey={`${selection.bundleId}/${selection.resourceKey}/${selection.index}`}>
			<ViewportPane />
		</ViewportErrorBoundary>
	);
}

function RightInspector() {
	const { selection } = useWorkspace();
	if (!selection) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
				Nothing selected.
			</div>
		);
	}
	const schema = getSchemaByKey(selection.resourceKey);
	if (!schema) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
				No inspector for {selection.resourceKey}.
			</div>
		);
	}
	return <InspectorPanel />;
}

// ---------------------------------------------------------------------------
// Toolbar — Add Bundle + Save All + UndoRedo
// ---------------------------------------------------------------------------

function WorkspaceToolbar({ onAddBundle }: { onAddBundle: () => void }) {
	const { bundles, saveAll } = useWorkspace();
	const dirtyCount = useMemo(
		() => bundles.filter((b) => b.isModified).length,
		[bundles],
	);
	const hasDirty = dirtyCount > 0;

	return (
		<div className="flex items-center gap-1 px-3 py-1 border-b">
			<span className="text-xs font-semibold tracking-wide text-muted-foreground">
				Workspace
			</span>
			<div className="ml-auto flex items-center gap-1">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={onAddBundle}
					title="Load another bundle into this workspace"
					className="h-6 px-1.5 text-xs gap-1"
				>
					<Plus className="h-3 w-3" />
					<span>Add</span>
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => void saveAll()}
					disabled={!hasDirty}
					title={
						hasDirty
							? `Save all ${dirtyCount} modified bundle${dirtyCount === 1 ? '' : 's'}`
							: 'No bundles need saving'
					}
					className="h-6 px-1.5 text-xs gap-1"
				>
					<Save className="h-3 w-3" />
					<span>Save All</span>
				</Button>
				<UndoRedoControls />
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const WorkspacePage = () => {
	const { bundles, loadBundle, selection, select } = useWorkspace();
	// Page-level keyboard binding for the Workspace's global undo stack
	// (ADR-0006). Mounted regardless of whether a Bundle is loaded so the
	// shortcut wires up consistently with the page's lifecycle.
	useWorkspaceUndoRedoShortcuts();
	// Hidden file input drives both the empty-state CTA and the "Add Bundle"
	// button in the toolbar / tree. `multiple` lets users drop several files
	// in one shot; loadBundle is sequenced one at a time so the same-name
	// prompt stays a single dialog at a time.
	const fileInputRef = useRef<HTMLInputElement>(null);
	const triggerAdd = useCallback(() => {
		fileInputRef.current?.click();
	}, []);
	const onPickFiles = useCallback(
		async (files: FileList | null) => {
			if (!files) return;
			const list = Array.from(files);
			for (const f of list) {
				await loadBundle(f);
			}
		},
		[loadBundle],
	);

	// Reset selection if the bundle it pointed at is no longer loaded.
	// Belt-and-braces: the provider's closeBundle / replace paths already
	// clear the selection, but if a downstream caller ever drops a bundle
	// without going through them, this keeps the inspector / viewport from
	// reading off stale state.
	useEffect(() => {
		if (selection && !bundles.some((b) => b.id === selection.bundleId)) {
			select(null);
		}
	}, [bundles, selection, select]);

	if (bundles.length === 0) {
		return (
			<div className="h-full min-h-0 border rounded-lg overflow-hidden bg-card m-6">
				<div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
					<div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
						<Plus className="w-6 h-6 text-muted-foreground" />
					</div>
					<div>
						<h3 className="text-base font-medium">No bundles in this workspace</h3>
						<p className="text-sm text-muted-foreground">
							Load one or more bundle files to get started.
						</p>
					</div>
					<Button onClick={triggerAdd} className="gap-2">
						<Plus className="w-4 h-4" />
						Add Bundle
					</Button>
					<input
						ref={fileInputRef}
						type="file"
						accept=".bundle,.bndl,.bin,.dat,.bun"
						multiple
						onChange={(e) => {
							void onPickFiles(e.target.files);
							e.target.value = '';
						}}
						className="hidden"
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="h-full min-h-0 border rounded-lg overflow-hidden bg-card m-6">
			<input
				ref={fileInputRef}
				type="file"
				accept=".bundle,.bndl,.bin,.dat,.bun"
				multiple
				onChange={(e) => {
					void onPickFiles(e.target.files);
					e.target.value = '';
				}}
				className="hidden"
			/>
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel id="ws-tree" order={1} defaultSize={20} minSize={14} className="bg-background">
					<div className="h-full flex flex-col">
						<WorkspaceToolbar onAddBundle={triggerAdd} />
						<div className="flex-1 min-h-0 overflow-auto">
							<WorkspaceTree bundles={bundles} addBundle={triggerAdd} />
						</div>
					</div>
				</ResizablePanel>

				<ResizableHandle withHandle />

				<SelectedResourceShell>
					{() => (
						<>
							<ResizablePanel id="ws-scene" order={2} defaultSize={50} minSize={20}>
								<div className="h-full flex flex-col">
									<div className="px-3 py-2 border-b text-xs font-semibold tracking-wide text-muted-foreground">
										Scene
									</div>
									<div className="flex-1 min-h-0">
										<CenterViewport />
									</div>
								</div>
							</ResizablePanel>

							<ResizableHandle withHandle />

							<ResizablePanel id="ws-inspector" order={3} defaultSize={30} minSize={18} className="bg-background">
								<div className="h-full flex flex-col">
									<div className="px-3 py-2 border-b text-xs font-semibold tracking-wide text-muted-foreground">
										Inspector
									</div>
									<div className="flex-1 min-h-0">
										<RightInspector />
									</div>
								</div>
							</ResizablePanel>
						</>
					)}
				</SelectedResourceShell>
			</ResizablePanelGroup>
		</div>
	);
};

export default WorkspacePage;

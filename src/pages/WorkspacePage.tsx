// WorkspaceEditor — three-pane editor for the multi-Bundle Workspace.
//
// Issue #24 (ADR-0007): the left pane mounts a single `WorkspaceHierarchy`
// component that owns the entire tree — Bundle, Resource type, Instance, and
// schema rows in one virtualised flat list, Unity-hierarchy-style. Replaces
// the previous split between `WorkspaceTree` (Bundle/Resource/Instance) and
// the separately-mounted `HierarchyTree` (schema rows under the selected
// resource).
//
// Selection now encodes four levels — Bundle, Resource type, Instance, Schema
// — via WorkspaceSelection's optional fields. The right-side panes dispatch
// off `selectionLevel(selection)`:
//
//   - Bundle row selected        → BundleInspector (filename, dirty state,
//                                  resource count, save/close affordances)
//   - Resource type row selected → ResourceTypeInspector (instance list w/
//                                  quick links, "this resource has N
//                                  instances" / "single-instance resource")
//   - Instance row selected      → SchemaEditorProvider + InspectorPanel
//                                  (schema-root form, today's behaviour)
//   - Schema row selected        → SchemaEditorProvider + InspectorPanel
//                                  (field form for that path)
//
//   ┌──────────────────────┬───────────────────────┬──────────────────┐
//   │  WorkspaceHierarchy  │  WorldViewport host   │  Inspector       │
//   │  (left)              │  (centre)             │  (right)         │
//   │                      │                       │                  │
//   │  ▾ TRK_UNIT_07.BUN ●  │  three.js scene;      │  Form for the    │
//   │     ▾ aiSec…          │  every loaded         │  selection level │
//   │       ▸ Header        │  Bundle's overlays    │  (bundle /       │
//   │       ▾ Sections      │  render here in a     │  resource-type / │
//   │         ▾ #0          │  single scene.        │  instance /      │
//   │           ▸ portals   │                       │  schema row).    │
//   │     ▾ pSoupList (2)   │                       │                  │
//   │       ▸ #0            │                       │                  │
//   │       ▾ #1            │                       │                  │
//   │  + Add Bundle         │                       │                  │
//   └──────────────────────┴───────────────────────┴──────────────────┘

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { FileText, Folder, Plus, Save, X } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { selectionLevel } from '@/context/WorkspaceContext.types';
import type { EditableBundle } from '@/context/WorkspaceContext.types';
import { InspectorPanel } from '@/components/schema-editor/InspectorPanel';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { ViewportPane } from '@/components/schema-editor/ViewportPane';
import { ViewportErrorBoundary } from '@/components/common/ViewportErrorBoundary';
import {
	WorldViewportComposition,
	isWorldViewportFamilyKey,
} from '@/components/workspace/WorldViewportComposition';
import { WorkspaceHierarchy } from '@/components/workspace/WorkspaceHierarchy';
import {
	PSLBulkProvider,
	useWorkspacePSLBulk,
} from '@/components/workspace/PSLBulkProvider';
import { BulkEditPanel } from '@/components/polygonSoupList/BulkEditPanel';
import { UndoRedoControls } from '@/components/UndoRedoControls';
import { useWorkspaceUndoRedoShortcuts } from '@/hooks/useWorkspaceUndoRedoShortcuts';
import {
	ShortcutsHelp,
	BULK_SHORTCUTS,
	SCHEMA_TREE_SHORTCUTS,
	type ShortcutGroup,
} from '@/components/schema-editor/ShortcutsHelp';
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
// Inspector / viewport host — both consume the Selection
// ---------------------------------------------------------------------------

// Wraps the children with a SchemaEditorProvider when the selection is at
// Instance / Schema level, so SchemaEditorPanel + ViewportPane share one
// provider. Bundle / Resource-type-level selections render directly without
// a provider — they don't drive the schema editor.
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
	const level = selectionLevel(selection);

	const selectedBundle = useMemo(
		() => (selection ? bundles.find((b) => b.id === selection.bundleId) : undefined),
		[bundles, selection],
	);
	const isInstanceOrSchema = level === 'instance' || level === 'schema';
	const schema = isInstanceOrSchema && selection?.resourceKey
		? getSchemaByKey(selection.resourceKey)
		: undefined;
	const data = useMemo(() => {
		if (!selection || !selectedBundle) return undefined;
		if (selection.resourceKey === undefined || selection.index === undefined) {
			return undefined;
		}
		const list = selectedBundle.parsedResourcesAll.get(selection.resourceKey);
		return list?.[selection.index] ?? undefined;
	}, [selection, selectedBundle]);

	const onChange = useCallback(
		(next: unknown) => {
			if (!selection) return;
			if (selection.resourceKey === undefined || selection.index === undefined) return;
			setResourceAt(selection.bundleId, selection.resourceKey, selection.index, next);
		},
		[selection, setResourceAt],
	);

	const setPath = useCallback(
		(next: NodePath) => {
			if (!selection) return;
			if (selection.resourceKey === undefined || selection.index === undefined) return;
			select({
				bundleId: selection.bundleId,
				resourceKey: selection.resourceKey,
				index: selection.index,
				path: next,
			});
		},
		[selection, select],
	);

	// Provider only mounts when there's a selectable instance + schema. Other
	// selection levels (Bundle / Resource type) render the children fallback
	// — those panes don't read the SchemaEditor context.
	if (!isInstanceOrSchema || !schema || data === undefined || !selection?.resourceKey) {
		return (
			<>
				{children({
					schema: undefined,
					data,
					path: selection?.path ?? [],
					setPath,
					onChange,
				})}
			</>
		);
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
	const level = selectionLevel(selection);

	// World-viewport-family resources (AI sections, street/traffic/trigger
	// data, zone list, polygon soups) compose into a single shared
	// <WorldViewport> across every loaded Bundle (issue #18). Bundle and
	// Resource-type-level selections also use the composition — there's no
	// instance-specific overlay focus, but the cross-Bundle scene still
	// renders.
	const useComposition =
		!selection ||
		level === 'bundle' ||
		(selection.resourceKey !== undefined &&
			isWorldViewportFamilyKey(selection.resourceKey));

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

	if (!selection?.resourceKey) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
				Select a resource from the tree to view it.
			</div>
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
		<ViewportErrorBoundary
			resetKey={`${selection.bundleId}/${selection.resourceKey}/${selection.index}`}
		>
			<ViewportPane />
		</ViewportErrorBoundary>
	);
}

function RightInspector() {
	const { bundles, selection, select, saveBundle, closeBundle } = useWorkspace();
	const bulk = useWorkspacePSLBulk();
	const level = selectionLevel(selection);

	// PSL bulk-edit panel: stacks above the regular inspector form when
	// the user has at least one polygon in the bulk set. Wrapping every
	// branch with the same shell keeps the panel attached regardless of
	// which inspector level is currently rendered (Bundle / Resource type
	// / Instance / Schema) — switching the inspector form doesn't drop
	// the user's bulk selection.
	const wrapWithBulk = (inner: React.ReactNode) => {
		if (!bulk) return inner;
		return (
			<div className="h-full flex flex-col min-h-0">
				<div className="shrink-0 max-h-[60%] overflow-auto border-b">
					<BulkEditPanel
						count={bulk.count}
						summary={bulk.summary}
						onClear={bulk.onClear}
						applyBulk={bulk.applyBulk}
					/>
				</div>
				<div className="flex-1 min-h-0 overflow-auto">{inner}</div>
			</div>
		);
	};

	if (!selection || level == null) {
		return wrapWithBulk(
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
				Nothing selected.
			</div>
		);
	}

	if (level === 'bundle') {
		const bundle = bundles.find((b) => b.id === selection.bundleId);
		if (!bundle) {
			return wrapWithBulk(
				<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
					Bundle no longer loaded.
				</div>
			);
		}
		return wrapWithBulk(
			<BundleInspector
				bundle={bundle}
				saveBundle={saveBundle}
				closeBundle={closeBundle}
				onSelectResourceType={(key, isMulti) =>
					select(
						isMulti
							? { bundleId: bundle.id, resourceKey: key, path: [] }
							: { bundleId: bundle.id, resourceKey: key, index: 0, path: [] },
					)
				}
			/>
		);
	}

	if (level === 'resourceType') {
		const bundle = bundles.find((b) => b.id === selection.bundleId);
		if (!bundle || !selection.resourceKey) {
			return wrapWithBulk(
				<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
					Resource type no longer available.
				</div>
			);
		}
		return wrapWithBulk(
			<ResourceTypeInspector
				bundle={bundle}
				resourceKey={selection.resourceKey}
				onSelectInstance={(idx) =>
					select({
						bundleId: bundle.id,
						resourceKey: selection.resourceKey!,
						index: idx,
						path: [],
					})
				}
			/>
		);
	}

	// Instance / Schema → the schema editor inspector takes over.
	const schema = selection.resourceKey
		? getSchemaByKey(selection.resourceKey)
		: undefined;
	if (!schema) {
		return wrapWithBulk(
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
				No inspector for {selection.resourceKey}.
			</div>
		);
	}
	return wrapWithBulk(<InspectorPanel />);
}

// ---------------------------------------------------------------------------
// Bundle-level inspector (issue #24)
// ---------------------------------------------------------------------------

function BundleInspector({
	bundle,
	saveBundle,
	closeBundle,
	onSelectResourceType,
}: {
	bundle: EditableBundle;
	saveBundle: (id: string) => Promise<void>;
	closeBundle: (id: string) => Promise<void>;
	onSelectResourceType: (key: string, isMulti: boolean) => void;
}) {
	const entries = useMemo(() => {
		const out: { key: string; count: number }[] = [];
		for (const [key, list] of bundle.parsedResourcesAll) {
			if (list.length > 0) out.push({ key, count: list.length });
		}
		out.sort((a, b) => a.key.localeCompare(b.key));
		return out;
	}, [bundle.parsedResourcesAll]);
	const totalCount = useMemo(
		() => entries.reduce((sum, e) => sum + e.count, 0),
		[entries],
	);
	return (
		<div className="h-full flex flex-col min-h-0 overflow-auto">
			<div className="px-4 pt-4 pb-2 border-b bg-card/60 shrink-0">
				<div className="flex items-center gap-2">
					<Folder className="h-4 w-4 text-muted-foreground shrink-0" />
					<h3 className="text-sm font-semibold truncate" title={bundle.id}>
						{bundle.id}
					</h3>
					{bundle.isModified && (
						<span
							className="text-[10px] text-yellow-600"
							title="Bundle has unsaved edits"
						>
							● modified
						</span>
					)}
				</div>
				<p className="text-[11px] text-muted-foreground mt-1">
					{totalCount} resource{totalCount === 1 ? '' : 's'} across{' '}
					{entries.length} type{entries.length === 1 ? '' : 's'}
				</p>
			</div>
			<div className="px-4 py-3 flex items-center gap-2 border-b">
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => void saveBundle(bundle.id)}
					disabled={!bundle.isModified}
					className="gap-1"
				>
					<Save className="h-3 w-3" />
					Save Bundle
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => void closeBundle(bundle.id)}
					className="gap-1"
				>
					<X className="h-3 w-3" />
					Close
				</Button>
			</div>
			<div className="flex-1 min-h-0 overflow-auto p-4">
				<div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
					Resource types
				</div>
				<ul className="space-y-1">
					{entries.map((e) => {
						const handler = getHandlerByKey(e.key);
						const label = handler?.name ?? e.key;
						const isMulti = e.count > 1;
						return (
							<li key={e.key}>
								<button
									type="button"
									onClick={() => onSelectResourceType(e.key, isMulti)}
									className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-muted/60 text-xs"
								>
									{isMulti ? (
										<Folder className="h-3 w-3 text-muted-foreground shrink-0" />
									) : (
										<FileText className="h-3 w-3 text-muted-foreground shrink-0" />
									)}
									<span className="flex-1 truncate">{label}</span>
									<span className="text-[10px] text-muted-foreground tabular-nums">
										{e.count}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Resource-type-level inspector (issue #24)
// ---------------------------------------------------------------------------

function ResourceTypeInspector({
	bundle,
	resourceKey,
	onSelectInstance,
}: {
	bundle: EditableBundle;
	resourceKey: string;
	onSelectInstance: (index: number) => void;
}) {
	const handler = getHandlerByKey(resourceKey);
	const label = handler?.name ?? resourceKey;
	const list = bundle.parsedResourcesAll.get(resourceKey) ?? [];
	const count = list.length;
	const isMulti = count > 1;

	return (
		<div className="h-full flex flex-col min-h-0">
			<div className="px-4 pt-4 pb-2 border-b bg-card/60 shrink-0">
				<div className="flex items-center gap-2">
					<Folder className="h-4 w-4 text-muted-foreground shrink-0" />
					<h3 className="text-sm font-semibold truncate" title={resourceKey}>
						{label}
					</h3>
				</div>
				<p className="text-[11px] text-muted-foreground mt-1">
					{isMulti
						? `This resource type has ${count} instances in ${bundle.id}`
						: `Single-instance resource in ${bundle.id}`}
				</p>
			</div>
			<div className="flex-1 min-h-0 overflow-auto p-4">
				<div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
					Instances
				</div>
				<ul className="space-y-1">
					{Array.from({ length: count }).map((_, i) => (
						<li key={i}>
							<button
								type="button"
								onClick={() => onSelectInstance(i)}
								className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-muted/60 text-xs"
							>
								<FileText className="h-3 w-3 text-muted-foreground shrink-0" />
								<span className="flex-1 truncate">
									{label} #{i}
								</span>
							</button>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Toolbar — Add Bundle + Save All + UndoRedo
// ---------------------------------------------------------------------------

// Always-on workspace shortcut group — covers Bundle / Resource / Instance
// row clicks at the top of the unified hierarchy. Composed with resource-
// type-specific groups below as the user drills in.
const WORKSPACE_HIERARCHY_SHORTCUTS: ShortcutGroup = {
	title: 'Workspace hierarchy',
	items: [
		{ keys: ['Click'], label: 'Select a Bundle / Resource / Instance / schema row' },
		{ keys: ['Click', '▶'], label: 'Expand or collapse a row' },
		{ keys: ['Click', 'eye'], label: 'Toggle visibility for a Bundle / Resource / Instance' },
	],
};

// Pick the shortcut groups for the active selection level. PSL surfaces the
// bulk-edit shortcuts because its overlay is the only one that consumes
// them today; other resources just show the hierarchy + tree shortcuts.
function shortcutGroupsForSelection(
	resourceKey: string | undefined,
): ShortcutGroup[] {
	const groups: ShortcutGroup[] = [WORKSPACE_HIERARCHY_SHORTCUTS, SCHEMA_TREE_SHORTCUTS];
	if (resourceKey === 'polygonSoupList') groups.push(BULK_SHORTCUTS);
	return groups;
}

function WorkspaceToolbar({ onAddBundle }: { onAddBundle: () => void }) {
	const { bundles, saveAll, selection } = useWorkspace();
	const dirtyCount = useMemo(
		() => bundles.filter((b) => b.isModified).length,
		[bundles],
	);
	const hasDirty = dirtyCount > 0;
	const shortcutGroups = useMemo(
		() => shortcutGroupsForSelection(selection?.resourceKey),
		[selection?.resourceKey],
	);

	return (
		<div className="flex items-center gap-1 px-3 py-1 border-b">
			<span className="text-xs font-semibold tracking-wide text-muted-foreground">
				Workspace
			</span>
			<div className="ml-auto flex items-center gap-1">
				<ShortcutsHelp groups={shortcutGroups} />
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
// PSL bulk wrapper — mounts PSLBulkProvider with the live Workspace handles
// so the centre viewport (overlay) and the right inspector (BulkEditPanel)
// share one bulk-selection store. Lives at page scope so switching the
// inspector form doesn't drop the user's bulk set.
// ---------------------------------------------------------------------------

function WorkspaceBulkWrapper({ children }: { children: React.ReactNode }) {
	const { bundles, selection, select, setResourceAt, isVisible } = useWorkspace();
	return (
		<PSLBulkProvider
			bundles={bundles}
			selection={selection}
			select={select}
			setResourceAt={setResourceAt}
			isVisible={isVisible}
		>
			{children}
		</PSLBulkProvider>
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
		<WorkspaceBulkWrapper>
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
						<div className="flex-1 min-h-0 overflow-hidden">
							<WorkspaceHierarchy onAddBundle={triggerAdd} />
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
		</WorkspaceBulkWrapper>
	);
};

export default WorkspacePage;

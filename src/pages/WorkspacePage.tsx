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

import { useCallback, useMemo, useRef, useState } from 'react';
import { useDropStaleSelection } from '@/hooks/useDropStaleSelection';
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { FileText, Folder, Plus, Save, Upload, X } from 'lucide-react';
import { ExportToVersionDialog } from '@/components/workspace/ExportToVersionDialog';
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
import { RenderableDecodedProvider } from '@/components/schema-editor/viewports/renderableDecodedContext';
import {
	PSLBulkProvider,
	useWorkspacePSLBulk,
} from '@/components/workspace/PSLBulkProvider';
import { AISectionsBulkProvider } from '@/components/workspace/AISectionsBulkProvider';
import { TriggerDataBulkProvider } from '@/components/workspace/TriggerDataBulkProvider';
import { BulkPanelStack } from '@/components/workspace/BulkPanelStack';
import { BulkTransformGizmoSessionProvider } from '@/components/workspace/BulkTransformGizmoSession';
import { BulkTransformNumericPanel } from '@/components/workspace/BulkTransformNumericPanel';
import { BulkImportDialog } from '@/components/workspace/BulkImportDialog';
import { BundleExportValidationDialog } from '@/components/workspace/BundleExportValidationDialog';
import { findUnresolvedPortals, type UnresolvedPortal } from '@/lib/core/aiSectionsValidate';
import { BulkEditPanel } from '@/components/polygonSoupList/BulkEditPanel';
import { UndoRedoControls } from '@/components/UndoRedoControls';
import { useWorkspaceUndoRedoShortcuts } from '@/hooks/useWorkspaceUndoRedoShortcuts';
import {
	ShortcutsHelp,
	BULK_SHORTCUTS,
	SCHEMA_TREE_SHORTCUTS,
	type ShortcutGroup,
} from '@/components/schema-editor/ShortcutsHelp';
import { getHandlerByKey } from '@/lib/core/registry';
import { pickProfileByKey } from '@/lib/editor/registry';
import { pickRenderBinding } from '@/lib/editor/bindings';
import type { NodePath } from '@/lib/schema/walk';

// Per-resource schema and extension lookup is now a single call into the
// editor registry (ADR-0008). The previous per-key `EXTENSIONS_BY_KEY` map +
// `getSchemaByKey` calls have been folded into `pickProfileByKey(key, model)`,
// which inspects the model's discriminator (e.g. AISections's `kind: 'v12'`)
// to pick the right schema for variant resources. The React-laden bits
// (extension registries) come from `pickRenderBinding` — split out so the
// helper modules under `src/components/workspace/` can resolve schema and
// the variant suffix without dragging overlay components into their
// import graph.

// ---------------------------------------------------------------------------
// Inspector / viewport host — both consume the Selection
// ---------------------------------------------------------------------------

// Wraps `children` with a SchemaEditorProvider when the selection is at
// Instance / Schema level. Bundle / Resource-type-level selections render
// `children` directly — those panes don't read the SchemaEditor context.
//
// Issue #28: this wrapper deliberately lives INSIDE the panes that actually
// consume `useSchemaEditor` (the right-pane InspectorPanel, the centre-pane
// non-world ViewportPane), not as a single shared parent of both panes the
// way an earlier `SelectedResourceShell` did. The earlier shape toggled
// between `<>{children}</>` (no selection / Bundle / Resource-type-level)
// and `<SchemaEditorProvider>{children}</SchemaEditorProvider>` (Instance /
// Schema-level) at the same position in the tree, so any selection change
// across that boundary unmounted and remounted the entire centre + right
// subtree — taking the WorldViewport's `<Canvas>` with it and snapping the
// camera back to `CAMERA_POSITION`. Keeping the provider out of the
// WorldViewport's ancestor chain leaves its Canvas mounted across every
// selection change in the world-family.
function SelectedSchemaEditorProvider({
	children,
	fallback,
}: {
	children: React.ReactNode;
	/** Rendered in place of `children` when the editor context can't be built
	 *  (e.g. the selected instance failed to parse, so its model is null). Every
	 *  caller passes provider-consuming children — rendering them bare would
	 *  throw `useSchemaEditor must be used within a SchemaEditorProvider`, and
	 *  in the un-boundaried inspector that uncaught throw tears down the whole
	 *  React root, taking the WorldViewport's WebGL context with it. */
	fallback?: React.ReactNode;
}) {
	const { bundles, selection, select, setResourceAt } = useWorkspace();
	const level = selectionLevel(selection);

	const selectedBundle = useMemo(
		() => (selection ? bundles.find((b) => b.id === selection.bundleId) : undefined),
		[bundles, selection],
	);
	const isInstanceOrSchema = level === 'instance' || level === 'schema';
	const data = useMemo(() => {
		if (!selection || !selectedBundle) return undefined;
		if (selection.resourceKey === undefined || selection.index === undefined) {
			return undefined;
		}
		const list = selectedBundle.parsedResourcesAll.get(selection.resourceKey);
		return list?.[selection.index] ?? undefined;
	}, [selection, selectedBundle]);
	// Profile picks the right schema for the model's variant; the matching
	// render binding supplies the React-laden extension registry —
	// single-profile resources resolve both unambiguously, AISections (and
	// future versioned types) narrow on `kind`.
	const profile = isInstanceOrSchema && selection?.resourceKey
		? pickProfileByKey(selection.resourceKey, data)
		: undefined;
	const binding = isInstanceOrSchema && selection?.resourceKey
		? pickRenderBinding(selection.resourceKey, data)
		: undefined;
	const schema = profile?.schema;

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

	if (!isInstanceOrSchema || !schema || data === undefined || !selection?.resourceKey) {
		// Can't build the editor context for this selection. `children` always
		// consumes `useSchemaEditor`, so render the fallback instead of letting
		// the hook throw (see the `fallback` prop doc). `data === undefined`
		// happens when the selected instance failed to parse — e.g. a resource
		// whose parser threw, leaving a null slot in parsedResourcesAll.
		return <>{fallback ?? null}</>;
	}

	return (
		<SchemaEditorProvider
			resource={schema}
			data={data}
			onChange={onChange}
			selectedPath={selection.path}
			onSelectedPathChange={setPath}
			extensions={binding?.extensions}
		>
			{children}
		</SchemaEditorProvider>
	);
}

function CenterViewport() {
	const { bundles, selection } = useWorkspace();
	const level = selectionLevel(selection);

	// Resolve the active resource model so the editor registry can pick the
	// right profile. Bundle / resource-type-level selections leave `data`
	// undefined; pickProfileByKey resolves to the lone profile in that case
	// (single-profile resources) or to undefined (versioned resources where
	// the variant can't be inferred without a model).
	const selectedBundle = useMemo(
		() => (selection ? bundles.find((b) => b.id === selection.bundleId) : undefined),
		[bundles, selection],
	);
	const data = useMemo(() => {
		if (!selection || !selectedBundle) return undefined;
		if (selection.resourceKey === undefined || selection.index === undefined) {
			return undefined;
		}
		const list = selectedBundle.parsedResourcesAll.get(selection.resourceKey);
		return list?.[selection.index] ?? undefined;
	}, [selection, selectedBundle]);

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
	const profile = pickProfileByKey(selection.resourceKey, data);
	if (!profile) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
				No viewport available for {selection.resourceKey} yet.
				<br />
				Use the legacy per-resource page to edit this type.
			</div>
		);
	}
	// ViewportPane reads the active resource from the SchemaEditorProvider
	// — wrap locally rather than through a shared parent above the centre
	// pane so the WorldViewport composition above this branch isn't subject
	// to mount/unmount cycles when selection changes (issue #28).
	return (
		<ViewportErrorBoundary
			resetKey={`${selection.bundleId}/${selection.resourceKey}/${selection.index}`}
		>
			<SelectedSchemaEditorProvider
				fallback={
					<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
						This {selection.resourceKey} instance couldn't be parsed — no viewport to show.
					</div>
				}
			>
				<ViewportPane />
			</SelectedSchemaEditorProvider>
		</ViewportErrorBoundary>
	);
}

function RightInspector() {
	const { bundles, selection, select, saveBundle, closeBundle, setResourceAt } = useWorkspace();
	const bulk = useWorkspacePSLBulk();
	const level = selectionLevel(selection);

	// PSL bulk-edit panel: stacks above the regular inspector form when
	// the user has at least one polygon in the bulk set. Wrapping every
	// branch with the same shell keeps the panel attached regardless of
	// which inspector level is currently rendered (Bundle / Resource type
	// / Instance / Schema) — switching the inspector form doesn't drop
	// the user's bulk selection.
	const wrapWithBulk = (inner: React.ReactNode) => {
		if (!bulk || bulk.count === 0) return inner;
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

	// Instance / Schema → the schema editor inspector takes over. Resolve
	// the active model first so multi-profile resources (e.g. AISections
	// V12 vs V4) disambiguate correctly — passing `null` here would make
	// `pickProfileByKey` return `undefined` whenever more than one profile
	// is registered, falsely rendering the "No inspector" fallback for
	// versioned resources.
	const inspectorBundle = bundles.find((b) => b.id === selection.bundleId);
	const inspectorData =
		inspectorBundle && selection.resourceKey != null && selection.index != null
			? inspectorBundle.parsedResourcesAll.get(selection.resourceKey)?.[selection.index]
			: undefined;
	const profile = selection.resourceKey
		? pickProfileByKey(selection.resourceKey, inspectorData ?? null)
		: undefined;
	if (!profile && selection.resourceKey) {
		return wrapWithBulk(
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
				No inspector for {selection.resourceKey}.
			</div>
		);
	}
	// AI Sections instance-level inspector — for V12 only, surface the
	// "Import bulk JSON" affordance above the schema form. V4 schema is
	// frozen (no addable sections), so the V4 profile must NOT show import
	// triggers; we gate on `profile.kind === 'v12'` plus the resource key.
	const showAIImport =
		selection.resourceKey === 'aiSections' &&
		profile?.kind === 'v12' &&
		selection.index != null &&
		inspectorBundle != null;

	// The inspector gets its own error boundary (the centre viewport already has
	// one). Without it, any throw while rendering the schema form propagates
	// uncaught and React 18 unmounts the entire root — which destroys the
	// WorldViewport's <Canvas> and loses the WebGL context. Containing the throw
	// here keeps the scene alive while the inspector shows the error.
	return wrapWithBulk(
		<ViewportErrorBoundary
			resetKey={`${selection.bundleId}/${selection.resourceKey}/${selection.index}`}
			title="Inspector crashed"
			description="Something threw while rendering the inspector form. Copy the details below and send them to the developer. Try Reset or selecting a different resource to keep working."
		>
			<SelectedSchemaEditorProvider
				fallback={
					<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
						This {selection.resourceKey} instance couldn't be parsed — nothing to edit.
					</div>
				}
			>
				{showAIImport && inspectorBundle && selection.index != null ? (
					<AIImportInspectorWrapper
						bundle={inspectorBundle}
						index={selection.index}
						setResourceAt={setResourceAt as never}
					/>
				) : (
					<InspectorPanel />
				)}
			</SelectedSchemaEditorProvider>
		</ViewportErrorBoundary>,
	);
}

// Inspector wrapper that prepends the "Import bulk JSON" affordance for
// V12 AI Sections instances. Pulled into its own component so the import
// dialog state stays attached to the (bundle, index) pair via React keys
// — switching to a different instance unmounts and resets the dialog.
function AIImportInspectorWrapper({
	bundle,
	index,
	setResourceAt,
}: {
	bundle: EditableBundle;
	index: number;
	setResourceAt: <T>(bundleId: string, key: string, index: number, value: T) => void;
}) {
	const [importOpen, setImportOpen] = useState(false);
	const model = bundle.parsedResourcesAll.get('aiSections')?.[index] as
		| import('@/lib/core/aiSections').ParsedAISectionsV12
		| undefined;
	if (!model || model.kind !== 'v12') {
		return <InspectorPanel />;
	}
	return (
		<div className="h-full flex flex-col min-h-0">
			<div className="shrink-0 border-b bg-card/40 px-3 py-2">
				<div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
					Import bulk JSON
				</div>
				<div className="flex flex-wrap gap-1.5">
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-7 text-xs"
						onClick={() => setImportOpen(true)}
					>
						Paste from clipboard
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-7 text-xs"
						onClick={() => setImportOpen(true)}
					>
						From file…
					</Button>
				</div>
			</div>
			<div className="flex-1 min-h-0 overflow-auto">
				<InspectorPanel />
			</div>
			<BulkImportDialog
				open={importOpen}
				onOpenChange={setImportOpen}
				destination={model}
				bundleId={bundle.id}
				onConfirm={(result) => {
					setResourceAt(bundle.id, 'aiSections', index, result);
				}}
			/>
		</div>
	);
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
	// Export-to-version dialog state — local to the inspector since the
	// surface is bundle-scoped (each bundle gets its own modal lifecycle).
	const [exportOpen, setExportOpen] = useState(false);
	// Pre-export validation: if the bundle's V12 AI Sections instance has
	// unresolved portals, surface them in a non-blocking dialog before the
	// download fires.
	const [validationState, setValidationState] = useState<
		| { kind: 'idle' }
		| { kind: 'review'; unresolved: UnresolvedPortal[]; aiSectionsIndex: number }
	>({ kind: 'idle' });
	const handleSaveClick = () => {
		const aiList = bundle.parsedResourcesAll.get('aiSections') ?? [];
		// Walk every V12 AI Sections instance in the bundle. The first one
		// with unresolved portals surfaces in the dialog; in practice every
		// bundle has zero or one AI Sections resource so this loop is at
		// most one iteration.
		for (let i = 0; i < aiList.length; i++) {
			const m = aiList[i] as import('@/lib/core/aiSections').ParsedAISections | undefined;
			if (!m || m.kind !== 'v12') continue;
			const unresolved = findUnresolvedPortals(m);
			if (unresolved.length > 0) {
				setValidationState({ kind: 'review', unresolved, aiSectionsIndex: i });
				return;
			}
		}
		void saveBundle(bundle.id);
	};
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
			<div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b">
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={handleSaveClick}
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
					onClick={() => setExportOpen(true)}
					className="gap-1"
					title="Migrate every resource to a target game version and save as a new file"
				>
					<Upload className="h-3 w-3" />
					Export to game version…
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
				<ExportToVersionDialog
					bundle={bundle}
					open={exportOpen}
					onOpenChange={setExportOpen}
				/>
				<BundleExportValidationDialog
					open={validationState.kind === 'review'}
					onOpenChange={(next) => {
						if (!next) setValidationState({ kind: 'idle' });
					}}
					unresolvedPortals={
						validationState.kind === 'review' ? validationState.unresolved : []
					}
					bundleId={bundle.id}
					aiSectionsIndex={
						validationState.kind === 'review' ? validationState.aiSectionsIndex : null
					}
					onContinue={() => {
						setValidationState({ kind: 'idle' });
						void saveBundle(bundle.id);
					}}
				/>
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
			<AISectionsBulkProvider bundles={bundles}>
				<TriggerDataBulkProvider bundles={bundles}>
					{/* Gizmo-session provider sits below the bulk providers so
					    AISectionsOverlay (deep inside the Canvas) and the
					    inspector-side `BulkTransformNumericPanel` (deep in the
					    right column) share one workspace-scoped session
					    (issue #81). */}
					<BulkTransformGizmoSessionProvider>
						{children}
					</BulkTransformGizmoSessionProvider>
				</TriggerDataBulkProvider>
			</AISectionsBulkProvider>
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
	useDropStaleSelection(bundles, selection, select);

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
			{/* Renderable decode context spans the whole editor so BOTH the centre
			    viewport (RenderableViewport) and the right inspector's
			    "Materials & Textures" tab share one decode pass. Workspace-aware:
			    it decodes the selected bundle's renderables and sources textures
			    + shaders from every other loaded bundle. */}
			<RenderableDecodedProvider>
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

				{/* The SchemaEditorProvider lives inside RightInspector and inside
				    CenterViewport's non-world branch, not here as a shared parent.
				    Keeping it out of the centre pane's ancestor chain is what stops
				    the WorldViewport's Canvas from unmounting on selection changes
				    (issue #28). */}
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
						<div className="flex-1 min-h-0 overflow-hidden flex flex-col">
							<div className="flex-1 min-h-0">
								<RightInspector />
							</div>
							{/* Numeric panel companion to the Bulk transform
							    gizmo (issue #81). Renders only while a gizmo
							    session is active — i.e. the WorldViewport
							    currently has a Selection that exposes the
							    BulkTransformGizmo. Sits above BulkPanelStack
							    so the user sees Δ translate / Δ rotate /
							    Pivot next to the live gesture. */}
							<BulkTransformNumericPanel />
							{/* AI Sections bulk panels — visible regardless of which
							    inspector level is active so the user can return to
							    a bulk after navigating elsewhere. PSL bulk-edit
							    lives inside `RightInspector`'s wrapper for
							    historical reasons (issue #24); generalising both
							    behind one stack is Slice 2 work. */}
							<BulkPanelStack />
						</div>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
			</RenderableDecodedProvider>
		</div>
		</WorkspaceBulkWrapper>
	);
};

export default WorkspacePage;

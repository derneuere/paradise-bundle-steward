// WorkspaceEditor — three-pane editor for the multi-Bundle Workspace.
//
// Phase #16 (foundation slice): one Bundle, one selected resource, one
// overlay in the WorldViewport. Cross-Bundle scene composition is #3;
// per-Bundle visibility toggles are #4. The chrome is already wired to the
// Workspace surface so adding additional Bundles in #2 will Just Work
// without restructuring the layout.
//
//   ┌──────────────┬─────────────────────────────┬──────────────────┐
//   │  Tree        │  WorldViewport host         │  Inspector       │
//   │  (left)      │  (centre)                   │  (right)         │
//   │              │                             │                  │
//   │  Bundle A    │  three.js scene; renders    │  Schema-driven   │
//   │   ├ aiSec…   │  the overlay for the        │  form for the    │
//   │   ├ trgr…    │  *currently selected*       │  selected node   │
//   │   └ stre…    │  resource only.             │  (or a generic   │
//   │              │                             │  empty state).   │
//   └──────────────┴─────────────────────────────┴──────────────────┘

import { useCallback, useMemo } from 'react';
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, ChevronRight, Folder, FileText } from 'lucide-react';
import {
	useActiveBundle,
	useWorkspace,
} from '@/context/WorkspaceContext';
import { InspectorPanel } from '@/components/schema-editor/InspectorPanel';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { ViewportPane } from '@/components/schema-editor/ViewportPane';
import { ViewportErrorBoundary } from '@/components/common/ViewportErrorBoundary';
import { UndoRedoControls } from '@/components/UndoRedoControls';
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
// Tree — Bundle row plus one row per resource key the Bundle holds
// ---------------------------------------------------------------------------

function WorkspaceTree({ bundle }: { bundle: EditableBundle }) {
	const { selection, select } = useWorkspace();
	// `parsedResourcesAll` is the source of truth for "what resource keys
	// does this Bundle have, and at what indices?" Iterating it yields
	// (key, instances[]) — most keys have one instance, polygonSoupList /
	// shader / texture have many.
	const entries = useMemo(() => {
		const out: { key: string; count: number }[] = [];
		for (const [key, list] of bundle.parsedResourcesAll) {
			if (list.length > 0) out.push({ key, count: list.length });
		}
		out.sort((a, b) => a.key.localeCompare(b.key));
		return out;
	}, [bundle.parsedResourcesAll]);

	// Bundle row is rendered as always-expanded; folding it would just hide
	// the resource list which is the point of the tree. The user can collapse
	// the panel via the resizable handle if they want more viewport space.
	return (
		<div className="flex flex-col text-xs">
			<div className="flex items-center gap-1 px-2 py-1 font-medium border-b">
				<ChevronDown className="h-3 w-3 text-muted-foreground" />
				<Folder className="h-3.5 w-3.5 text-muted-foreground" />
				<span className="truncate" title={bundle.id}>
					{bundle.id}
				</span>
				{bundle.isModified && (
					<span
						className="ml-auto text-[10px] text-yellow-600"
						title="Bundle has unsaved edits"
					>
						●
					</span>
				)}
			</div>
			<div className="py-1">
				{entries.map((e) => {
					const handler = getHandlerByKey(e.key);
					const label = handler?.name ?? e.key;
					return e.count === 1 ? (
						<ResourceRow
							key={e.key}
							bundleId={bundle.id}
							resourceKey={e.key}
							index={0}
							label={label}
							active={
								selection?.bundleId === bundle.id &&
								selection.resourceKey === e.key &&
								selection.index === 0
							}
							onClick={() =>
								select({
									bundleId: bundle.id,
									resourceKey: e.key,
									index: 0,
									path: [],
								})
							}
						/>
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
		</div>
	);
}

function ResourceRow({
	resourceKey,
	label,
	active,
	onClick,
	depth = 1,
}: {
	bundleId: string;
	resourceKey: string;
	index: number;
	label: string;
	active: boolean;
	onClick: () => void;
	depth?: number;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex w-full items-center gap-1.5 px-2 py-0.5 text-left hover:bg-muted/60 ${
				active ? 'bg-muted text-foreground' : 'text-muted-foreground'
			}`}
			style={{ paddingLeft: 8 + depth * 14 }}
			title={resourceKey}
		>
			<FileText className="h-3 w-3 shrink-0" />
			<span className="truncate">{label}</span>
		</button>
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
	// losing track after picking from a long shader bundle.
	const someActive =
		selection?.bundleId === bundleId && selection.resourceKey === resourceKey;
	return (
		<div>
			<div
				className="flex items-center gap-1.5 px-2 py-0.5 text-muted-foreground"
				style={{ paddingLeft: 8 + 14 }}
				title={resourceKey}
			>
				{someActive ? (
					<ChevronDown className="h-3 w-3 shrink-0" />
				) : (
					<ChevronRight className="h-3 w-3 shrink-0" />
				)}
				<Folder className="h-3 w-3 shrink-0" />
				<span className="truncate">
					{label} <span className="text-[10px] opacity-70">({count})</span>
				</span>
			</div>
			{someActive && (
				<>
					{Array.from({ length: count }).map((_, i) => (
						<ResourceRow
							key={i}
							bundleId={bundleId}
							resourceKey={resourceKey}
							index={i}
							label={`${label} #${i}`}
							active={selection.index === i}
							onClick={() => onSelect(i)}
							depth={2}
						/>
					))}
				</>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Inspector + viewport host — both consume the Selection
// ---------------------------------------------------------------------------

function SelectedResourceShell({
	bundle,
	children,
}: {
	bundle: EditableBundle;
	children: (args: {
		schema: ReturnType<typeof getSchemaByKey>;
		data: unknown;
		path: NodePath;
		setPath: (next: NodePath) => void;
		onChange: (next: unknown) => void;
	}) => React.ReactNode;
}) {
	const { selection, select, setResourceAt } = useWorkspace();

	const schema = selection ? getSchemaByKey(selection.resourceKey) : undefined;
	const data = useMemo(() => {
		if (!selection) return undefined;
		const list = bundle.parsedResourcesAll.get(selection.resourceKey);
		return list?.[selection.index] ?? undefined;
	}, [selection, bundle.parsedResourcesAll]);

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
	const { selection } = useWorkspace();
	if (!selection) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground">
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
	// — the SelectedResourceShell parent provides it. Multi-overlay
	// composition (every visible resource at once) lands in #3.
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
// Page
// ---------------------------------------------------------------------------

const WorkspacePage = () => {
	const bundle = useActiveBundle();

	if (!bundle) {
		return (
			<Card className="m-6">
				<CardHeader>
					<CardTitle>Workspace</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a Bundle to populate the workspace. Use the &ldquo;Load Bundle&rdquo;
						button in the header above.
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="h-full min-h-0 border rounded-lg overflow-hidden bg-card m-6">
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel id="ws-tree" order={1} defaultSize={20} minSize={14} className="bg-background">
					<div className="h-full flex flex-col">
						<div className="flex items-center justify-between px-3 py-1 border-b">
							<span className="text-xs font-semibold tracking-wide text-muted-foreground">
								Workspace
							</span>
							<UndoRedoControls />
						</div>
						<div className="flex-1 min-h-0 overflow-auto">
							<WorkspaceTree bundle={bundle} />
						</div>
					</div>
				</ResizablePanel>

				<ResizableHandle withHandle />

				<SelectedResourceShell bundle={bundle}>
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

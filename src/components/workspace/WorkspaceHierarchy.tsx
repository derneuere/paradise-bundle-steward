// WorkspaceHierarchy — single unified tree spanning Bundles → Resource types
// → Instances → schema rows (issue #24, ADR-0007).
//
// Replaces the previous split between `WorkspaceTree` (Bundle / Resource /
// Instance) and the separately-mounted `HierarchyTree` (schema rows for the
// selected resource). One virtualised flat list, Unity-style: every node is
// selectable, **Visibility** eye icons live on Bundle / Resource type /
// Instance rows but stop at the Instance level (schema rows are sub-shapes
// of their parent resource, not independent scene nodes — see ADR-0007).
//
// The pure flat-list builder lives in `WorkspaceHierarchy.helpers.ts` so the
// vitest node env can exercise row enumeration without dragging in React.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useSeedBundleExpansion } from '@/hooks/useSeedBundleExpansion';
import { useScrollToVirtualRow } from '@/hooks/useScrollToVirtualRow';
import {
	ChevronDown,
	ChevronRight,
	Eye,
	EyeOff,
	FileText,
	Folder,
	Plus,
	Save,
	X,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { VisibilityNode, WorkspaceSelection } from '@/context/WorkspaceContext.types';
import { useWorkspacePSLBulk } from './PSLBulkProvider';
import { useWorkspaceAISectionsBulk } from './AISectionsBulkProvider';
import { useWorkspaceTriggerDataBulk } from './TriggerDataBulkProvider';
import type { NodePath } from '@/lib/schema/walk';
import {
	bundleKey,
	buildWorkspaceFlat,
	rowIsInBulk,
	type BundleFlatNode,
	type FlatNode,
	type InstanceFlatNode,
	type ResourceTypeFlatNode,
	type SchemaFlatNode,
} from './WorkspaceHierarchy.helpers';
import {
	isSameReorderList,
	listItemAddress,
	reorderListInModel,
	type ReorderDragSource,
} from './WorkspaceHierarchy.reorder';

// Return the path the bulk-range "from" anchor should use. We read the
// inspector's current schema path; if the current selection isn't on a
// bulk-eligible resource we hand back an empty path so `onBulkRange` falls
// through to its "no-anchor → just add the endpoint" branch.
function selectionAnchorPath(
	selection: WorkspaceSelection,
	resourceKey: string,
): NodePath {
	if (!selection) return [];
	if (selection.resourceKey !== resourceKey) return [];
	return selection.path ?? [];
}

// ---------------------------------------------------------------------------
// Visibility toggle button
// ---------------------------------------------------------------------------

function VisibilityToggle({
	node,
	label,
}: {
	node: VisibilityNode;
	label: string;
}) {
	const { isVisible, setVisibility, soloVisibility } = useWorkspace();
	const visible = isVisible(node);
	// Alt+click solos this node within its Bundle — second alt-press on the
	// already-soloed eye restores full visibility (see issue #26). Plain click
	// stays as the per-node visibility toggle.
	const onClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			if (e.altKey) {
				soloVisibility(node);
				return;
			}
			setVisibility(node, !visible);
		},
		[node, visible, setVisibility, soloVisibility],
	);
	return (
		<button
			type="button"
			onClick={onClick}
			className="shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
			title={`${visible ? `Hide ${label}` : `Show ${label}`} — alt+click to solo`}
			aria-label={visible ? `Hide ${label}` : `Show ${label}`}
			aria-pressed={visible}
		>
			{visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 opacity-60" />}
		</button>
	);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type WorkspaceHierarchyProps = {
	onAddBundle: () => void;
};

export function WorkspaceHierarchy({ onAddBundle }: WorkspaceHierarchyProps) {
	const { bundles, selection, select, saveBundle, closeBundle, getResources, setResourceAt } =
		useWorkspace();
	// PSL bulk handle — null when no PSL is active. Drives the schema-row
	// Ctrl/Shift-click semantics + the amber-accent highlight on bulk rows.
	const bulk = useWorkspacePSLBulk();
	// AI Sections bulk handle — always non-null when the workspace tree is
	// mounted (the provider wraps the page), but the bulk Sets are empty
	// until the user starts curating. Drives the same Ctrl/Shift semantics
	// + amber row tint + per-resource-row count Badge.
	const aiBulk = useWorkspaceAISectionsBulk();
	// TriggerData bulk handle — sibling shape to AI Sections. The marquee
	// owns the only producer today; tree-row Ctrl/Shift below extends the
	// dispatch surface so users can curate from the schema rows too.
	const triggerBulk = useWorkspaceTriggerDataBulk();

	// Persisted expansion state. Default-expanded behaviour mirrors the
	// pre-WorkspaceHierarchy tree:
	//   - 1 Bundle → bundle defaults to expanded.
	//   - 2+ Bundles → all collapsed by default (the tree turns into a
	//     Bundle picker; user expands what they need).
	// We seed each Bundle's default once, so user toggles persist after
	// later loads add a second Bundle.
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [seededBundles, setSeededBundles] = useState<Set<string>>(() => new Set());

	useSeedBundleExpansion(bundles, seededBundles, setSeededBundles, setExpanded, bundleKey);

	// `buildWorkspaceFlat` auto-expands ancestors of the current selection
	// internally, so we just pass our persisted set.
	const flat = useMemo(
		() => buildWorkspaceFlat({ bundles, expanded, selection }),
		[bundles, expanded, selection],
	);

	const toggleExpansion = useCallback((key: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);

	const onSelectBundle = useCallback(
		(bundleId: string) => {
			select({ bundleId, path: [] });
		},
		[select],
	);
	const onSelectResourceType = useCallback(
		(bundleId: string, resourceKey: string, isMulti: boolean) => {
			if (isMulti) {
				select({ bundleId, resourceKey, path: [] });
			} else {
				// Single-instance: skip the Resource-type level entirely. Land
				// directly on Instance.
				select({ bundleId, resourceKey, index: 0, path: [] });
			}
		},
		[select],
	);
	const onSelectInstance = useCallback(
		(bundleId: string, resourceKey: string, index: number) => {
			select({ bundleId, resourceKey, index, path: [] });
		},
		[select],
	);
	const onSelectSchema = useCallback(
		(
			bundleId: string,
			resourceKey: string,
			index: number,
			schemaPath: NodePath,
			modifiers?: { shift?: boolean; ctrl?: boolean },
		) => {
			// Bulk semantics on schema rows are dispatched per-resource. PSL
			// owns polygon rows; AI Sections owns section / portal / boundary-
			// line / no-go-line rows. Other resources fall through to plain
			// selection unconditionally.
			if (bulk && resourceKey === 'polygonSoupList') {
				if (modifiers?.ctrl) {
					bulk.onBulkToggle(schemaPath);
					return;
				}
				if (modifiers?.shift) {
					const fromPath: NodePath = selectionAnchorPath(selection, 'polygonSoupList');
					bulk.onBulkRange(fromPath, schemaPath);
					select({ bundleId, resourceKey, index, path: schemaPath });
					return;
				}
			}
			if (aiBulk && resourceKey === 'aiSections') {
				if (modifiers?.ctrl) {
					// Ctrl/Cmd: toggle the row's containing section in the
					// bulk Set without moving the inspector. Sub-paths under
					// a section (a portal, a no-go line) collapse to the
					// parent section inside `onBulkToggle` — picking
					// granularity stays at the section level.
					aiBulk.onBulkToggle(bundleId, index, schemaPath);
					return;
				}
				if (modifiers?.shift) {
					const fromPath: NodePath = selectionAnchorPath(selection, 'aiSections');
					aiBulk.onBulkRange(bundleId, index, fromPath, schemaPath);
					select({ bundleId, resourceKey, index, path: schemaPath });
					return;
				}
			}
			if (triggerBulk && resourceKey === 'triggerData') {
				if (modifiers?.ctrl) {
					// Ctrl/Cmd: toggle the row's containing entry (landmark /
					// generic / blackspot / vfx / spawn / roaming). Player-
					// start singleton rows aren't bulk-eligible — the toggle
					// reducer drops them silently and we still want a plain
					// select for that row, so we DON'T early-return when the
					// path can't normalise. The reducer's no-op makes the
					// Ctrl-click safe; falling through to `select(...)` keeps
					// the inspector behaviour for non-bulk rows.
					triggerBulk.onBulkToggle(bundleId, index, schemaPath);
					return;
				}
				if (modifiers?.shift) {
					const fromPath: NodePath = selectionAnchorPath(selection, 'triggerData');
					triggerBulk.onBulkRange(bundleId, index, fromPath, schemaPath);
					select({ bundleId, resourceKey, index, path: schemaPath });
					return;
				}
			}
			select({ bundleId, resourceKey, index, path: schemaPath });
		},
		[select, bulk, aiBulk, triggerBulk, selection],
	);

	// ---------------------- Drag-to-reorder ----------------------
	//
	// HTML5 DnD on record-list instance rows (PropInstanceData props,
	// TriggerData triggers, …). The active drag source + the current drop
	// indicator (which row's pathKey + which edge) live here so the dragged
	// row's identity is known across `onDragOver`/`onDrop` on a *different*
	// row, and so we can paint a single top/bottom border on the hovered row.
	const [dragSource, setDragSource] = useState<ReorderDragSource | null>(null);
	const [dropTarget, setDropTarget] = useState<{
		pathKey: string;
		edge: 'top' | 'bottom';
	} | null>(null);

	const onReorderDragStart = useCallback((source: ReorderDragSource) => {
		setDragSource(source);
	}, []);

	const onReorderDragEnd = useCallback(() => {
		setDragSource(null);
		setDropTarget(null);
	}, []);

	// Reorder commit: move the dragged item to its new slot within the SAME
	// list and write the next instance model back through `setResourceAt`
	// (one HistoryCommit, dirties the bundle). The drop index is computed in
	// the post-removal coordinate space: dropping below a row that sits after
	// the source means the gap shifts down by one once the source is pulled
	// out. The same-list guard (bundle / resource / instance / listPath) runs
	// before any of this — a mismatched drop is ignored upstream.
	const onReorderDrop = useCallback(
		(
			target: Omit<ReorderDragSource, 'itemIndex'>,
			targetItemIndex: number,
			edge: 'top' | 'bottom',
		) => {
			const source = dragSource;
			setDragSource(null);
			setDropTarget(null);
			if (!source) return;
			if (!isSameReorderList(source, target)) return;

			const from = source.itemIndex;
			// Insertion slot in the original array, then adjust to the
			// post-removal index space.
			const insertBefore = edge === 'top' ? targetItemIndex : targetItemIndex + 1;
			let to = insertBefore;
			if (from < insertBefore) to -= 1;
			if (to === from) return;

			const model = getResources<unknown>(source.bundleId, source.resourceKey)[
				source.instanceIndex
			];
			if (model == null) return;
			const next = reorderListInModel(model, source.listPath, from, to);
			if (next === model) return;
			setResourceAt(source.bundleId, source.resourceKey, source.instanceIndex, next);
			// Keep the selection on the moved item so the inspector follows it
			// to its new slot (selection addresses by index, which just changed).
			select({
				bundleId: source.bundleId,
				resourceKey: source.resourceKey,
				index: source.instanceIndex,
				path: [...source.listPath, to],
			});
		},
		[dragSource, getResources, setResourceAt, select],
	);

	// ---------------------- Virtualizer ----------------------

	const parentRef = useRef<HTMLDivElement>(null);
	const rowVirtualizer = useVirtualizer({
		count: flat.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 24,
		overscan: 20,
		getItemKey: (index) => flat[index]?.pathKey ?? index,
	});

	// Find the selected row index for scroll-to-view. We pick the row whose
	// kind+address matches the current selection level.
	const selectedFlatIndex = useMemo(() => {
		if (!selection) return -1;
		for (let i = 0; i < flat.length; i++) {
			const node = flat[i];
			if (
				node.kind === 'bundle' &&
				selection.resourceKey === undefined &&
				node.bundle.id === selection.bundleId
			) {
				return i;
			}
			if (
				node.kind === 'resourceType' &&
				selection.resourceKey === node.resourceKey &&
				selection.index === undefined &&
				node.bundleId === selection.bundleId
			) {
				return i;
			}
			if (
				(node.kind === 'instance' || node.kind === 'schema') &&
				node.bundleId === selection.bundleId &&
				node.resourceKey === selection.resourceKey &&
				node.index === selection.index
			) {
				if (node.kind === 'schema') {
					if (
						selection.path.length === node.schemaPath.length &&
						selection.path.every((s, j) => s === node.schemaPath[j])
					) {
						return i;
					}
				} else if (selection.path.length === 0) {
					return i;
				}
			}
		}
		return -1;
	}, [flat, selection]);

	useScrollToVirtualRow(rowVirtualizer, selectedFlatIndex);

	// ---------------------- Render ----------------------

	const items = rowVirtualizer.getVirtualItems();

	return (
		<div className="h-full flex flex-col text-xs">
			<div ref={parentRef} className="flex-1 min-h-0 overflow-auto">
				<div
					style={{
						height: rowVirtualizer.getTotalSize(),
						width: '100%',
						position: 'relative',
					}}
				>
					{items.map((vi) => {
						const node = flat[vi.index];
						if (!node) return null;
						return (
							<div
								key={vi.key}
								data-index={vi.index}
								ref={rowVirtualizer.measureElement}
								className="absolute left-0 right-0"
								style={{ transform: `translateY(${vi.start}px)` }}
							>
								<HierarchyRow
									node={node}
									onToggleExpansion={toggleExpansion}
									onSelectBundle={onSelectBundle}
									onSelectResourceType={onSelectResourceType}
									onSelectInstance={onSelectInstance}
									onSelectSchema={onSelectSchema}
									saveBundle={saveBundle}
									closeBundle={closeBundle}
									pslBulkPathKeys={bulk?.bulkPathKeys ?? null}
									aiBulkGetPathKeys={aiBulk?.getPathKeys ?? null}
									aiBulkGetCount={aiBulk?.getCount ?? null}
									triggerBulkGetPathKeys={triggerBulk?.getPathKeys ?? null}
									triggerBulkGetCount={triggerBulk?.getCount ?? null}
									dragSource={dragSource}
									dropTarget={dropTarget}
									onReorderDragStart={onReorderDragStart}
									onReorderDragOverRow={setDropTarget}
									onReorderDrop={onReorderDrop}
									onReorderDragEnd={onReorderDragEnd}
								/>
							</div>
						);
					})}
				</div>
			</div>
			<button
				type="button"
				onClick={onAddBundle}
				className="flex items-center gap-1.5 px-2 py-1.5 mx-2 mt-2 mb-2 text-xs text-muted-foreground border border-dashed rounded hover:bg-muted/60 hover:text-foreground transition-colors"
				title="Load another bundle into this workspace"
			>
				<Plus className="h-3 w-3" />
				<span>Add Bundle</span>
			</button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Row dispatcher
// ---------------------------------------------------------------------------

type HierarchyRowProps = {
	node: FlatNode;
	onToggleExpansion: (key: string) => void;
	onSelectBundle: (bundleId: string) => void;
	onSelectResourceType: (
		bundleId: string,
		resourceKey: string,
		isMulti: boolean,
	) => void;
	onSelectInstance: (bundleId: string, resourceKey: string, index: number) => void;
	onSelectSchema: (
		bundleId: string,
		resourceKey: string,
		index: number,
		schemaPath: NodePath,
		modifiers?: { shift?: boolean; ctrl?: boolean },
	) => void;
	saveBundle: (bundleId: string) => Promise<void>;
	closeBundle: (bundleId: string) => Promise<void>;
	/** Path-key set of polys currently in the PSL bulk — drives amber tint
	 *  on schema rows that match. `null` when no PSL is active or no bulk
	 *  context is available. */
	pslBulkPathKeys: ReadonlySet<string> | null;
	/** Lookup the AI sections bulk path-key set for `(bundleId, index)` —
	 *  drives amber tint on AI section schema rows. Returns null when the
	 *  bulk for that instance is empty. `null` (the function itself) means
	 *  the AI bulk provider isn't mounted; callers should treat that as
	 *  "no AI bulk anywhere". */
	aiBulkGetPathKeys:
		| ((bundleId: string, index: number) => ReadonlySet<string> | null)
		| null;
	/** Cheap count lookup for the resource-type-row Badge. Same null-vs-fn
	 *  contract as `aiBulkGetPathKeys`. */
	aiBulkGetCount: ((bundleId: string, index: number) => number) | null;
	/** TriggerData bulk path-key lookup for `(bundleId, index)` — drives the
	 *  amber tint on trigger schema rows. Same null-vs-fn contract as
	 *  `aiBulkGetPathKeys`. */
	triggerBulkGetPathKeys:
		| ((bundleId: string, index: number) => ReadonlySet<string> | null)
		| null;
	/** Cheap count lookup for the trigger resource-type-row Badge. */
	triggerBulkGetCount: ((bundleId: string, index: number) => number) | null;
	// ---- Drag-to-reorder (record-list instance rows only) ----
	/** The currently-dragged list item, or null when no drag is in flight.
	 *  A row consults this to decide whether it's a valid drop target. */
	dragSource: ReorderDragSource | null;
	/** The row + edge the drop indicator currently paints, or null. */
	dropTarget: { pathKey: string; edge: 'top' | 'bottom' } | null;
	/** Begin a drag from a reorderable row. */
	onReorderDragStart: (source: ReorderDragSource) => void;
	/** Update the drop indicator as the pointer moves over a row. */
	onReorderDragOverRow: (
		next: { pathKey: string; edge: 'top' | 'bottom' } | null,
	) => void;
	/** Commit a drop onto a row's `(target, itemIndex, edge)`. */
	onReorderDrop: (
		target: Omit<ReorderDragSource, 'itemIndex'>,
		targetItemIndex: number,
		edge: 'top' | 'bottom',
	) => void;
	/** End the drag (clears source + indicator). */
	onReorderDragEnd: () => void;
};

function HierarchyRow(props: HierarchyRowProps) {
	const { node } = props;
	switch (node.kind) {
		case 'bundle':
			return <BundleRow {...props} node={node} />;
		case 'resourceType':
			return <ResourceTypeRow {...props} node={node} />;
		case 'instance':
			return <InstanceRow {...props} node={node} />;
		case 'schema':
			return <SchemaRow {...props} node={node} />;
	}
}

// ---------------------------------------------------------------------------
// Bundle row
// ---------------------------------------------------------------------------

function BundleRow({
	node,
	onToggleExpansion,
	onSelectBundle,
	saveBundle,
	closeBundle,
}: HierarchyRowProps & { node: BundleFlatNode }) {
	const bundle = node.bundle;
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
		<div
			className={cn(
				'flex items-center gap-1 px-2 py-1 font-medium border-b cursor-pointer group',
				node.isSelected ? 'bg-primary/15 text-primary' : 'hover:bg-muted/40',
			)}
			onClick={() => onSelectBundle(bundle.id)}
			title={bundle.id}
		>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onToggleExpansion(node.pathKey);
				}}
				className="shrink-0 p-0.5"
				aria-label={node.expanded ? 'Collapse bundle' : 'Expand bundle'}
			>
				{node.expanded ? (
					<ChevronDown className="h-3 w-3 text-muted-foreground" />
				) : (
					<ChevronRight className="h-3 w-3 text-muted-foreground" />
				)}
			</button>
			<Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
			<span className="truncate flex-1 min-w-0">{bundle.id}</span>
			{bundle.isModified && (
				<span
					className="text-[10px] text-yellow-600 shrink-0"
					title="Bundle has unsaved edits"
					aria-label="modified"
				>
					●
				</span>
			)}
			{node.showVisibility && (
				<VisibilityToggle node={{ bundleId: bundle.id }} label={bundle.id} />
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
	);
}

// ---------------------------------------------------------------------------
// Resource type row
// ---------------------------------------------------------------------------

function ResourceTypeRow({
	node,
	onToggleExpansion,
	onSelectResourceType,
	aiBulkGetCount,
	triggerBulkGetCount,
}: HierarchyRowProps & { node: ResourceTypeFlatNode }) {
	// Per-resource bulk badge. AI Sections and TriggerData are single-instance
	// so the count reads directly off (bundleId, 0) — no fan-out across
	// instances needed today. When a future resource grows multi-instance bulk
	// support (e.g. PSL retrofitted onto the panel stack) this badge will need
	// to sum over indices, but that isn't the case yet.
	const bulkCount = node.isMultiInstance
		? 0
		: node.resourceKey === 'aiSections' && aiBulkGetCount
			? aiBulkGetCount(node.bundleId, 0)
			: node.resourceKey === 'triggerData' && triggerBulkGetCount
				? triggerBulkGetCount(node.bundleId, 0)
				: 0;

	return (
		<div
			className={cn(
				'flex items-center gap-1.5 py-0.5 cursor-pointer',
				node.isSelected
					? 'bg-primary/15 text-primary font-medium'
					: 'text-muted-foreground hover:bg-muted/40',
			)}
			style={{ paddingLeft: 8 + node.depth * 14, paddingRight: 4 }}
			title={node.resourceKey}
			onClick={() =>
				onSelectResourceType(node.bundleId, node.resourceKey, node.isMultiInstance)
			}
		>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onToggleExpansion(node.pathKey);
				}}
				className="shrink-0 p-0.5"
				aria-label={node.expanded ? 'Collapse resource type' : 'Expand resource type'}
			>
				{node.expanded ? (
					<ChevronDown className="h-3 w-3" />
				) : (
					<ChevronRight className="h-3 w-3" />
				)}
			</button>
			{node.isMultiInstance ? (
				<Folder className="h-3 w-3 shrink-0" />
			) : (
				<FileText className="h-3 w-3 shrink-0" />
			)}
			<span className="truncate flex-1 min-w-0">
				{node.label}
				{node.isMultiInstance && (
					<span className="text-[10px] opacity-70"> ({node.count})</span>
				)}
			</span>
			{bulkCount > 0 && (
				<Badge
					variant="outline"
					className="h-4 px-1 text-[10px] tabular-nums shrink-0 border-amber-500/60 text-amber-700"
					title={`${bulkCount} in bulk`}
				>
					{bulkCount}
				</Badge>
			)}
			{node.showVisibility && (
				<VisibilityToggle
					node={
						node.isMultiInstance
							? { bundleId: node.bundleId, resourceKey: node.resourceKey }
							: { bundleId: node.bundleId, resourceKey: node.resourceKey, index: 0 }
					}
					label={
						node.isMultiInstance
							? `all ${node.resourceKey}`
							: `${node.resourceKey} #0`
					}
				/>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Instance row
// ---------------------------------------------------------------------------

function InstanceRow({
	node,
	onSelectInstance,
}: HierarchyRowProps & { node: InstanceFlatNode }) {
	// Instance "expansion" = is-this-the-selected-instance? Schema subtree
	// renders only beneath the selected instance, so the chevron is just a
	// visual cue — clicking the row selects (and so "expands"). We don't
	// track per-instance schema-collapsed state since the flat list culls
	// every non-selected instance's subtree to keep virtualisation cheap.
	return (
		<div
			className={cn(
				'flex items-center gap-1.5 py-0.5 cursor-pointer',
				node.isSelected
					? 'bg-primary/15 text-primary font-medium'
					: 'text-muted-foreground hover:bg-muted/40',
			)}
			style={{ paddingLeft: 8 + node.depth * 14, paddingRight: 4 }}
			title={`${node.resourceKey} #${node.index}`}
			onClick={() => onSelectInstance(node.bundleId, node.resourceKey, node.index)}
		>
			<span className="shrink-0 p-0.5">
				{node.expanded ? (
					<ChevronDown className="h-3 w-3" />
				) : (
					<ChevronRight className="h-3 w-3" />
				)}
			</span>
			<FileText className="h-3 w-3 shrink-0" />
			<span className="truncate flex-1 min-w-0">{node.label}</span>
			{node.showVisibility && (
				<VisibilityToggle
					node={{
						bundleId: node.bundleId,
						resourceKey: node.resourceKey,
						index: node.index,
					}}
					label={`${node.resourceKey} #${node.index}`}
				/>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Schema row
// ---------------------------------------------------------------------------

function SchemaRow({
	node,
	onToggleExpansion,
	onSelectSchema,
	pslBulkPathKeys,
	aiBulkGetPathKeys,
	triggerBulkGetPathKeys,
	dragSource,
	dropTarget,
	onReorderDragStart,
	onReorderDragOverRow,
	onReorderDrop,
	onReorderDragEnd,
}: HierarchyRowProps & { node: SchemaFlatNode }) {
	// A schema row is reorderable iff it's a record-list item (its path ends
	// in a numeric index). Top-level list fields and record sub-fields aren't
	// — only the leaf items move. `address` is the (listPath, index) split.
	const address = listItemAddress(node.schemaPath);
	const isReorderable = address != null;
	const rowTarget = address
		? {
			bundleId: node.bundleId,
			resourceKey: node.resourceKey,
			instanceIndex: node.index,
			listPath: address.listPath,
		}
		: null;
	// This row is a *valid* drop site only while a drag from the SAME list is
	// in flight — same bundle / resource / instance / listPath. Cross-list (or
	// no-drag) hovers don't preventDefault, so the browser shows "no drop."
	const isDropEligible =
		rowTarget != null &&
		dragSource != null &&
		isSameReorderList(dragSource, rowTarget);
	const dropEdge =
		dropTarget?.pathKey === node.pathKey ? dropTarget.edge : null;
	// Resolve the right bulk-path-key set for THIS row's resource. PSL is a
	// single global Set today (one bulk active at a time); AI sections and
	// TriggerData are per-(bundleId, index) so the same row in two different
	// bundles can be in or out of bulk independently.
	const activeBulkKeys: ReadonlySet<string> | null =
		node.resourceKey === 'polygonSoupList'
			? pslBulkPathKeys
			: node.resourceKey === 'aiSections' && aiBulkGetPathKeys
				? aiBulkGetPathKeys(node.bundleId, node.index)
				: node.resourceKey === 'triggerData' && triggerBulkGetPathKeys
					? triggerBulkGetPathKeys(node.bundleId, node.index)
					: null;

	// Schema rows whose schema path is in the active bulk wear an amber
	// border + faint amber tint — same accent as the 3D overlay's bulk
	// colour so a curated multi-selection reads the same in the tree and the
	// viewport. AI sections + TriggerData sub-paths normalise to their
	// containing entry inside `onBulkToggle`, so a sub-row inherits the tint
	// via prefix match (see rowIsInBulk).
	const isInBulk = rowIsInBulk(node.resourceKey, node.schemaPath, activeBulkKeys);
	return (
		<div
			className={cn(
				// border-l-2 transparent by default keeps the amber accent
				// from shifting layout when a row enters the bulk set.
				'flex items-center gap-1 py-0.5 pr-1 cursor-pointer border-l-2 border-transparent',
				isInBulk && 'border-amber-500',
				node.isSelected && 'bg-primary/15 text-primary font-medium',
				!node.isSelected && isInBulk && 'bg-amber-500/10',
				!node.isSelected && !isInBulk && node.isOnPath && 'bg-muted/30',
				!node.isSelected && 'hover:bg-muted/40',
				// Drop indicator: a primary-coloured border on the edge the
				// dragged row would land against. Inset (negative margin) so the
				// 2px line doesn't nudge the row's layout.
				dropEdge === 'top' && 'border-t-2 border-t-primary -mt-px',
				dropEdge === 'bottom' && 'border-b-2 border-b-primary -mb-px',
				// Faintly dim the row being dragged so the user can see it lift.
				dragSource != null &&
					address != null &&
					dragSource.bundleId === node.bundleId &&
					dragSource.resourceKey === node.resourceKey &&
					dragSource.instanceIndex === node.index &&
					dragSource.itemIndex === address.index &&
					'opacity-40',
			)}
			style={{ paddingLeft: node.depth * 12 + 4 }}
			draggable={isReorderable}
			onDragStart={
				isReorderable && address
					? (e) => {
						// Mark this as a move so the cursor reflects reorder, not
						// copy. `setData` is required for Firefox to start a drag
						// at all — the value is unused (drag identity is held in
						// React state, which survives across rows; the DataTransfer
						// string would only carry within one drop).
						e.dataTransfer.effectAllowed = 'move';
						try {
							e.dataTransfer.setData('text/plain', node.pathKey);
						} catch {
							/* some browsers throw on programmatic setData; ignore */
						}
						onReorderDragStart({
							bundleId: node.bundleId,
							resourceKey: node.resourceKey,
							instanceIndex: node.index,
							listPath: address.listPath,
							itemIndex: address.index,
						});
					}
					: undefined
			}
			onDragOver={
				isDropEligible && address
					? (e) => {
						// preventDefault is what tells the browser this is a valid
						// drop target (without it `onDrop` never fires). Pick the
						// edge from the pointer's position within the row so the
						// indicator lands above or below.
						e.preventDefault();
						e.dataTransfer.dropEffect = 'move';
						const rect = e.currentTarget.getBoundingClientRect();
						const edge: 'top' | 'bottom' =
							e.clientY - rect.top < rect.height / 2 ? 'top' : 'bottom';
						onReorderDragOverRow({ pathKey: node.pathKey, edge });
					}
					: undefined
			}
			onDrop={
				isDropEligible && rowTarget && address
					? (e) => {
						e.preventDefault();
						const rect = e.currentTarget.getBoundingClientRect();
						const edge: 'top' | 'bottom' =
							e.clientY - rect.top < rect.height / 2 ? 'top' : 'bottom';
						onReorderDrop(rowTarget, address.index, edge);
					}
					: undefined
			}
			onDragEnd={isReorderable ? () => onReorderDragEnd() : undefined}
			onClick={(e) => {
				e.stopPropagation();
				onSelectSchema(
					node.bundleId,
					node.resourceKey,
					node.index,
					node.schemaPath,
					{
						shift: e.shiftKey,
						ctrl: e.ctrlKey || e.metaKey,
					},
				);
			}}
		>
			{node.isExpandable ? (
				<button
					type="button"
					className="w-4 h-4 flex items-center justify-center text-muted-foreground shrink-0"
					onClick={(e) => {
						e.stopPropagation();
						onToggleExpansion(node.pathKey);
					}}
				>
					{node.isExpanded ? (
						<ChevronDown className="h-3 w-3" />
					) : (
						<ChevronRight className="h-3 w-3" />
					)}
				</button>
			) : (
				<span className="w-4 shrink-0" />
			)}
			<span className="flex-1 truncate">{node.label}</span>
			{node.childCount != null && (
				<span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
					{node.childCount}
				</span>
			)}
		</div>
	);
}

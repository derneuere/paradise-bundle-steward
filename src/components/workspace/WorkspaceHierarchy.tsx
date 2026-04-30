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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useWorkspace } from '@/context/WorkspaceContext';
import type { VisibilityNode } from '@/context/WorkspaceContext.types';
import type { NodePath } from '@/lib/schema/walk';
import {
	bundleKey,
	buildWorkspaceFlat,
	type BundleFlatNode,
	type FlatNode,
	type InstanceFlatNode,
	type ResourceTypeFlatNode,
	type SchemaFlatNode,
} from './WorkspaceHierarchy.helpers';

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
// Component
// ---------------------------------------------------------------------------

export type WorkspaceHierarchyProps = {
	onAddBundle: () => void;
};

export function WorkspaceHierarchy({ onAddBundle }: WorkspaceHierarchyProps) {
	const { bundles, selection, select, saveBundle, closeBundle } = useWorkspace();

	// Persisted expansion state. Default-expanded behaviour mirrors the
	// pre-WorkspaceHierarchy tree:
	//   - 1 Bundle → bundle defaults to expanded.
	//   - 2+ Bundles → all collapsed by default (the tree turns into a
	//     Bundle picker; user expands what they need).
	// We seed each Bundle's default once, so user toggles persist after
	// later loads add a second Bundle.
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [seededBundles, setSeededBundles] = useState<Set<string>>(() => new Set());

	useEffect(() => {
		const newSeeds: string[] = [];
		const newExpands: string[] = [];
		for (const b of bundles) {
			if (seededBundles.has(b.id)) continue;
			newSeeds.push(b.id);
			if (bundles.length === 1) newExpands.push(bundleKey(b.id));
		}
		if (newSeeds.length === 0) return;
		setSeededBundles((prev) => {
			const next = new Set(prev);
			for (const id of newSeeds) next.add(id);
			return next;
		});
		if (newExpands.length > 0) {
			setExpanded((prev) => {
				const next = new Set(prev);
				for (const k of newExpands) next.add(k);
				return next;
			});
		}
	}, [bundles, seededBundles]);

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
		(bundleId: string, resourceKey: string, index: number, schemaPath: NodePath) => {
			select({ bundleId, resourceKey, index, path: schemaPath });
		},
		[select],
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

	useEffect(() => {
		if (selectedFlatIndex >= 0) {
			rowVirtualizer.scrollToIndex(selectedFlatIndex, {
				align: 'auto',
				behavior: 'auto',
			});
		}
	}, [selectedFlatIndex, rowVirtualizer]);

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
	) => void;
	saveBundle: (bundleId: string) => Promise<void>;
	closeBundle: (bundleId: string) => Promise<void>;
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
}: HierarchyRowProps & { node: ResourceTypeFlatNode }) {
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
}: HierarchyRowProps & { node: SchemaFlatNode }) {
	return (
		<div
			className={cn(
				'flex items-center gap-1 py-0.5 pr-1 cursor-pointer',
				node.isSelected && 'bg-primary/15 text-primary font-medium',
				!node.isSelected && node.isOnPath && 'bg-muted/30',
				!node.isSelected && 'hover:bg-muted/40',
			)}
			style={{ paddingLeft: node.depth * 12 + 4 }}
			onClick={(e) => {
				e.stopPropagation();
				onSelectSchema(
					node.bundleId,
					node.resourceKey,
					node.index,
					node.schemaPath,
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

export default WorkspaceHierarchy;

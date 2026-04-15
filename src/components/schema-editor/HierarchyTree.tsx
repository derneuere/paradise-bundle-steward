// Unity-style hierarchy tree for the schema-driven editor.
//
// Walks the schema + data together and renders a collapsible tree of:
//   - Records (expandable)
//   - Lists of records (expandable folders with count badges)
// Primitive fields and lists of primitives don't show up in the tree —
// they only appear in the inspector on the right.

import React, { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import type {
	FieldSchema,
	ListFieldSchema,
	RecordFieldSchema,
	RecordSchema,
	SchemaContext,
} from '@/lib/schema/types';
import { useSchemaEditor } from './context';
import type { NodePath } from '@/lib/schema/walk';

// ---------------------------------------------------------------------------
// Tree node types — precomputed so rendering is cheap
// ---------------------------------------------------------------------------

type TreeNode = {
	// Absolute path to this node in the data.
	path: NodePath;
	// Display label.
	label: string;
	// Field this node represents (undefined only for the synthetic root).
	field?: FieldSchema;
	// Record schema when the node's value is a record instance.
	recordSchema?: RecordSchema;
	// Children computed lazily on first expand.
	isExpandable: boolean;
	// For list-of-records nodes, the list count — shown as a badge.
	childCount?: number;
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function pathKey(path: NodePath): string {
	return path.join('/') || '__root__';
}

function pathsEqual(a: NodePath, b: NodePath): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function isPathAncestor(ancestor: NodePath, descendant: NodePath): boolean {
	if (ancestor.length > descendant.length) return false;
	for (let i = 0; i < ancestor.length; i++) {
		if (ancestor[i] !== descendant[i]) return false;
	}
	return true;
}

// Is this field worth showing as a tree node? Records and lists of records
// are — everything else is inspector-only.
function isExpandableField(field: FieldSchema): boolean {
	if (field.kind === 'record') return true;
	if (field.kind === 'list' && field.item.kind === 'record') return true;
	return false;
}

// Compute the children of a node on demand. Lazy so huge trees (e.g.
// thousands of rungs) don't walk until the user expands them.
function computeChildren(
	node: TreeNode,
	value: unknown,
	ctx: SchemaContext,
): TreeNode[] {
	if (!node.isExpandable) return [];

	// Synthetic root or record node: emit children for each expandable field.
	if (node.recordSchema && value != null && typeof value === 'object') {
		const out: TreeNode[] = [];
		for (const [fieldName, fieldSchema] of Object.entries(node.recordSchema.fields)) {
			const meta = node.recordSchema.fieldMetadata?.[fieldName];
			if (meta?.hidden) continue;
			if (!isExpandableField(fieldSchema)) continue;

			const childPath: NodePath = [...node.path, fieldName];
			const childValue = (value as Record<string, unknown>)[fieldName];

			if (fieldSchema.kind === 'record') {
				const rf = fieldSchema as RecordFieldSchema;
				const childRecord = ctx.resource.registry[rf.type];
				out.push({
					path: childPath,
					label: meta?.label ?? fieldName,
					field: fieldSchema,
					recordSchema: childRecord,
					isExpandable: true,
				});
			} else if (fieldSchema.kind === 'list') {
				const lf = fieldSchema as ListFieldSchema;
				const listValue = Array.isArray(childValue) ? childValue : [];
				out.push({
					path: childPath,
					label: meta?.label ?? fieldName,
					field: fieldSchema,
					// List nodes don't have their OWN record — it's their items that do.
					isExpandable: lf.item.kind === 'record',
					childCount: listValue.length,
				});
			}
		}
		return out;
	}

	// List node — emit one child per list item.
	if (node.field?.kind === 'list' && Array.isArray(value)) {
		const lf = node.field as ListFieldSchema;
		if (lf.item.kind !== 'record') return [];
		const itemType = (lf.item as RecordFieldSchema).type;
		const itemRecord = ctx.resource.registry[itemType];
		return value.map((item, i) => {
			let label = `#${i}`;
			if (lf.itemLabel) {
				try {
					label = lf.itemLabel(item, i, ctx);
				} catch { /* ignore */ }
			} else if (itemRecord?.label) {
				try {
					label = itemRecord.label(item as Record<string, unknown>, i, ctx);
				} catch { /* ignore */ }
			}
			return {
				path: [...node.path, i],
				label,
				field: lf.item,
				recordSchema: itemRecord,
				isExpandable: !!itemRecord && Object.values(itemRecord.fields).some((f) => {
					const m = itemRecord.fieldMetadata?.[Object.keys(itemRecord.fields).find((k) => itemRecord.fields[k] === f) ?? ''];
					if (m?.hidden) return false;
					return isExpandableField(f);
				}),
			};
		});
	}

	return [];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HierarchyTree() {
	const { resource, data, selectedPath, selectPath } = useSchemaEditor();
	const ctx = useMemo<SchemaContext>(() => ({ root: data, resource }), [data, resource]);

	const rootRecord = resource.registry[resource.rootType];

	// Default-expanded paths: everything on the root + any ancestor of the
	// current selection. Stored as stringified paths.
	const [expanded, setExpanded] = useState<Set<string>>(() => {
		const out = new Set<string>(['__root__']);
		// Expand ancestors of the initial selection.
		for (let i = 0; i < selectedPath.length; i++) {
			out.add(selectedPath.slice(0, i).join('/') || '__root__');
		}
		return out;
	});

	const toggle = useCallback((path: NodePath) => {
		const key = pathKey(path);
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);

	// Ensure the selection's ancestors stay expanded (so navigating via a
	// ref button reveals the target).
	const expandedWithSelection = useMemo(() => {
		const out = new Set(expanded);
		for (let i = 0; i <= selectedPath.length; i++) {
			out.add(selectedPath.slice(0, i).join('/') || '__root__');
		}
		return out;
	}, [expanded, selectedPath]);

	if (!rootRecord) {
		return <div className="p-3 text-xs text-destructive">Root type &quot;{resource.rootType}&quot; not in registry.</div>;
	}

	const rootNode: TreeNode = {
		path: [],
		label: resource.name,
		recordSchema: rootRecord,
		isExpandable: true,
	};

	return (
		<ScrollArea className="h-full">
			<div className="p-2 text-xs">
				<TreeRow
					node={rootNode}
					depth={0}
					expandedWithSelection={expandedWithSelection}
					toggle={toggle}
					selectedPath={selectedPath}
					selectPath={selectPath}
					ctx={ctx}
				/>
			</div>
		</ScrollArea>
	);
}

// ---------------------------------------------------------------------------
// Row renderer (recursive)
// ---------------------------------------------------------------------------

type TreeRowProps = {
	node: TreeNode;
	depth: number;
	expandedWithSelection: Set<string>;
	toggle: (path: NodePath) => void;
	selectedPath: NodePath;
	selectPath: (path: NodePath) => void;
	ctx: SchemaContext;
};

function TreeRow({ node, depth, expandedWithSelection, toggle, selectedPath, selectPath, ctx }: TreeRowProps) {
	const key = pathKey(node.path);
	const isExpanded = expandedWithSelection.has(key);
	const isSelected = pathsEqual(node.path, selectedPath);
	const isOnPath = !isSelected && isPathAncestor(node.path, selectedPath) && node.path.length < selectedPath.length;

	const value = useMemo(() => walkDataAtPath(ctx.root, node.path), [ctx.root, node.path]);

	const children = useMemo(() => {
		if (!isExpanded) return [];
		return computeChildren(node, value, ctx);
	}, [isExpanded, node, value, ctx]);

	return (
		<div>
			<div
				className={cn(
					'flex items-center gap-1 py-0.5 pr-1 cursor-pointer rounded',
					isSelected && 'bg-primary/15 text-primary font-medium',
					!isSelected && isOnPath && 'bg-muted/30',
					!isSelected && 'hover:bg-muted/40',
				)}
				style={{ paddingLeft: depth * 12 + 4 }}
				onClick={(e) => {
					e.stopPropagation();
					selectPath(node.path);
				}}
			>
				{node.isExpandable ? (
					<button
						className="w-4 h-4 flex items-center justify-center text-muted-foreground shrink-0"
						onClick={(e) => {
							e.stopPropagation();
							toggle(node.path);
						}}
					>
						{isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
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
			{isExpanded &&
				children.map((child) => (
					<TreeRow
						key={pathKey(child.path)}
						node={child}
						depth={depth + 1}
						expandedWithSelection={expandedWithSelection}
						toggle={toggle}
						selectedPath={selectedPath}
						selectPath={selectPath}
						ctx={ctx}
					/>
				))}
		</div>
	);
}

// Walks data along a path. Small duplicate of getAtPath — inlined so this
// component doesn't re-import walk.ts.
function walkDataAtPath(root: unknown, path: NodePath): unknown {
	let node: unknown = root;
	for (const seg of path) {
		if (node == null) return undefined;
		if (typeof seg === 'number') {
			if (!Array.isArray(node)) return undefined;
			node = node[seg];
		} else {
			if (typeof node !== 'object') return undefined;
			node = (node as Record<string, unknown>)[seg];
		}
	}
	return node;
}

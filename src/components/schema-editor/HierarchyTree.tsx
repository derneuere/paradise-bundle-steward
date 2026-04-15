// Unity-style hierarchy tree for the schema-driven editor.
//
// Walks the schema + data together and renders a collapsible tree of:
//   - Records (expandable)
//   - Lists of records (expandable folders with count badges)
// Primitive fields and lists of primitives don't show up in the tree —
// they only appear in the inspector on the right.
//
// Rendering strategy: the tree is flattened to a linear `FlatNode[]` and
// rendered through `@tanstack/react-virtual`. For resources with very
// long lists (TriggerData has 5613 genericRegions, AISections has 8780
// sections) a naïve recursive render re-reconciles every visible row on
// every selection change, which tanks click latency. The flat-list
// approach gives us three wins:
//
//   1. Only ~30 rows render at a time regardless of list length.
//   2. The flat list is memoized on (data, effectiveExpanded, resource)
//      so selection changes don't rebuild it.
//   3. TreeRow is React.memo'd, so on a selection change only the
//      previously-selected and newly-selected rows actually re-render;
//      every other visible row bails out on shallow-equal props.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import type {
	FieldSchema,
	ListFieldSchema,
	RecordFieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaContext,
} from '@/lib/schema/types';
import { useSchemaEditor } from './context';
import { useSchemaBulkSelection } from './bulkSelectionContext';
import type { NodePath } from '@/lib/schema/walk';

// ---------------------------------------------------------------------------
// Flat-list types
// ---------------------------------------------------------------------------

// One visible row in the tree. We keep this small and flat so the
// virtualizer can allocate a dense array and React can shallow-compare
// rows cheaply. The row itself holds no schema references — the renderer
// doesn't need them once the label + depth have been computed.
type FlatNode = {
	path: NodePath;
	/** Stringified path — used as React key and for expansion set lookups. */
	pathKey: string;
	depth: number;
	label: string;
	/** True for records and list-of-record nodes (anything the tree can dive into). */
	isExpandable: boolean;
	/** Current expansion state at build time — used to pick the chevron icon. */
	isExpanded: boolean;
	/** For list nodes, the number of items (shown as a badge). */
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

// ---------------------------------------------------------------------------
// Flat-list builder — depth-first walk of schema + data, respecting expansion
// ---------------------------------------------------------------------------

// Walk the root record and produce a flat array of visible rows. Only
// descends into a node when its path is in `expanded`; unexpanded
// subtrees contribute just their header row.
//
// Performance notes:
//   - Called from useMemo keyed on (data, expanded, resource), so it's
//     rebuilt rarely in practice.
//   - Linear in the number of visible nodes. For TriggerData with
//     genericRegions fully expanded (5613 items) that's ~5700 pushes plus
//     one label callback per row. Comfortably under a frame budget.
//   - Label callbacks run here, not at render time. React renders only
//     the 30-or-so visible rows, but the flat list needs the full set so
//     scroll-to-index can find a selection anywhere in the tree.
function buildFlatList(
	resource: ResourceSchema,
	data: unknown,
	expanded: Set<string>,
): FlatNode[] {
	const rootRecord = resource.registry[resource.rootType];
	if (!rootRecord) return [];

	const out: FlatNode[] = [];
	const ctx: SchemaContext = { root: data, resource };
	visitRecord([], rootRecord, data, 0, resource.name, out, ctx, expanded);
	return out;
}

function visitRecord(
	path: NodePath,
	record: RecordSchema,
	value: unknown,
	depth: number,
	label: string,
	out: FlatNode[],
	ctx: SchemaContext,
	expanded: Set<string>,
): void {
	const key = pathKey(path);
	const isExpanded = expanded.has(key);
	out.push({ path, pathKey: key, depth, label, isExpandable: true, isExpanded });
	if (!isExpanded) return;
	if (value == null || typeof value !== 'object') return;

	for (const [fieldName, fieldSchema] of Object.entries(record.fields)) {
		const meta = record.fieldMetadata?.[fieldName];
		if (meta?.hidden) continue;
		if (!isExpandableField(fieldSchema)) continue;

		const childPath: NodePath = [...path, fieldName];
		const childValue = (value as Record<string, unknown>)[fieldName];
		const childLabel = meta?.label ?? fieldName;

		if (fieldSchema.kind === 'record') {
			const rf = fieldSchema as RecordFieldSchema;
			const childRecord = ctx.resource.registry[rf.type];
			if (childRecord) {
				visitRecord(childPath, childRecord, childValue, depth + 1, childLabel, out, ctx, expanded);
			}
		} else if (fieldSchema.kind === 'list') {
			visitList(childPath, fieldSchema, childValue, depth + 1, childLabel, out, ctx, expanded);
		}
	}
}

function visitList(
	path: NodePath,
	listField: ListFieldSchema,
	value: unknown,
	depth: number,
	label: string,
	out: FlatNode[],
	ctx: SchemaContext,
	expanded: Set<string>,
): void {
	const key = pathKey(path);
	const listValue = Array.isArray(value) ? value : [];
	const itemIsRecord = listField.item.kind === 'record';
	const isExpanded = expanded.has(key);

	out.push({
		path,
		pathKey: key,
		depth,
		label,
		isExpandable: itemIsRecord,
		isExpanded,
		childCount: listValue.length,
	});

	if (!isExpanded || !itemIsRecord) return;

	const itemType = (listField.item as RecordFieldSchema).type;
	const itemRecord = ctx.resource.registry[itemType];
	if (!itemRecord) return;

	for (let i = 0; i < listValue.length; i++) {
		const item = listValue[i];
		const itemPath: NodePath = [...path, i];
		let itemLabel = `#${i}`;
		if (listField.itemLabel) {
			try {
				itemLabel = listField.itemLabel(item, i, ctx);
			} catch {
				/* keep fallback */
			}
		} else if (itemRecord.label) {
			try {
				itemLabel = itemRecord.label(item as Record<string, unknown>, i, ctx);
			} catch {
				/* keep fallback */
			}
		}
		visitRecord(itemPath, itemRecord, item, depth + 1, itemLabel, out, ctx, expanded);
	}
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HierarchyTree() {
	const { resource, data, selectedPath, selectPath } = useSchemaEditor();
	const bulk = useSchemaBulkSelection();
	const bulkPathKeys = bulk?.bulkPathKeys;
	const onBulkToggle = bulk?.onBulkToggle;

	const rootRecord = resource.registry[resource.rootType];

	// Persisted expansion state. Root is always expanded at mount. Any
	// ancestors of the initial selection are pre-expanded so deep links
	// land on a visible row.
	const [expanded, setExpanded] = useState<Set<string>>(() => {
		const out = new Set<string>(['__root__']);
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

	// Effective expansion: persisted expansion unioned with the ancestors of
	// the current selection. Matches the old "ephemeral auto-expand" behavior.
	const effectiveExpanded = useMemo(() => {
		const out = new Set(expanded);
		for (let i = 0; i <= selectedPath.length; i++) {
			out.add(selectedPath.slice(0, i).join('/') || '__root__');
		}
		return out;
	}, [expanded, selectedPath]);

	// The flat list is the sole render surface. Memoized on data +
	// effectiveExpanded + resource, so clicks that don't change the visible
	// expansion or the data don't rebuild it.
	const flat = useMemo<FlatNode[]>(
		() => buildFlatList(resource, data, effectiveExpanded),
		[resource, data, effectiveExpanded],
	);

	// Index lookup for the currently-selected path. Used both to drive
	// scroll-to-view and to tell individual rows whether they're selected
	// without a full O(flat) pathsEqual walk.
	const selectedKey = pathKey(selectedPath);
	const selectedIndex = useMemo(() => {
		for (let i = 0; i < flat.length; i++) {
			if (flat[i].pathKey === selectedKey) return i;
		}
		return -1;
	}, [flat, selectedKey]);

	// Virtualized scroll setup.
	const parentRef = useRef<HTMLDivElement>(null);
	const rowVirtualizer = useVirtualizer({
		count: flat.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 22,
		overscan: 20,
		getItemKey: (index) => flat[index]?.pathKey ?? index,
	});

	// Scroll the selection into view whenever the selected row moves. We
	// don't force-scroll on every selection — `scrollToIndex` with
	// align: 'auto' is a no-op when the target is already visible.
	useEffect(() => {
		if (selectedIndex >= 0) {
			rowVirtualizer.scrollToIndex(selectedIndex, { align: 'auto', behavior: 'auto' });
		}
	}, [selectedIndex, rowVirtualizer]);

	if (!rootRecord) {
		return <div className="p-3 text-xs text-destructive">Root type &quot;{resource.rootType}&quot; not in registry.</div>;
	}

	const items = rowVirtualizer.getVirtualItems();

	return (
		<div ref={parentRef} className="h-full overflow-auto p-2 text-xs">
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
					const isSelected = vi.index === selectedIndex;
					const isOnPath =
						!isSelected &&
						isPathAncestor(node.path, selectedPath) &&
						node.path.length < selectedPath.length;
					const isInBulk = bulkPathKeys?.has(node.pathKey) ?? false;
					return (
						<div
							key={vi.key}
							data-index={vi.index}
							ref={rowVirtualizer.measureElement}
							className="absolute left-0 right-0"
							style={{ transform: `translateY(${vi.start}px)` }}
						>
							<TreeRow
								node={node}
								isSelected={isSelected}
								isOnPath={isOnPath}
								isInBulk={isInBulk}
								onSelect={selectPath}
								onToggle={toggle}
								onBulkToggle={onBulkToggle}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Row — memoized so selection-only changes skip the vast majority of visible
// rows. Only the rows whose isSelected / isOnPath flips actually re-render.
// ---------------------------------------------------------------------------

type TreeRowProps = {
	node: FlatNode;
	isSelected: boolean;
	isOnPath: boolean;
	isInBulk: boolean;
	onSelect: (path: NodePath) => void;
	onToggle: (path: NodePath) => void;
	onBulkToggle?: (path: NodePath) => void;
};

const TreeRow = React.memo(function TreeRow({
	node,
	isSelected,
	isOnPath,
	isInBulk,
	onSelect,
	onToggle,
	onBulkToggle,
}: TreeRowProps) {
	return (
		<div
			className={cn(
				// border-l-2 transparent by default keeps the amber accent from
				// shifting the layout when a row enters the bulk selection.
				'flex items-center gap-1 py-0.5 pr-1 cursor-pointer rounded border-l-2 border-transparent',
				isInBulk && 'border-amber-500',
				isSelected && 'bg-primary/15 text-primary font-medium',
				!isSelected && isInBulk && 'bg-amber-500/10',
				!isSelected && !isInBulk && isOnPath && 'bg-muted/30',
				!isSelected && 'hover:bg-muted/40',
			)}
			style={{ paddingLeft: node.depth * 12 + 4 }}
			onClick={(e) => {
				e.stopPropagation();
				// Ctrl/Cmd (Strg) click: toggle this row in the bulk selection
				// without moving the inspector focus, if a bulk context is active.
				if ((e.ctrlKey || e.metaKey) && onBulkToggle) {
					onBulkToggle(node.path);
					return;
				}
				onSelect(node.path);
			}}
		>
			{node.isExpandable ? (
				<button
					className="w-4 h-4 flex items-center justify-center text-muted-foreground shrink-0"
					onClick={(e) => {
						e.stopPropagation();
						onToggle(node.path);
					}}
				>
					{node.isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
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
});

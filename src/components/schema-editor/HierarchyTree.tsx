// Unity-style hierarchy tree for the schema-driven editor.
//
// Walks the schema + data together and renders a collapsible tree of:
//   - Records (expandable)
//   - Lists of records (expandable folders with count badges)
// Primitive fields and lists of primitives don't show up in the tree —
// they only appear in the inspector on the right.
//
// Multi-resource picker mode:
//   When a MultiResourcePickerContext is present (see PolygonSoupListPage),
//   the tree prepends one top-level "resource row" per parsed resource of
//   the host handler's type. Each resource row gets an eye icon (click to
//   toggle viewport visibility, alt-click to solo) and clicking the row
//   body selects that resource for editing. Only the currently-selected
//   resource's schema subtree is expanded beneath its row — switching
//   swaps the subtree. A header above the scroll container carries sort
//   / search / hide-empty controls. Single-resource pages (TrafficData,
//   StreetData) don't mount the context, so the tree renders exactly as
//   before.
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

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useScrollToVirtualRow } from '@/hooks/useScrollToVirtualRow';
import { useEnsureMapEntry } from '@/hooks/useEnsureMapEntry';
import { ChevronDown, ChevronRight, Eye, EyeOff, Search } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
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
import {
	useMultiResourcePicker,
	type MultiResourcePickerValue,
	type PickerRow,
} from './multiResourcePickerContext';
import type { NodePath } from '@/lib/schema/walk';

// ---------------------------------------------------------------------------
// Flat-list types
// ---------------------------------------------------------------------------

// Schema tree row — records and list-of-record folders inside a single
// resource. Unchanged from pre-picker layout.
type SchemaFlatNode = {
	kind: 'schema';
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

// Resource-level row emitted only when the picker context is active. Lives
// at depth 0; the selected resource's schema tree hangs underneath it.
type PickerFlatNode = {
	kind: 'picker';
	pathKey: string;
	/** The underlying picker row — carries label, visibility, and the model
	 *  index used to switch selection. */
	row: PickerRow;
	isSelected: boolean;
};

type FlatNode = SchemaFlatNode | PickerFlatNode;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function pathKey(path: NodePath): string {
	return path.join('/') || '__root__';
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
// subtrees contribute just their header row. `baseDepth` lets the caller
// nest the whole tree under a picker row by adding one to every depth.
function buildFlatSchema(
	resource: ResourceSchema,
	data: unknown,
	expanded: Set<string>,
	baseDepth: number,
): SchemaFlatNode[] {
	const rootRecord = resource.registry[resource.rootType];
	if (!rootRecord) return [];

	const out: SchemaFlatNode[] = [];
	const ctx: SchemaContext = { root: data, resource };
	visitRecord([], rootRecord, data, baseDepth, resource.name, out, ctx, expanded);
	return out;
}

function visitRecord(
	path: NodePath,
	record: RecordSchema,
	value: unknown,
	depth: number,
	label: string,
	out: SchemaFlatNode[],
	ctx: SchemaContext,
	expanded: Set<string>,
): void {
	const key = pathKey(path);
	const isExpanded = expanded.has(key);
	out.push({ kind: 'schema', path, pathKey: key, depth, label, isExpandable: true, isExpanded });
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
	out: SchemaFlatNode[],
	ctx: SchemaContext,
	expanded: Set<string>,
): void {
	const key = pathKey(path);
	const listValue = Array.isArray(value) ? value : [];
	const itemIsRecord = listField.item.kind === 'record';
	const isExpanded = expanded.has(key);

	out.push({
		kind: 'schema',
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

// Weave picker rows and the currently-selected resource's schema tree into
// a single flat list. Non-selected resource rows render as siblings at
// depth 0 without children; only the selected row gets a subtree below it.
function buildFlatWithPicker(
	picker: MultiResourcePickerValue,
	schemaFlat: SchemaFlatNode[],
): FlatNode[] {
	const out: FlatNode[] = [];
	for (const row of picker.rows) {
		const isSelected = row.modelIndex === picker.selectedModelIndex;
		out.push({
			kind: 'picker',
			pathKey: `__picker:${row.ctx.id}__`,
			row,
			isSelected,
		});
		if (isSelected) {
			for (const node of schemaFlat) out.push(node);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HierarchyTree() {
	const { resource, data, selectedPath, selectPath } = useSchemaEditor();
	const bulk = useSchemaBulkSelection();
	const bulkPathKeys = bulk?.bulkPathKeys;
	const onBulkToggle = bulk?.onBulkToggle;
	const onBulkRange = bulk?.onBulkRange;
	const picker = useMultiResourcePicker();

	const rootRecord = resource.registry[resource.rootType];

	// Persisted expansion state. Root is always expanded at mount. Any
	// ancestors of the initial selection are pre-expanded so deep links
	// land on a visible row.
	//
	// When the picker is active we scope expansion by the selected resource
	// id so switching resources and coming back preserves each resource's
	// expansion state independently — matches the "no auto-collapse" ask.
	const expansionScope = picker
		? `${picker.handlerKey}:${picker.rows.find((r) => r.modelIndex === picker.selectedModelIndex)?.ctx.id ?? 'none'}`
		: '__single__';
	const [expandedByScope, setExpandedByScope] = useState<Map<string, Set<string>>>(() => new Map());

	const expanded = useMemo(() => {
		const existing = expandedByScope.get(expansionScope);
		if (existing) return existing;
		const out = new Set<string>(['__root__']);
		for (let i = 0; i < selectedPath.length; i++) {
			out.add(selectedPath.slice(0, i).join('/') || '__root__');
		}
		return out;
	}, [expandedByScope, expansionScope, selectedPath]);

	// Make sure the map has a Set for the current scope so future toggles
	// have something to clone from; seeded lazily via the memo above.
	useEnsureMapEntry(setExpandedByScope, expansionScope, expanded);

	const toggle = useCallback(
		(path: NodePath) => {
			const key = pathKey(path);
			setExpandedByScope((prev) => {
				const nextMap = new Map(prev);
				const existing = nextMap.get(expansionScope) ?? new Set(['__root__']);
				const next = new Set(existing);
				if (next.has(key)) next.delete(key);
				else next.add(key);
				nextMap.set(expansionScope, next);
				return nextMap;
			});
		},
		[expansionScope],
	);

	// Effective expansion: persisted expansion unioned with the ancestors of
	// the current selection. Matches the old "ephemeral auto-expand" behavior.
	const effectiveExpanded = useMemo(() => {
		const out = new Set(expanded);
		for (let i = 0; i <= selectedPath.length; i++) {
			out.add(selectedPath.slice(0, i).join('/') || '__root__');
		}
		return out;
	}, [expanded, selectedPath]);

	// Schema rows for the currently-selected resource. In picker mode these
	// get nested under the selected picker row (depth shifted by +1); in
	// single-resource mode they render at the root.
	const schemaBaseDepth = picker ? 1 : 0;
	const schemaFlat = useMemo<SchemaFlatNode[]>(
		() => buildFlatSchema(resource, data, effectiveExpanded, schemaBaseDepth),
		[resource, data, effectiveExpanded, schemaBaseDepth],
	);

	// Final flat list — either schema-only or picker+schema. Memoized so
	// selection changes within a schema don't rebuild picker row objects.
	const flat = useMemo<FlatNode[]>(() => {
		if (!picker) return schemaFlat;
		return buildFlatWithPicker(picker, schemaFlat);
	}, [picker, schemaFlat]);

	// Index lookup for the currently-selected path. Used both to drive
	// scroll-to-view and to tell individual rows whether they're selected
	// without a full O(flat) pathsEqual walk.
	const selectedKey = pathKey(selectedPath);
	const selectedIndex = useMemo(() => {
		for (let i = 0; i < flat.length; i++) {
			const node = flat[i];
			if (node.kind === 'schema' && node.pathKey === selectedKey) return i;
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

	// Scroll the selection into view whenever the selected row moves.
	// `scrollToIndex` with align: 'auto' is a no-op when the target is
	// already visible, so this doesn't fight user scroll.
	useScrollToVirtualRow(rowVirtualizer, selectedIndex);

	if (!rootRecord) {
		return <div className="p-3 text-xs text-destructive">Root type &quot;{resource.rootType}&quot; not in registry.</div>;
	}

	const items = rowVirtualizer.getVirtualItems();

	return (
		<div className="h-full flex flex-col min-h-0">
			{picker && <PickerHeader picker={picker} />}
			<div ref={parentRef} className="flex-1 min-h-0 overflow-auto p-2 text-xs">
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

						if (node.kind === 'picker') {
							return (
								<div
									key={vi.key}
									data-index={vi.index}
									ref={rowVirtualizer.measureElement}
									className="absolute left-0 right-0"
									style={{ transform: `translateY(${vi.start}px)` }}
								>
									<PickerRowView
										row={node.row}
										isSelected={node.isSelected}
										onSelectModel={picker!.onSelectModel}
										onToggleVisible={picker!.onToggleVisible}
										onSoloVisible={picker!.onSoloVisible}
									/>
								</div>
							);
						}

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
									selectedPath={selectedPath}
									onSelect={selectPath}
									onToggle={toggle}
									onBulkToggle={onBulkToggle}
									onBulkRange={onBulkRange}
								/>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Picker header — sort / search / hide-empty controls. Rendered outside the
// virtualized scroll container so it stays pinned while the list scrolls.
// ---------------------------------------------------------------------------

function PickerHeader({ picker }: { picker: MultiResourcePickerValue }) {
	return (
		<div className="shrink-0 border-b bg-muted/20 px-2 py-1.5 flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5">
				<Search className="h-3 w-3 text-muted-foreground shrink-0" />
				<Input
					value={picker.searchQuery}
					onChange={(e) => picker.onSearchQueryChange(e.target.value)}
					placeholder="Filter resources…"
					className="h-6 text-[11px] px-1.5"
				/>
			</div>
			<div className="flex items-center gap-1.5">
				<Select value={picker.sortKey} onValueChange={picker.onSortKeyChange}>
					<SelectTrigger className="h-6 text-[11px] px-1.5 flex-1 min-w-0">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{picker.sortKeys.map((k) => (
							<SelectItem key={k.id} value={k.id} className="text-[11px]">
								{k.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer shrink-0">
					<input
						type="checkbox"
						className="h-3 w-3 cursor-pointer"
						checked={picker.hideEmpty}
						onChange={(e) => picker.onHideEmptyChange(e.target.checked)}
					/>
					Hide empty
				</label>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Picker resource row — eye icon + label. Alt/Option-click eye to solo.
// Plain click selects the resource for editing; click on eye toggles
// viewport visibility without moving selection.
// ---------------------------------------------------------------------------

type PickerRowViewProps = {
	row: PickerRow;
	isSelected: boolean;
	onSelectModel: (modelIndex: number) => void;
	onToggleVisible: (resourceId: string) => void;
	onSoloVisible: (resourceId: string) => void;
};

const PickerRowView = React.memo(function PickerRowView({
	row,
	isSelected,
	onSelectModel,
	onToggleVisible,
	onSoloVisible,
}: PickerRowViewProps) {
	const { label, visible } = row;
	return (
		<div
			className={cn(
				'flex items-center gap-1.5 py-0.5 pl-1 pr-1 cursor-pointer rounded border-l-2',
				isSelected && 'bg-primary/15 text-primary font-medium border-primary',
				!isSelected && 'border-transparent hover:bg-muted/40',
				!visible && 'opacity-50',
			)}
			onClick={(e) => {
				e.stopPropagation();
				onSelectModel(row.modelIndex);
			}}
			title={`${label.primary}${label.secondary ? ' — ' + label.secondary : ''}`}
		>
			<button
				className="w-4 h-4 flex items-center justify-center text-muted-foreground shrink-0 hover:text-foreground"
				onClick={(e) => {
					e.stopPropagation();
					if (e.altKey) onSoloVisible(row.ctx.id);
					else onToggleVisible(row.ctx.id);
				}}
				title={visible ? 'Click to hide · Alt-click to solo' : 'Click to show · Alt-click to solo'}
			>
				{visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
			</button>
			<span className="flex-1 min-w-0 truncate">{label.primary}</span>
			{label.secondary && (
				// Secondary meta shrinks away first when the panel is narrow —
				// high `flex-shrink` + the `truncate` clamp let the primary name
				// keep its space rather than getting clipped to "T_". The meta
				// text is still available as a tooltip on the row.
				<span
					className="text-[10px] text-muted-foreground tabular-nums truncate max-w-[96px]"
					style={{ flexShrink: 10 }}
				>
					{label.secondary}
				</span>
			)}
			{label.badges?.map((b, i) => (
				<span
					key={i}
					className={cn(
						'text-[9px] px-1 rounded shrink-0',
						b.tone === 'muted' && 'bg-muted/60 text-muted-foreground',
						b.tone === 'warn' && 'bg-destructive/20 text-destructive',
						b.tone === 'accent' && 'bg-primary/20 text-primary',
					)}
				>
					{b.label}
				</span>
			))}
		</div>
	);
});

// ---------------------------------------------------------------------------
// Row — memoized so selection-only changes skip the vast majority of visible
// rows. Only the rows whose isSelected / isOnPath flips actually re-render.
// ---------------------------------------------------------------------------

type TreeRowProps = {
	node: SchemaFlatNode;
	isSelected: boolean;
	isOnPath: boolean;
	isInBulk: boolean;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
	onToggle: (path: NodePath) => void;
	onBulkToggle?: (path: NodePath) => void;
	onBulkRange?: (from: NodePath, to: NodePath) => void;
};

const TreeRow = React.memo(function TreeRow({
	node,
	isSelected,
	isOnPath,
	isInBulk,
	selectedPath,
	onSelect,
	onToggle,
	onBulkToggle,
	onBulkRange,
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
				// Shift click: extend the bulk selection to this row using the
				// current inspector selection as the range anchor. The page's
				// onBulkRange implementation decides what "range" means (for
				// PolygonSoupList it's all polygons between the two, same soup).
				// Inspector also follows to the shift-clicked row so the anchor
				// moves forward and subsequent shift-clicks extend outward.
				if (e.shiftKey && onBulkRange && selectedPath.length > 0) {
					onBulkRange(selectedPath, node.path);
					onSelect(node.path);
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

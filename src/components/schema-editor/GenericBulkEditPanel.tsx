// Schema-driven bulk-edit panel.
//
// When the host page has bulk selection (Ctrl/Shift+click in the tree, or
// the marquee box-select in the 3D viewport), this panel walks the schema
// at each selected path and surfaces "apply N" rows for every editable
// primitive field on the items' shared RecordSchema. Fields that aren't
// straightforward primitives (composites, lists, nested records, refs,
// flags) are skipped for now — they'd need bespoke draft-mode editors.
//
// Heterogeneous selection is handled by grouping items by RecordSchema
// name and rendering one section per group. Each section's apply
// iterates only its own items, leaving the other group untouched.
//
// Apply path: a single root-level setAtPath call replaces the whole
// data tree with one assembled via setAtPathWalk per item, so N items
// produce one onChange / one re-render rather than N. Derives are NOT
// re-fired per item — the SchemaEditor's derive plumbing runs at the
// parent path of the changed segment, and a root-level write reports
// no parent. Acceptable trade-off for now: the only schema with derives
// is TrafficSectionSpan.mfMaxVehicleRecip, which is rarely the bulk
// target. If derives become important for bulk, extend this to call
// updateAtPath per item instead.
//
// Pages that ship their own specialized bulk panel (PolygonSoupListPage)
// set `suppressGenericInspectorPanel: true` in their bulk context value
// so this component renders nothing on those pages.

import React, { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import type { FieldMetadata, FieldSchema, RecordSchema } from '@/lib/schema/types';
import {
	getAtPath,
	resolveSchemaAtPath,
	setAtPath as setAtPathWalk,
	type NodePath,
} from '@/lib/schema/walk';
import { useSchemaEditor } from './context';
import { useSchemaBulkSelection } from './bulkSelectionContext';

// ---------------------------------------------------------------------------
// Path key parsing
// ---------------------------------------------------------------------------
//
// `bulkPathKeys` stores stringified paths (matches HierarchyTree's
// `path.join('/') || '__root__'` convention). To resolve schema and walk
// data we need to round-trip back to NodePath, treating any segment that
// fully parses as an integer as a numeric list index. Record field names
// that happen to be all-digits would alias here, but no schema in this
// codebase has an integer-named field — and the convention has been in
// use since HierarchyTree shipped, so changing it now would be its own
// migration.

function parsePathKey(key: string): NodePath {
	if (key === '__root__' || key === '') return [];
	return key.split('/').map((seg) => {
		const n = parseInt(seg, 10);
		return Number.isFinite(n) && String(n) === seg ? n : seg;
	});
}

// ---------------------------------------------------------------------------
// Bulk-editable field detection
// ---------------------------------------------------------------------------
//
// First-pass support: int / f32 / bool / enum. Composites (vec3/vec4/
// matrix44), lists, nested records, refs, flags, strings, and bigint are
// skipped — they'd need either a draft-mode FieldRenderer or a bespoke
// bulk control, both of which are bigger lifts than this panel's
// current scope.

type BulkEditableField =
	| { key: string; field: FieldSchema & { kind: 'u8' | 'u16' | 'u32' | 'i8' | 'i16' | 'i32' | 'f32' }; meta?: FieldMetadata }
	| { key: string; field: FieldSchema & { kind: 'bool' }; meta?: FieldMetadata }
	| { key: string; field: FieldSchema & { kind: 'enum' }; meta?: FieldMetadata };

function bulkEditableFields(record: RecordSchema): BulkEditableField[] {
	const out: BulkEditableField[] = [];
	for (const [key, field] of Object.entries(record.fields)) {
		const meta = record.fieldMetadata?.[key];
		if (meta?.hidden || meta?.readOnly) continue;
		switch (field.kind) {
			case 'u8': case 'u16': case 'u32':
			case 'i8': case 'i16': case 'i32':
			case 'f32':
				out.push({ key, field, meta });
				break;
			case 'bool':
				out.push({ key, field, meta });
				break;
			case 'enum':
				out.push({ key, field, meta });
				break;
			default:
				// Skip — see comment above.
				break;
		}
	}
	return out;
}

// Folded value across all selected items: either every item shares the
// same value (returned as `{ kind: 'all', value: T }`) or they don't
// (`{ kind: 'mixed' }`). Empty groups are impossible at the call site
// because the panel filters them out before rendering.
type Fold<T> = { kind: 'all'; value: T } | { kind: 'mixed' };

function foldField<T>(
	data: unknown,
	paths: NodePath[],
	fieldKey: string,
): Fold<T> {
	if (paths.length === 0) return { kind: 'mixed' };
	const first = getAtPath(data, [...paths[0], fieldKey]) as T;
	for (let i = 1; i < paths.length; i++) {
		const v = getAtPath(data, [...paths[i], fieldKey]) as T;
		if (v !== first) return { kind: 'mixed' };
	}
	return { kind: 'all', value: first };
}

// ---------------------------------------------------------------------------
// Per-field row
// ---------------------------------------------------------------------------

type RowProps = {
	entry: BulkEditableField;
	paths: NodePath[];
	data: unknown;
	onApply: (value: unknown) => void;
};

function NumericRow({ entry, paths, data, onApply }: RowProps) {
	const fold = foldField<number>(data, paths, entry.key);
	const initial = fold.kind === 'all' ? String(fold.value) : '';
	const [draft, setDraft] = useState(initial);
	// Re-seed draft when the fold flips from mixed back to homogeneous so
	// the input shows the new common value rather than stale text.
	React.useEffect(() => {
		if (fold.kind === 'all') setDraft(String(fold.value));
	}, [fold.kind, fold.kind === 'all' ? fold.value : null]);

	const isFloat = entry.field.kind === 'f32';
	const apply = () => {
		const parsed = isFloat ? parseFloat(draft) : parseInt(draft, 10);
		if (!Number.isFinite(parsed)) return;
		onApply(parsed);
	};

	const label = entry.meta?.label ?? entry.key;
	return (
		<div className="space-y-1">
			<div className="flex items-baseline gap-2">
				<div className="text-[11px] font-medium">{label}</div>
				<div className="text-[10px] text-muted-foreground">{entry.field.kind}</div>
			</div>
			<div className="flex gap-1">
				<Input
					type="number"
					step={isFloat ? 'any' : 1}
					className="h-7 font-mono text-xs flex-1"
					value={draft}
					placeholder={fold.kind === 'mixed' ? '(mixed)' : undefined}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
				/>
				<Button size="sm" className="h-7 px-2 text-[10px]" onClick={apply}>
					Apply
				</Button>
			</div>
			{entry.meta?.description && (
				<div className="text-[10px] text-muted-foreground">{entry.meta.description}</div>
			)}
		</div>
	);
}

function BoolRow({ entry, paths, data, onApply }: RowProps) {
	const fold = foldField<boolean>(data, paths, entry.key);
	const [draft, setDraft] = useState<'true' | 'false'>(fold.kind === 'all' && fold.value ? 'true' : 'false');
	React.useEffect(() => {
		if (fold.kind === 'all') setDraft(fold.value ? 'true' : 'false');
	}, [fold.kind, fold.kind === 'all' ? fold.value : null]);

	const label = entry.meta?.label ?? entry.key;
	return (
		<div className="space-y-1">
			<div className="text-[11px] font-medium">{label}</div>
			<div className="flex gap-1">
				<Select value={draft} onValueChange={(v) => setDraft(v as 'true' | 'false')}>
					<SelectTrigger className="h-7 font-mono text-xs flex-1">
						<SelectValue placeholder={fold.kind === 'mixed' ? '(mixed)' : undefined} />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="true">true</SelectItem>
						<SelectItem value="false">false</SelectItem>
					</SelectContent>
				</Select>
				<Button size="sm" className="h-7 px-2 text-[10px]" onClick={() => onApply(draft === 'true')}>
					Apply
				</Button>
			</div>
		</div>
	);
}

function EnumRow({ entry, paths, data, onApply }: RowProps) {
	const fold = foldField<number>(data, paths, entry.key);
	const enumField = entry.field as FieldSchema & { kind: 'enum'; values: { value: number; label: string }[] };
	const [draft, setDraft] = useState<string>(
		fold.kind === 'all' ? String(fold.value) : '',
	);
	React.useEffect(() => {
		if (fold.kind === 'all') setDraft(String(fold.value));
	}, [fold.kind, fold.kind === 'all' ? fold.value : null]);

	const label = entry.meta?.label ?? entry.key;
	return (
		<div className="space-y-1">
			<div className="text-[11px] font-medium">{label}</div>
			<div className="flex gap-1">
				<Select value={draft} onValueChange={setDraft}>
					<SelectTrigger className="h-7 font-mono text-xs flex-1">
						<SelectValue placeholder={fold.kind === 'mixed' ? '(mixed)' : undefined} />
					</SelectTrigger>
					<SelectContent>
						{enumField.values.map((v) => (
							<SelectItem key={v.value} value={String(v.value)}>
								{v.label} ({v.value})
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					size="sm"
					className="h-7 px-2 text-[10px]"
					disabled={draft === ''}
					onClick={() => onApply(parseInt(draft, 10))}
				>
					Apply
				</Button>
			</div>
		</div>
	);
}

function BulkFieldRow(props: RowProps) {
	switch (props.entry.field.kind) {
		case 'bool': return <BoolRow {...props} />;
		case 'enum': return <EnumRow {...props} />;
		default: return <NumericRow {...props} />;
	}
}

// ---------------------------------------------------------------------------
// Per-record-type section
// ---------------------------------------------------------------------------

type SectionProps = {
	recordSchema: RecordSchema;
	paths: NodePath[];
	data: unknown;
	onApply: (paths: NodePath[], fieldKey: string, value: unknown) => void;
};

function BulkRecordSection({ recordSchema, paths, data, onApply }: SectionProps) {
	const fields = useMemo(() => bulkEditableFields(recordSchema), [recordSchema]);
	if (fields.length === 0) {
		return (
			<div className="space-y-1">
				<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
					{recordSchema.name} · {paths.length}
				</div>
				<div className="text-[10px] text-muted-foreground">
					No bulk-editable primitive fields on {recordSchema.name}.
				</div>
			</div>
		);
	}
	return (
		<div className="space-y-3">
			<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
				{recordSchema.name} · {paths.length} item{paths.length === 1 ? '' : 's'}
			</div>
			{fields.map((entry) => (
				<BulkFieldRow
					key={entry.key}
					entry={entry}
					paths={paths}
					data={data}
					onApply={(value) => onApply(paths, entry.key, value)}
				/>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Top-level panel
// ---------------------------------------------------------------------------

export function GenericBulkEditPanel() {
	const { data, resource, setAtPath } = useSchemaEditor();
	const bulk = useSchemaBulkSelection();

	const groups = useMemo(() => {
		const m = new Map<string, { record: RecordSchema; paths: NodePath[] }>();
		if (!bulk) return m;
		for (const key of bulk.bulkPathKeys) {
			const path = parsePathKey(key);
			const loc = resolveSchemaAtPath(resource, path);
			if (!loc?.record) continue;
			const name = loc.record.name;
			let g = m.get(name);
			if (!g) { g = { record: loc.record, paths: [] }; m.set(name, g); }
			g.paths.push(path);
		}
		return m;
	}, [bulk, resource]);

	if (!bulk || bulk.suppressGenericInspectorPanel || groups.size === 0) {
		return null;
	}

	const totalItems = [...groups.values()].reduce((acc, g) => acc + g.paths.length, 0);

	const onApply = (paths: NodePath[], fieldKey: string, value: unknown) => {
		// Build the new root by chaining structurally-shared writes per
		// item, then a single setAtPath at root replaces it in one go.
		let next = data;
		for (const p of paths) {
			next = setAtPathWalk(next, [...p, fieldKey], value);
		}
		setAtPath([], next);
	};

	const onClear = () => {
		bulk.onBulkApplyPaths?.(
			[...groups.values()].flatMap((g) => g.paths),
			'remove',
		);
	};

	return (
		<div className="border-b border-amber-500/40 bg-amber-500/5 p-3 space-y-3">
			<div className="flex items-center justify-between gap-2">
				<div>
					<div className="text-sm font-medium text-amber-400">Bulk edit</div>
					<div className="text-[11px] text-muted-foreground">
						{totalItems} item{totalItems === 1 ? '' : 's'}
						{groups.size > 1 ? ` · ${groups.size} record types` : ''}
					</div>
				</div>
				{bulk.onBulkApplyPaths && (
					<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>
						Clear
					</Button>
				)}
			</div>
			<div className="space-y-4">
				{[...groups.entries()].map(([name, g]) => (
					<BulkRecordSection
						key={name}
						recordSchema={g.record}
						paths={g.paths}
						data={data}
						onApply={onApply}
					/>
				))}
			</div>
		</div>
	);
}

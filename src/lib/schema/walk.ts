// Path-based navigation over schema + data pairs.
//
// Paths are arrays of string / number segments, e.g. `["hulls", 3, "sectionFlows", 7]`.
// - String segments traverse record fields.
// - Number segments index into lists.
//
// Functions return either a value (for getAtPath) or a new root with the
// change applied immutably (for updateAtPath). The walker also resolves the
// schema alongside the data so field metadata is available at any depth.

import type {
	FieldSchema,
	ListFieldSchema,
	RecordFieldSchema,
	RecordSchema,
	ResourceSchema,
} from './types';

export type PathSegment = string | number;
export type NodePath = PathSegment[];

// ---------------------------------------------------------------------------
// Schema resolution
// ---------------------------------------------------------------------------

// Result of walking the schema to a path. When the path lands on a record,
// `record` is populated; when it lands on a field (primitive or otherwise),
// `field` is populated. `parent` describes the immediately enclosing record
// + field name, which is what the inspector needs to know ("which form am I
// editing, and which field is currently selected").
export type SchemaLocation = {
	record?: RecordSchema;        // set when path ends on a record instance
	field?: FieldSchema;           // set when path ends on a field (any kind)
	parentRecord?: RecordSchema;   // the enclosing record, if any
	parentFieldName?: string;      // the field name within parent
	// For list items, the list field itself and the index within the list.
	listField?: ListFieldSchema;
	listIndex?: number;
};

// Walk the schema starting from the resource root. Returns `null` if the
// path is invalid (refers to something that doesn't exist in the schema).
export function resolveSchemaAtPath(
	resource: ResourceSchema,
	path: NodePath,
): SchemaLocation | null {
	const rootRecord = resource.registry[resource.rootType];
	if (!rootRecord) return null;

	let currentRecord: RecordSchema | undefined = rootRecord;
	let currentField: FieldSchema | undefined;
	let parentRecord: RecordSchema | undefined;
	let parentFieldName: string | undefined;
	let listField: ListFieldSchema | undefined;
	let listIndex: number | undefined;

	for (let i = 0; i < path.length; i++) {
		const seg = path[i];

		if (typeof seg === 'string') {
			// Record-field traversal. Must have a current record.
			if (!currentRecord) return null;
			const field = currentRecord.fields[seg];
			if (!field) return null;

			parentRecord = currentRecord;
			parentFieldName = seg;
			currentField = field;

			// If the field is a record reference, descend into that record so
			// the NEXT segment (if any) resolves against it.
			if (field.kind === 'record') {
				currentRecord = resource.registry[(field as RecordFieldSchema).type];
				if (!currentRecord) return null;
			} else if (field.kind === 'list') {
				// The next segment should be numeric (list index). We leave
				// `currentRecord` unset — the next iteration handles it.
				listField = field;
				currentRecord = undefined;
			} else {
				// Primitive / structured leaf. Any further segments are invalid.
				currentRecord = undefined;
			}
		} else {
			// Numeric segment — must be indexing into a list.
			if (!listField) return null;
			listIndex = seg;
			const itemSchema = listField.item;

			// After indexing, the item's schema becomes the "current field"
			// for the NEXT iteration if it's a record.
			if (itemSchema.kind === 'record') {
				currentRecord = resource.registry[itemSchema.type];
				if (!currentRecord) return null;
				currentField = itemSchema;
				// parentRecord stays as the record that contained the list;
				// parentFieldName stays as the list field name.
				listField = undefined;
			} else {
				// Primitive list item — this is a leaf.
				currentField = itemSchema;
				currentRecord = undefined;
				listField = undefined;
			}
		}
	}

	return {
		record: currentRecord,
		field: currentField,
		parentRecord,
		parentFieldName,
		listField,
		listIndex,
	};
}

// ---------------------------------------------------------------------------
// Data get / update
// ---------------------------------------------------------------------------

// Walks the data object along the path, returning whatever is at that
// position. Returns `undefined` when the path doesn't exist in the data.
export function getAtPath(root: unknown, path: NodePath): unknown {
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

// Returns a new root with the value at `path` replaced by `updater(current)`.
// Structural sharing: unchanged branches are reused from the original root.
// Throws when the path doesn't resolve (callers should validate first).
export function updateAtPath<T>(
	root: T,
	path: NodePath,
	updater: (current: unknown) => unknown,
): T {
	if (path.length === 0) {
		return updater(root) as T;
	}

	const [head, ...rest] = path;

	if (typeof head === 'number') {
		if (!Array.isArray(root)) {
			throw new Error(`updateAtPath: expected array at path segment, got ${typeof root}`);
		}
		if (head < 0 || head >= root.length) {
			throw new Error(`updateAtPath: index ${head} out of bounds (length ${root.length})`);
		}
		const next = root.slice();
		next[head] = updateAtPath(next[head], rest, updater);
		return next as T;
	}

	if (root == null || typeof root !== 'object') {
		throw new Error(`updateAtPath: expected object at path segment "${head}", got ${root == null ? 'null' : typeof root}`);
	}
	const obj = root as Record<string, unknown>;
	if (!(head in obj)) {
		throw new Error(`updateAtPath: field "${head}" missing at path`);
	}
	return {
		...obj,
		[head]: updateAtPath(obj[head], rest, updater),
	} as T;
}

// Convenience: set a primitive value at path.
export function setAtPath<T>(root: T, path: NodePath, value: unknown): T {
	return updateAtPath(root, path, () => value);
}

// ---------------------------------------------------------------------------
// List helpers
// ---------------------------------------------------------------------------

// Insert an item into the list at `listPath` at `index` (or append if index
// is omitted / out of bounds). Returns a new root.
export function insertListItem<T>(
	root: T,
	listPath: NodePath,
	item: unknown,
	index?: number,
): T {
	return updateAtPath(root, listPath, (current) => {
		if (!Array.isArray(current)) {
			throw new Error(`insertListItem: not a list at path`);
		}
		const next = current.slice();
		const at = index == null || index < 0 || index > next.length ? next.length : index;
		next.splice(at, 0, item);
		return next;
	});
}

// Remove the item at `index` from the list at `listPath`. Returns a new root.
export function removeListItem<T>(
	root: T,
	listPath: NodePath,
	index: number,
): T {
	return updateAtPath(root, listPath, (current) => {
		if (!Array.isArray(current)) {
			throw new Error(`removeListItem: not a list at path`);
		}
		if (index < 0 || index >= current.length) {
			throw new Error(`removeListItem: index ${index} out of bounds (length ${current.length})`);
		}
		const next = current.slice();
		next.splice(index, 1);
		return next;
	});
}

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

// Split a path into (parent path, last segment). Useful for "the thing that
// contains this node".
export function parentPath(path: NodePath): { parent: NodePath; last: PathSegment } | null {
	if (path.length === 0) return null;
	return { parent: path.slice(0, -1), last: path[path.length - 1] };
}

// Human-readable path string, for debugging and error messages.
// `["hulls", 3, "sectionFlows", 7]` → `"hulls[3].sectionFlows[7]"`.
export function formatPath(path: NodePath): string {
	let out = '';
	for (let i = 0; i < path.length; i++) {
		const seg = path[i];
		if (typeof seg === 'number') {
			out += `[${seg}]`;
		} else {
			out += i === 0 ? seg : `.${seg}`;
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Tree walking — depth-first traversal of (path, value, schema) triples
// ---------------------------------------------------------------------------

// Visitor callback. Return `false` to stop descending into the current node
// (the traversal continues with siblings).
export type Visitor = (path: NodePath, value: unknown, field: FieldSchema | null, record: RecordSchema | null) => boolean | void;

// Walks the resource from the root, calling `visit` at every position.
// Used by tests to assert that the schema covers the entire data shape.
export function walkResource(
	resource: ResourceSchema,
	root: unknown,
	visit: Visitor,
): void {
	const rootRecord = resource.registry[resource.rootType];
	if (!rootRecord) {
		throw new Error(`walkResource: root type "${resource.rootType}" not in registry`);
	}

	const walkRecord = (path: NodePath, value: unknown, record: RecordSchema): void => {
		const cont = visit(path, value, null, record);
		if (cont === false) return;
		if (value == null || typeof value !== 'object') return;
		for (const [fieldName, fieldSchema] of Object.entries(record.fields)) {
			const childPath = [...path, fieldName];
			const childValue = (value as Record<string, unknown>)[fieldName];
			walkField(childPath, childValue, fieldSchema);
		}
	};

	const walkField = (path: NodePath, value: unknown, field: FieldSchema): void => {
		const cont = visit(path, value, field, null);
		if (cont === false) return;
		if (field.kind === 'record') {
			const record = resource.registry[field.type];
			if (!record) {
				throw new Error(`walkResource: unknown record type "${field.type}" at ${formatPath(path)}`);
			}
			walkRecord(path, value, record);
			return;
		}
		if (field.kind === 'list') {
			if (!Array.isArray(value)) return;
			for (let i = 0; i < value.length; i++) {
				const childPath = [...path, i];
				walkField(childPath, value[i], field.item);
			}
			return;
		}
		// Primitive / structured / leaf — no further descent.
	};

	walkRecord([], root, rootRecord);
}

// ---------------------------------------------------------------------------
// Derived-field reconciliation
// ---------------------------------------------------------------------------

// Walks the ancestors of a mutated path in BOTH the previous and next root
// and, for each enclosing record that has a `derive` callback declared on
// its schema, calls derive(prev, next) and merges the returned patch into
// the record at that path in the next root.
//
// Example: editing `hulls[3].sectionSpans[7].muMaxVehicles` from 10 to 20
// calls `TrafficSectionSpan.derive` with the span's previous and next
// values, which returns `{ mfMaxVehicleRecip: 1/20 }`. The helper then
// updates the span at that path in the next root.
//
// Only enclosing RECORDS are considered — not lists. The walker starts from
// the deepest record containing the mutation and walks OUTWARD, so cascading
// derives (e.g., a hull record derives summary counts from a span edit)
// would be possible. For TrafficData specifically only the SectionSpan case
// uses this today.
export function applyDerives<T>(
	prev: T,
	next: T,
	path: NodePath,
	resource: ResourceSchema,
): T {
	if (prev === next) return next;
	let result = next;

	// Walk the path from the deepest record up to the root, collecting each
	// record's path + schema. A record is any path that resolves to a record
	// schema (the synthetic root is one such). For each, call derive() with
	// the values at that path in prev vs result.
	const rootRecord = resource.registry[resource.rootType];
	if (!rootRecord) return result;

	// Collect ancestor records deepest-first.
	const ancestors: { path: NodePath; record: RecordSchema }[] = [];
	// Always include the root record itself.
	ancestors.unshift({ path: [], record: rootRecord });

	let currentRecord: RecordSchema = rootRecord;
	let currentRecordPath: NodePath = [];
	for (let i = 0; i < path.length; i++) {
		const seg = path[i];
		if (typeof seg === 'string') {
			const field = currentRecord.fields[seg];
			if (!field) break;
			if (field.kind === 'record') {
				const nested = resource.registry[field.type];
				if (!nested) break;
				currentRecord = nested;
				currentRecordPath = path.slice(0, i + 1);
				ancestors.unshift({ path: currentRecordPath, record: currentRecord });
			} else if (field.kind === 'list' && field.item.kind === 'record') {
				// The next segment is numeric; consume it.
				if (i + 1 < path.length && typeof path[i + 1] === 'number') {
					const itemType = field.item.type;
					const nested = resource.registry[itemType];
					if (!nested) break;
					currentRecord = nested;
					currentRecordPath = path.slice(0, i + 2);
					ancestors.unshift({ path: currentRecordPath, record: currentRecord });
					i++;
				} else {
					break;
				}
			} else {
				break;
			}
		}
	}

	// Apply derives deepest-first. Each derive sees the previous and next
	// values at its own record path; the patch is merged into result at
	// that path. Cascading through ancestors is intentional — a parent
	// record's derive can react to a nested mutation.
	for (const { path: recordPath, record } of ancestors) {
		if (!record.derive) continue;
		const prevValue = getAtPath(prev, recordPath) as Record<string, unknown> | undefined;
		const nextValue = getAtPath(result, recordPath) as Record<string, unknown> | undefined;
		if (!prevValue || !nextValue || typeof prevValue !== 'object' || typeof nextValue !== 'object') {
			continue;
		}
		const patch = record.derive(prevValue, nextValue);
		if (patch && Object.keys(patch).length > 0) {
			result = updateAtPath(result, recordPath, (cur) => ({
				...(cur as Record<string, unknown>),
				...patch,
			}));
		}
	}

	return result;
}

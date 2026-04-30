// Pure flat-list builder for WorkspaceHierarchy (issue #24, ADR-0007).
//
// Lives in `.ts` (no React) so the unit tests can exercise the unified-tree
// row enumeration without dragging in the React + Vite plugin graph the
// component itself imports.
//
// Row kinds in the flat list:
//
//   - `bundle`        — depth 0; one per loaded EditableBundle
//   - `resourceType`  — depth 1; one per resource type within an expanded
//                       Bundle. Multi-instance ResourceType rows can be
//                       expanded to show their Instance children. Single-
//                       instance types collapse the level into the
//                       ResourceType row (clicking it selects the only
//                       instance directly).
//   - `instance`      — depth 2; only multi-instance types emit these.
//   - `schema`        — depth ≥2; rendered ONLY under the currently-selected
//                       Resource (single-instance) or Instance (multi-
//                       instance), to keep the virtualised list compact.
//
// Selection levels (see WorkspaceContext.types `WorkspaceSelection`):
//
//   - Bundle:        `{ bundleId, path: [] }`
//   - Resource type: `{ bundleId, resourceKey, path: [] }` (multi-only)
//   - Instance:      `{ bundleId, resourceKey, index, path: [] }`
//   - Schema:        `{ bundleId, resourceKey, index, path: [...non-empty] }`

import type {
	EditableBundle,
	WorkspaceSelection,
} from '@/context/WorkspaceContext.types';
import { selectionLevel } from '@/context/WorkspaceContext.types';
import { getHandlerByKey } from '@/lib/core/registry';
import { getSchemaByKey } from '@/lib/schema/resources';
import type {
	FieldSchema,
	ListFieldSchema,
	RecordFieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaContext,
} from '@/lib/schema/types';
import type { NodePath } from '@/lib/schema/walk';
import { isWorldViewportFamilyKey } from './WorldViewportComposition.helpers';

// ---------------------------------------------------------------------------
// Visibility predicates
// ---------------------------------------------------------------------------

// A Visibility toggle is meaningful only for resources that contribute to the
// WorldViewport scene (CONTEXT.md / "Visibility"). Standard-viewport-family
// resources skip the eye icon — toggling them would be a no-op.
export function isVisibilityRelevantKey(key: string): boolean {
	return isWorldViewportFamilyKey(key);
}

export function bundleHasVisibilityRelevantResource(
	bundle: EditableBundle,
): boolean {
	for (const [key, list] of bundle.parsedResourcesAll) {
		if (!isVisibilityRelevantKey(key)) continue;
		if (list.some((m) => m != null)) return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Flat-list types
// ---------------------------------------------------------------------------

export type BundleFlatNode = {
	kind: 'bundle';
	pathKey: string;
	depth: 0;
	bundle: EditableBundle;
	expanded: boolean;
	isSelected: boolean;
	showVisibility: boolean;
};

export type ResourceTypeFlatNode = {
	kind: 'resourceType';
	pathKey: string;
	depth: 1;
	bundleId: string;
	resourceKey: string;
	label: string;
	count: number;
	isMultiInstance: boolean;
	expanded: boolean;
	isSelected: boolean;
	showVisibility: boolean;
};

export type InstanceFlatNode = {
	kind: 'instance';
	pathKey: string;
	depth: 2;
	bundleId: string;
	resourceKey: string;
	index: number;
	label: string;
	expanded: boolean;
	isSelected: boolean;
	showVisibility: boolean;
};

export type SchemaFlatNode = {
	kind: 'schema';
	pathKey: string;
	depth: number;
	bundleId: string;
	resourceKey: string;
	index: number;
	schemaPath: NodePath;
	label: string;
	isExpandable: boolean;
	isExpanded: boolean;
	isSelected: boolean;
	isOnPath: boolean;
	childCount?: number;
};

export type FlatNode =
	| BundleFlatNode
	| ResourceTypeFlatNode
	| InstanceFlatNode
	| SchemaFlatNode;

// ---------------------------------------------------------------------------
// Path / expansion key helpers
// ---------------------------------------------------------------------------

export function pathKey(path: NodePath): string {
	return path.join('/') || '__root__';
}

export function bundleKey(bundleId: string): string {
	return `bundle:${bundleId}`;
}
export function resourceTypeKey(bundleId: string, resourceKey: string): string {
	return `rt:${bundleId}::${resourceKey}`;
}
export function instanceKey(
	bundleId: string,
	resourceKey: string,
	index: number,
): string {
	return `inst:${bundleId}::${resourceKey}::${index}`;
}
export function schemaKey(
	bundleId: string,
	resourceKey: string,
	index: number,
	path: NodePath,
): string {
	return `sch:${bundleId}::${resourceKey}::${index}::${pathKey(path)}`;
}

function isPathAncestor(ancestor: NodePath, descendant: NodePath): boolean {
	if (ancestor.length > descendant.length) return false;
	for (let i = 0; i < ancestor.length; i++) {
		if (ancestor[i] !== descendant[i]) return false;
	}
	return true;
}

function isExpandableField(field: FieldSchema): boolean {
	if (field.kind === 'record') return true;
	if (field.kind === 'list' && field.item.kind === 'record') return true;
	return false;
}

// ---------------------------------------------------------------------------
// Schema flat-list builder
// ---------------------------------------------------------------------------

type SchemaBuildAddr = {
	bundleId: string;
	resourceKey: string;
	index: number;
	baseDepth: number;
};

function buildSchemaFlat(
	resource: ResourceSchema,
	data: unknown,
	expanded: Set<string>,
	addr: SchemaBuildAddr,
	selection: WorkspaceSelection,
): SchemaFlatNode[] {
	const rootRecord = resource.registry[resource.rootType];
	if (!rootRecord) return [];

	const out: SchemaFlatNode[] = [];
	const ctx: SchemaContext = { root: data, resource };
	const matchesSelection =
		selection != null &&
		selection.bundleId === addr.bundleId &&
		selection.resourceKey === addr.resourceKey &&
		selection.index === addr.index;
	const selectionPath = matchesSelection ? selection!.path : null;

	visitRecord(
		[],
		rootRecord,
		data,
		addr.baseDepth,
		resource.name,
		out,
		ctx,
		expanded,
		addr,
		selectionPath,
	);
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
	addr: SchemaBuildAddr,
	selectionPath: NodePath | null,
): void {
	const sKey = schemaKey(addr.bundleId, addr.resourceKey, addr.index, path);
	const isExpanded = expanded.has(sKey);
	const isSelected =
		selectionPath != null &&
		path.length === selectionPath.length &&
		path.every((seg, i) => seg === selectionPath[i]);
	const isOnPath =
		!isSelected &&
		selectionPath != null &&
		isPathAncestor(path, selectionPath) &&
		path.length < selectionPath.length;

	out.push({
		kind: 'schema',
		pathKey: sKey,
		depth,
		bundleId: addr.bundleId,
		resourceKey: addr.resourceKey,
		index: addr.index,
		schemaPath: path,
		label,
		isExpandable: true,
		isExpanded,
		isSelected,
		isOnPath,
	});
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
				visitRecord(
					childPath,
					childRecord,
					childValue,
					depth + 1,
					childLabel,
					out,
					ctx,
					expanded,
					addr,
					selectionPath,
				);
			}
		} else if (fieldSchema.kind === 'list') {
			visitList(
				childPath,
				fieldSchema,
				childValue,
				depth + 1,
				childLabel,
				out,
				ctx,
				expanded,
				addr,
				selectionPath,
			);
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
	addr: SchemaBuildAddr,
	selectionPath: NodePath | null,
): void {
	const sKey = schemaKey(addr.bundleId, addr.resourceKey, addr.index, path);
	const listValue = Array.isArray(value) ? value : [];
	const itemIsRecord = listField.item.kind === 'record';
	const isExpanded = expanded.has(sKey);
	const isSelected =
		selectionPath != null &&
		path.length === selectionPath.length &&
		path.every((seg, i) => seg === selectionPath[i]);
	const isOnPath =
		!isSelected &&
		selectionPath != null &&
		isPathAncestor(path, selectionPath) &&
		path.length < selectionPath.length;

	out.push({
		kind: 'schema',
		pathKey: sKey,
		depth,
		bundleId: addr.bundleId,
		resourceKey: addr.resourceKey,
		index: addr.index,
		schemaPath: path,
		label,
		isExpandable: itemIsRecord,
		isExpanded,
		isSelected,
		isOnPath,
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
		visitRecord(
			itemPath,
			itemRecord,
			item,
			depth + 1,
			itemLabel,
			out,
			ctx,
			expanded,
			addr,
			selectionPath,
		);
	}
}

// ---------------------------------------------------------------------------
// Top-level flat-list builder
// ---------------------------------------------------------------------------

export type WorkspaceFlatBuildArgs = {
	bundles: readonly EditableBundle[];
	expanded: Set<string>;
	selection: WorkspaceSelection;
};

export function buildWorkspaceFlat({
	bundles,
	expanded,
	selection,
}: WorkspaceFlatBuildArgs): FlatNode[] {
	// Auto-expand the ancestors of the current selection so the selected row
	// is always reachable in the flat list. We union persisted expansion with
	// the selection's bundle / resource-type / schema-path keys here, instead
	// of asking every caller to remember to do it.
	const effective = new Set(expanded);
	if (selection) {
		effective.add(bundleKey(selection.bundleId));
		if (selection.resourceKey !== undefined) {
			effective.add(resourceTypeKey(selection.bundleId, selection.resourceKey));
			if (selection.index !== undefined) {
				effective.add(
					schemaKey(selection.bundleId, selection.resourceKey, selection.index, []),
				);
				for (let i = 0; i <= selection.path.length; i++) {
					effective.add(
						schemaKey(
							selection.bundleId,
							selection.resourceKey,
							selection.index,
							selection.path.slice(0, i),
						),
					);
				}
			}
		}
	}

	const out: FlatNode[] = [];
	const level = selectionLevel(selection);

	for (const bundle of bundles) {
		const bKey = bundleKey(bundle.id);
		const bundleExpanded = effective.has(bKey);
		const bundleSelected =
			level === 'bundle' && selection!.bundleId === bundle.id;

		out.push({
			kind: 'bundle',
			pathKey: bKey,
			depth: 0,
			bundle,
			expanded: bundleExpanded,
			isSelected: bundleSelected,
			showVisibility: bundleHasVisibilityRelevantResource(bundle),
		});

		if (!bundleExpanded) continue;

		const entries: { key: string; count: number; instances: (unknown | null)[] }[] = [];
		for (const [key, list] of bundle.parsedResourcesAll) {
			if (list.length > 0) entries.push({ key, count: list.length, instances: list });
		}
		entries.sort((a, b) => a.key.localeCompare(b.key));

		for (const entry of entries) {
			const handler = getHandlerByKey(entry.key);
			const label = handler?.name ?? entry.key;
			const isMulti = entry.count > 1;
			const rtKey = resourceTypeKey(bundle.id, entry.key);
			const visibilityRelevant = isVisibilityRelevantKey(entry.key);

			// Single-instance: clicking the row gives Instance-level selection
			// (index: 0); the row is "selected" when the user is at instance
			// or schema level on this resource.
			// Multi-instance: this row gives Resource-type-level selection;
			// it's "selected" only at that level.
			const isSelected = isMulti
				? level === 'resourceType' &&
					selection!.bundleId === bundle.id &&
					selection!.resourceKey === entry.key
				: (level === 'instance' || level === 'schema') &&
					selection!.bundleId === bundle.id &&
					selection!.resourceKey === entry.key &&
					selection!.index === 0;

			const autoExpandForSelection =
				selection != null &&
				selection.bundleId === bundle.id &&
				selection.resourceKey === entry.key &&
				selection.index !== undefined;
			const userExpanded = effective.has(rtKey);
			const expandedRow = userExpanded || autoExpandForSelection;

			out.push({
				kind: 'resourceType',
				pathKey: rtKey,
				depth: 1,
				bundleId: bundle.id,
				resourceKey: entry.key,
				label,
				count: entry.count,
				isMultiInstance: isMulti,
				expanded: expandedRow,
				isSelected,
				showVisibility: visibilityRelevant,
			});

			if (!expandedRow) continue;

			if (isMulti) {
				for (let i = 0; i < entry.count; i++) {
					const iKey = instanceKey(bundle.id, entry.key, i);
					const instanceSelected =
						(level === 'instance' || level === 'schema') &&
						selection!.bundleId === bundle.id &&
						selection!.resourceKey === entry.key &&
						selection!.index === i;
					const schema = getSchemaByKey(entry.key);
					const data = entry.instances[i];
					const expandThisInstance = instanceSelected;
					out.push({
						kind: 'instance',
						pathKey: iKey,
						depth: 2,
						bundleId: bundle.id,
						resourceKey: entry.key,
						index: i,
						label: `${label} #${i}`,
						expanded: expandThisInstance,
						isSelected: instanceSelected,
						showVisibility: visibilityRelevant,
					});
					if (expandThisInstance && schema && data != null) {
						out.push(
							...buildSchemaFlat(
								schema,
								data,
								effective,
								{
									bundleId: bundle.id,
									resourceKey: entry.key,
									index: i,
									baseDepth: 3,
								},
								selection,
							),
						);
					}
				}
			} else {
				// Single-instance: schema subtree hangs directly under the row.
				const instanceSelected = isSelected;
				const schema = getSchemaByKey(entry.key);
				const data = entry.instances[0];
				if (instanceSelected && schema && data != null) {
					out.push(
						...buildSchemaFlat(
							schema,
							data,
							effective,
							{
								bundleId: bundle.id,
								resourceKey: entry.key,
								index: 0,
								baseDepth: 2,
							},
							selection,
						),
					);
				}
			}
		}
	}

	return out;
}

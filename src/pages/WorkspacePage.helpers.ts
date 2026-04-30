// Pure helpers backing the WorkspacePage's selected-resource schema subtree
// (issue #21).
//
// Lives in a `.ts` (not `.tsx`) so the unit tests can exercise it without
// dragging in React + the Vite-only `@vitejs/plugin-react-swc` graph that
// the page itself imports. Keep this file React-free.

import type { ResourceSchema } from '@/lib/schema/types';
import type { NodePath } from '@/lib/schema/walk';
import type { WorkspaceSelection } from '@/context/WorkspaceContext.types';

// ---------------------------------------------------------------------------
// HierarchyTree gating
// ---------------------------------------------------------------------------

// Render the schema tree under a selected resource only when there's at least
// one expandable (record or list-of-record) field below the root. Schemas
// whose root contains only primitives or hidden fields would show a single
// dead row, so we skip the tree entirely and let the inspector form do the
// work alone — matches the "schema tree appears only where the schema has
// navigable depth" acceptance criterion (issue #21).
export function hasNavigableSchemaDepth(schema: ResourceSchema | undefined): boolean {
	if (!schema) return false;
	const root = schema.registry[schema.rootType];
	if (!root) return false;
	for (const [name, field] of Object.entries(root.fields)) {
		const meta = root.fieldMetadata?.[name];
		if (meta?.hidden) continue;
		if (field.kind === 'record') return true;
		if (field.kind === 'list' && field.item.kind === 'record') return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Selection-path bridging
// ---------------------------------------------------------------------------

// Builds the `onSelectedPathChange` callback that the SelectedSchemaSubtree's
// SchemaEditorProvider uses in controlled mode. When the user clicks a
// sub-path inside the schema tree, HierarchyTree calls `selectPath(next)` →
// the provider invokes this callback → we forward to WorkspaceContext's
// `select` with the same (bundleId, resourceKey, index), only swapping in
// the new sub-path.
//
// Exposed as a pure function so the issue #21 acceptance test can verify the
// "click a sub-path → `selection.path` updates" wiring without rendering
// HierarchyTree.
export function makeSchemaSelectionPathHandler(
	selection: WorkspaceSelection,
	select: (next: WorkspaceSelection) => void,
): (next: NodePath) => void {
	return (next) => {
		if (!selection) return;
		select({
			bundleId: selection.bundleId,
			resourceKey: selection.resourceKey,
			index: selection.index,
			path: next,
		});
	};
}

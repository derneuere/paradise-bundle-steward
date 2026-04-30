// Tests for WorkspacePage's selected-resource schema subtree wiring (issue #21).
//
// The vitest env is `node`, so we don't render <HierarchyTree /> directly —
// the acceptance flow ("select a resource → schema tree renders → click a
// sub-path → `selection.path` updates") is covered by exercising the two
// pure helpers it composes:
//
//   1. `hasNavigableSchemaDepth` decides whether the subtree mounts at all.
//   2. `makeSchemaSelectionPathHandler` is the controlled-mode bridge from
//      HierarchyTree's `selectPath(next)` back into WorkspaceContext.
//
// HierarchyTree's contract (selectPath → SchemaEditorProvider.onSelectedPathChange
// → makeSchemaSelectionPathHandler → WorkspaceContext.select) is the same
// path SelectedResourceShell already uses for the right-side panes; the
// helper test below proves the new tree pane wires up identically.

import { describe, expect, it, vi } from 'vitest';

import {
	hasNavigableSchemaDepth,
	makeSchemaSelectionPathHandler,
} from './WorkspacePage.helpers';
import { aiSectionsResourceSchema } from '@/lib/schema/resources/aiSections';
import { trafficDataResourceSchema } from '@/lib/schema/resources/trafficData';
import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
} from '@/lib/schema/types';
import type { WorkspaceSelection } from '@/context/WorkspaceContext.types';

// ---------------------------------------------------------------------------
// Schema fixtures — minimal hand-rolled schemas to exercise the gate without
// dragging in the full hand-written resource modules.
// ---------------------------------------------------------------------------

function makeSchema(
	rootType: string,
	rootFields: Record<string, FieldSchema>,
	registryExtra: Record<string, RecordSchema> = {},
): ResourceSchema {
	const root: RecordSchema = { name: rootType, fields: rootFields };
	return {
		key: 'test',
		name: 'Test Schema',
		rootType,
		registry: { [rootType]: root, ...registryExtra },
	};
}

// ---------------------------------------------------------------------------
// hasNavigableSchemaDepth
// ---------------------------------------------------------------------------

describe('hasNavigableSchemaDepth', () => {
	it('returns false for an undefined schema', () => {
		expect(hasNavigableSchemaDepth(undefined)).toBe(false);
	});

	it('returns false when the root type is missing from the registry', () => {
		// rootType references a record that the registry never declared. The
		// helper must guard so the page renders nothing instead of crashing.
		const orphan: ResourceSchema = {
			key: 'orphan',
			name: 'Orphan',
			rootType: 'Missing',
			registry: {},
		};
		expect(hasNavigableSchemaDepth(orphan)).toBe(false);
	});

	it('returns false for a record whose fields are all primitives', () => {
		const schema = makeSchema('Root', {
			name: { kind: 'string' },
			version: { kind: 'u32' },
			ratio: { kind: 'f32' },
		});
		expect(hasNavigableSchemaDepth(schema)).toBe(false);
	});

	it('returns false for a list-of-primitive (no nested records to drill into)', () => {
		const schema = makeSchema('Root', {
			ids: { kind: 'list', item: { kind: 'u32' } },
		});
		expect(hasNavigableSchemaDepth(schema)).toBe(false);
	});

	it('returns true when the root has a nested record field', () => {
		const schema = makeSchema(
			'Root',
			{ header: { kind: 'record', type: 'Header' } },
			{ Header: { name: 'Header', fields: { magic: { kind: 'u32' } } } },
		);
		expect(hasNavigableSchemaDepth(schema)).toBe(true);
	});

	it('returns true when the root has a list-of-record field', () => {
		const schema = makeSchema(
			'Root',
			{
				items: { kind: 'list', item: { kind: 'record', type: 'Item' } },
			},
			{ Item: { name: 'Item', fields: { id: { kind: 'u32' } } } },
		);
		expect(hasNavigableSchemaDepth(schema)).toBe(true);
	});

	it('skips fields flagged as hidden — a hidden record alone does not count', () => {
		// Padding records are walked for round-trip but `hidden:true` keeps
		// them out of the inspector. The schema tree must mirror that — a root
		// whose only "expandable" field is hidden should NOT render a tree.
		const schema = {
			...makeSchema(
				'Root',
				{
					padding: { kind: 'record', type: 'Padding' },
					name: { kind: 'string' },
				},
				{ Padding: { name: 'Padding', fields: { _: { kind: 'u8' } } } },
			),
		};
		schema.registry.Root = {
			...schema.registry.Root,
			fieldMetadata: { padding: { hidden: true } },
		};
		expect(hasNavigableSchemaDepth(schema)).toBe(false);
	});

	it('returns true for real shipping schemas with navigable depth', () => {
		// Smoke-test against two real schemas — both have list-of-record
		// fields at the root (sections, flowTypes), so the page should mount
		// the schema tree when either resource is selected.
		expect(hasNavigableSchemaDepth(aiSectionsResourceSchema)).toBe(true);
		expect(hasNavigableSchemaDepth(trafficDataResourceSchema)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// makeSchemaSelectionPathHandler — sub-path → WorkspaceContext.select
// ---------------------------------------------------------------------------

describe('makeSchemaSelectionPathHandler', () => {
	it('forwards the new path to select() while keeping bundle/key/index intact', () => {
		// Mirrors the issue #21 acceptance flow: with a resource selected,
		// HierarchyTree calls selectPath(['sections', 3, 'portals', 1]) → this
		// handler forwards the same (bundleId, resourceKey, index) plus the
		// new sub-path to WorkspaceContext.select.
		const selection: WorkspaceSelection = {
			bundleId: 'TRK_UNIT_07.BUN',
			resourceKey: 'aiSections',
			index: 0,
			path: [],
		};
		const select = vi.fn<(next: WorkspaceSelection) => void>();
		const handler = makeSchemaSelectionPathHandler(selection, select);

		handler(['sections', 3, 'portals', 1]);

		expect(select).toHaveBeenCalledTimes(1);
		expect(select).toHaveBeenCalledWith({
			bundleId: 'TRK_UNIT_07.BUN',
			resourceKey: 'aiSections',
			index: 0,
			path: ['sections', 3, 'portals', 1],
		});
	});

	it('preserves the multi-instance index when drilling into PolygonSoupList #5', () => {
		// Acceptance criterion: "Multi-instance resources (PolygonSoupList):
		// selecting a specific instance row shows that instance's
		// HierarchyTree." Sub-path clicks must keep targeting that instance.
		const selection: WorkspaceSelection = {
			bundleId: 'WORLDCOL.BIN',
			resourceKey: 'polygonSoupList',
			index: 5,
			path: [],
		};
		const select = vi.fn<(next: WorkspaceSelection) => void>();
		const handler = makeSchemaSelectionPathHandler(selection, select);

		handler(['soups', 0, 'polygons', 12]);

		expect(select).toHaveBeenCalledWith({
			bundleId: 'WORLDCOL.BIN',
			resourceKey: 'polygonSoupList',
			index: 5,
			path: ['soups', 0, 'polygons', 12],
		});
	});

	it('is a no-op when no resource is selected', () => {
		// SelectedSchemaSubtree returns null before ever building the handler
		// when selection is null, but the helper still has to guard — calling
		// select(null) with an empty path would clobber the workspace's
		// "nothing selected" state into a half-formed selection.
		const select = vi.fn<(next: WorkspaceSelection) => void>();
		const handler = makeSchemaSelectionPathHandler(null, select);

		handler(['anything']);

		expect(select).not.toHaveBeenCalled();
	});

	it('round-trips through WorkspaceContext-shaped state to update selection.path', () => {
		// Mini end-to-end: simulate the React provider's `select` setter and
		// confirm the handler updates exactly the path field, leaving every
		// other Workspace state field untouched.
		type WorkspaceState = { selection: WorkspaceSelection; bundles: string[] };
		const state: WorkspaceState = {
			bundles: ['A.BNDL', 'B.BNDL'],
			selection: {
				bundleId: 'A.BNDL',
				resourceKey: 'streetData',
				index: 0,
				path: [],
			},
		};
		const select = (next: WorkspaceSelection) => {
			state.selection = next;
		};
		const handler = makeSchemaSelectionPathHandler(state.selection, select);

		handler(['streets', 7, 'spans', 0]);

		expect(state.selection?.path).toEqual(['streets', 7, 'spans', 0]);
		expect(state.selection?.bundleId).toBe('A.BNDL');
		expect(state.selection?.resourceKey).toBe('streetData');
		expect(state.bundles).toEqual(['A.BNDL', 'B.BNDL']);
	});
});

// Tests for WorkspaceHierarchy's pure flat-list builder (issue #24, ADR-0007).
//
// The vitest env is `node`, so we don't render the React component directly.
// The interesting behaviour — "every Bundle emits a row," "Resource type
// rows reflect single- vs multi-instance," "Instance rows only emit for
// multi-instance," "schema subtree only attaches under the selected
// Resource/Instance" — lives in the pure builder, so we exercise that.

import { describe, expect, it } from 'vitest';

import {
	bundleKey,
	buildWorkspaceFlat,
	resourceTypeKey,
	type BundleFlatNode,
	type FlatNode,
	type InstanceFlatNode,
	type ResourceTypeFlatNode,
	type SchemaFlatNode,
} from './WorkspaceHierarchy.helpers';
import { selectionLevel } from '@/context/WorkspaceContext.types';
import type {
	EditableBundle,
	WorkspaceSelection,
} from '@/context/WorkspaceContext.types';
import type { ParsedBundle } from '@/lib/core/types';

// ---------------------------------------------------------------------------
// Fixture helpers — minimal EditableBundles wrapping plain parsed-resource
// maps so we can drive the builder without parsing real bundle files.
// ---------------------------------------------------------------------------

const EMPTY_PARSED: ParsedBundle = {
	header: {} as ParsedBundle['header'],
	resources: [],
	imports: [],
};

function makeBundle(
	id: string,
	resources: Record<string, (unknown | null)[]>,
	opts: { isModified?: boolean } = {},
): EditableBundle {
	const parsedResourcesAll = new Map<string, (unknown | null)[]>();
	const parsedResources = new Map<string, unknown>();
	for (const [k, list] of Object.entries(resources)) {
		parsedResourcesAll.set(k, list);
		const first = list[0];
		if (first != null) parsedResources.set(k, first);
	}
	return {
		id,
		originalArrayBuffer: new ArrayBuffer(0),
		parsed: EMPTY_PARSED,
		resources: [],
		debugResources: [],
		parsedResources,
		parsedResourcesAll,
		dirtyMulti: new Set(),
		isModified: opts.isModified ?? false,
	};
}

function rowKinds(flat: FlatNode[]): string[] {
	return flat.map((n) => `${n.kind}:${n.pathKey}`);
}

function findBundle(flat: FlatNode[], id: string): BundleFlatNode | undefined {
	return flat.find(
		(n): n is BundleFlatNode => n.kind === 'bundle' && n.bundle.id === id,
	);
}
function findResourceType(
	flat: FlatNode[],
	bundleId: string,
	resourceKey: string,
): ResourceTypeFlatNode | undefined {
	return flat.find(
		(n): n is ResourceTypeFlatNode =>
			n.kind === 'resourceType' &&
			n.bundleId === bundleId &&
			n.resourceKey === resourceKey,
	);
}
function findInstance(
	flat: FlatNode[],
	bundleId: string,
	resourceKey: string,
	index: number,
): InstanceFlatNode | undefined {
	return flat.find(
		(n): n is InstanceFlatNode =>
			n.kind === 'instance' &&
			n.bundleId === bundleId &&
			n.resourceKey === resourceKey &&
			n.index === index,
	);
}

// ---------------------------------------------------------------------------
// selectionLevel discriminator
// ---------------------------------------------------------------------------

describe('selectionLevel', () => {
	it('returns null for an empty selection', () => {
		expect(selectionLevel(null)).toBeNull();
	});

	it('reads "bundle" when only bundleId is set', () => {
		expect(selectionLevel({ bundleId: 'A.BUN', path: [] })).toBe('bundle');
	});

	it('reads "resourceType" when resourceKey is set but index is undefined', () => {
		expect(
			selectionLevel({ bundleId: 'A.BUN', resourceKey: 'aiSections', path: [] }),
		).toBe('resourceType');
	});

	it('reads "instance" when index is set with empty path', () => {
		expect(
			selectionLevel({
				bundleId: 'A.BUN',
				resourceKey: 'aiSections',
				index: 0,
				path: [],
			}),
		).toBe('instance');
	});

	it('reads "schema" when path is non-empty', () => {
		expect(
			selectionLevel({
				bundleId: 'A.BUN',
				resourceKey: 'aiSections',
				index: 0,
				path: ['sections', 3],
			}),
		).toBe('schema');
	});
});

// ---------------------------------------------------------------------------
// Bundle-row enumeration
// ---------------------------------------------------------------------------

describe('buildWorkspaceFlat — Bundle rows', () => {
	it('emits one Bundle row per loaded EditableBundle, even when collapsed', () => {
		const bundles = [
			makeBundle('A.BUN', { aiSections: [{}] }),
			makeBundle('B.BUN', { polygonSoupList: [{}, {}] }),
		];
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set(),
			selection: null,
		});
		// All collapsed → only Bundle rows.
		expect(flat).toHaveLength(2);
		expect(flat[0].kind).toBe('bundle');
		expect(flat[1].kind).toBe('bundle');
		expect((flat[0] as BundleFlatNode).bundle.id).toBe('A.BUN');
		expect((flat[1] as BundleFlatNode).bundle.id).toBe('B.BUN');
	});

	it('expanded Bundle row includes its Resource type rows underneath', () => {
		const bundles = [makeBundle('A.BUN', { aiSections: [{}], streetData: [{}] })];
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([bundleKey('A.BUN')]),
			selection: null,
		});
		// 1 Bundle + 2 ResourceType (sorted alphabetically).
		expect(rowKinds(flat)).toEqual([
			`bundle:bundle:A.BUN`,
			`resourceType:rt:A.BUN::aiSections`,
			`resourceType:rt:A.BUN::streetData`,
		]);
	});

	it('Bundle row is selected when selection is at Bundle level', () => {
		const bundles = [makeBundle('A.BUN', { aiSections: [{}] })];
		const selection: WorkspaceSelection = { bundleId: 'A.BUN', path: [] };
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set(),
			selection,
		});
		const row = findBundle(flat, 'A.BUN');
		expect(row?.isSelected).toBe(true);
	});

	it('Bundle row is NOT selected when selection is on a child resource', () => {
		const bundles = [makeBundle('A.BUN', { aiSections: [{}] })];
		const selection: WorkspaceSelection = {
			bundleId: 'A.BUN',
			resourceKey: 'aiSections',
			index: 0,
			path: [],
		};
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set(),
			selection,
		});
		const row = findBundle(flat, 'A.BUN');
		expect(row?.isSelected).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Resource-type rows
// ---------------------------------------------------------------------------

describe('buildWorkspaceFlat — Resource type rows', () => {
	it('marks single-instance resources as not multi-instance', () => {
		const bundles = [makeBundle('A.BUN', { aiSections: [{}] })];
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([bundleKey('A.BUN')]),
			selection: null,
		});
		const row = findResourceType(flat, 'A.BUN', 'aiSections');
		expect(row?.isMultiInstance).toBe(false);
		expect(row?.count).toBe(1);
	});

	it('marks multi-instance resources with count > 1 as multi-instance', () => {
		const bundles = [makeBundle('A.BUN', { polygonSoupList: [{}, {}, {}] })];
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([bundleKey('A.BUN')]),
			selection: null,
		});
		const row = findResourceType(flat, 'A.BUN', 'polygonSoupList');
		expect(row?.isMultiInstance).toBe(true);
		expect(row?.count).toBe(3);
	});

	it('Resource-type row is selected at Resource-type level (multi-instance only)', () => {
		const bundles = [makeBundle('A.BUN', { polygonSoupList: [{}, {}] })];
		const selection: WorkspaceSelection = {
			bundleId: 'A.BUN',
			resourceKey: 'polygonSoupList',
			path: [],
		};
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([bundleKey('A.BUN')]),
			selection,
		});
		const row = findResourceType(flat, 'A.BUN', 'polygonSoupList');
		expect(row?.isSelected).toBe(true);
	});

	it('Single-instance Resource-type row is selected at Instance level (no Resource-type level)', () => {
		// Single-instance resources collapse the level — clicking the row
		// gives Instance-level selection (index 0). This row is "selected"
		// when the Instance-level selection is on it.
		const bundles = [makeBundle('A.BUN', { aiSections: [{}] })];
		const selection: WorkspaceSelection = {
			bundleId: 'A.BUN',
			resourceKey: 'aiSections',
			index: 0,
			path: [],
		};
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([bundleKey('A.BUN')]),
			selection,
		});
		const row = findResourceType(flat, 'A.BUN', 'aiSections');
		expect(row?.isSelected).toBe(true);
	});

	it('eye icon flag is set for World-viewport-family resource types', () => {
		const bundles = [
			makeBundle('A.BUN', { aiSections: [{}], challengeList: [{}] }),
		];
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([bundleKey('A.BUN')]),
			selection: null,
		});
		// aiSections is World-viewport family → eye icon shown.
		expect(findResourceType(flat, 'A.BUN', 'aiSections')?.showVisibility).toBe(true);
		// challengeList is Standard-viewport (not world coords) → no eye.
		expect(findResourceType(flat, 'A.BUN', 'challengeList')?.showVisibility).toBe(
			false,
		);
	});
});

// ---------------------------------------------------------------------------
// Instance rows (multi-instance only)
// ---------------------------------------------------------------------------

describe('buildWorkspaceFlat — Instance rows', () => {
	it('emits one Instance row per item in a multi-instance ResourceType when expanded', () => {
		const bundles = [makeBundle('A.BUN', { polygonSoupList: [{}, {}, {}] })];
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([
				bundleKey('A.BUN'),
				resourceTypeKey('A.BUN', 'polygonSoupList'),
			]),
			selection: null,
		});
		const instances = flat.filter(
			(n): n is InstanceFlatNode => n.kind === 'instance',
		);
		expect(instances).toHaveLength(3);
		expect(instances.map((i) => i.index)).toEqual([0, 1, 2]);
	});

	it('does NOT emit Instance rows for single-instance ResourceTypes', () => {
		// Single-instance "resources" (count === 1) collapse the level — there
		// is no separate Instance row; clicking the ResourceType row selects
		// the only instance directly.
		const bundles = [makeBundle('A.BUN', { aiSections: [{}] })];
		const selection: WorkspaceSelection = {
			bundleId: 'A.BUN',
			resourceKey: 'aiSections',
			index: 0,
			path: [],
		};
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([bundleKey('A.BUN')]),
			selection,
		});
		const instances = flat.filter((n) => n.kind === 'instance');
		expect(instances).toHaveLength(0);
	});

	it('the selected Instance row is marked isSelected', () => {
		const bundles = [makeBundle('A.BUN', { polygonSoupList: [{}, {}, {}] })];
		const selection: WorkspaceSelection = {
			bundleId: 'A.BUN',
			resourceKey: 'polygonSoupList',
			index: 1,
			path: [],
		};
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([
				bundleKey('A.BUN'),
				resourceTypeKey('A.BUN', 'polygonSoupList'),
			]),
			selection,
		});
		expect(findInstance(flat, 'A.BUN', 'polygonSoupList', 0)?.isSelected).toBe(false);
		expect(findInstance(flat, 'A.BUN', 'polygonSoupList', 1)?.isSelected).toBe(true);
		expect(findInstance(flat, 'A.BUN', 'polygonSoupList', 2)?.isSelected).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Schema rows
// ---------------------------------------------------------------------------

describe('buildWorkspaceFlat — Schema rows', () => {
	it('emits NO schema rows when no Instance is selected (multi-instance)', () => {
		const bundles = [makeBundle('A.BUN', { polygonSoupList: [{}, {}] })];
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([
				bundleKey('A.BUN'),
				resourceTypeKey('A.BUN', 'polygonSoupList'),
			]),
			selection: null,
		});
		expect(flat.filter((n) => n.kind === 'schema')).toHaveLength(0);
	});

	it('emits schema rows beneath the selected Instance (multi-instance), skipping a redundant root', () => {
		// The Instance row above already represents `path: []`, so the schema
		// subtree skips the would-be root row (whose label duplicates the
		// Instance row's) and starts at the root record's first-level fields.
		const bundles = [
			makeBundle('A.BUN', {
				polygonSoupList: [{ soups: [], boundingBox: {} }, {}],
			}),
		];
		const selection: WorkspaceSelection = {
			bundleId: 'A.BUN',
			resourceKey: 'polygonSoupList',
			index: 0,
			path: [],
		};
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([
				bundleKey('A.BUN'),
				resourceTypeKey('A.BUN', 'polygonSoupList'),
			]),
			selection,
		});
		const schemaRows = flat.filter(
			(n): n is SchemaFlatNode => n.kind === 'schema',
		);
		expect(schemaRows.length).toBeGreaterThan(0);
		// No row carries `schemaPath: []` — the root is suppressed.
		expect(schemaRows.find((r) => r.schemaPath.length === 0)).toBeUndefined();
		// Every emitted row addresses the right (bundle, key, index).
		for (const row of schemaRows) {
			expect(row.bundleId).toBe('A.BUN');
			expect(row.resourceKey).toBe('polygonSoupList');
			expect(row.index).toBe(0);
		}
	});

	it('emits schema rows directly under a single-instance ResourceType when selected', () => {
		// Single-instance: schema subtree hangs under the ResourceType row
		// (no separate Instance row, no schema-root row). The first-level
		// schema rows render at depth 2 — one indent below the ResourceType
		// row at depth 1.
		const bundles = [makeBundle('A.BUN', { aiSections: [{ sections: [] }] })];
		const selection: WorkspaceSelection = {
			bundleId: 'A.BUN',
			resourceKey: 'aiSections',
			index: 0,
			path: [],
		};
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([bundleKey('A.BUN')]),
			selection,
		});
		const schemaRows = flat.filter(
			(n): n is SchemaFlatNode => n.kind === 'schema',
		);
		expect(schemaRows.length).toBeGreaterThan(0);
		// First-level rows (path length 1) at depth 2; no root row.
		expect(schemaRows.find((r) => r.schemaPath.length === 0)).toBeUndefined();
		const firstLevel = schemaRows.find((r) => r.schemaPath.length === 1);
		expect(firstLevel?.depth).toBe(2);
	});

	it('only the selected Instance gets a schema subtree (compact list)', () => {
		// Per ADR-0007 / issue #24: schema rows render only under the selected
		// Resource/Instance. Other instances' subtrees stay collapsed to keep
		// the virtualised list small.
		const bundles = [
			makeBundle('A.BUN', {
				polygonSoupList: [
					{ soups: [], boundingBox: {} },
					{ soups: [], boundingBox: {} },
				],
			}),
		];
		const selection: WorkspaceSelection = {
			bundleId: 'A.BUN',
			resourceKey: 'polygonSoupList',
			index: 0,
			path: [],
		};
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([
				bundleKey('A.BUN'),
				resourceTypeKey('A.BUN', 'polygonSoupList'),
			]),
			selection,
		});
		// Every schema row should be addressed at index 0 — the unselected
		// index-1 instance must not contribute schema rows.
		const schemaRows = flat.filter(
			(n): n is SchemaFlatNode => n.kind === 'schema',
		);
		for (const row of schemaRows) {
			expect(row.index).toBe(0);
		}
	});
});

// ---------------------------------------------------------------------------
// Round-trip: drilling into a polygon soup's portals across two Bundles
// ---------------------------------------------------------------------------

describe('buildWorkspaceFlat — two-Bundle drill flow (acceptance)', () => {
	it('expanded TRK_UNIT_07.BUN + WORLDCOL.BIN, drill into polygonSoupList #0', () => {
		// Mirrors the issue #24 HITL scenario: two bundles, click a PSL row,
		// schema subtree appears beneath that instance.
		const trk = makeBundle('TRK_UNIT_07.BUN', {
			aiSections: [{ sections: [] }],
			streetData: [{ streets: [] }],
		});
		const wcol = makeBundle('WORLDCOL.BIN', {
			polygonSoupList: [
				{ soups: [], boundingBox: {} },
				{ soups: [], boundingBox: {} },
			],
		});
		const selection: WorkspaceSelection = {
			bundleId: 'WORLDCOL.BIN',
			resourceKey: 'polygonSoupList',
			index: 0,
			path: [],
		};
		const flat = buildWorkspaceFlat({
			bundles: [trk, wcol],
			expanded: new Set([
				bundleKey('TRK_UNIT_07.BUN'),
				bundleKey('WORLDCOL.BIN'),
				resourceTypeKey('WORLDCOL.BIN', 'polygonSoupList'),
			]),
			selection,
		});

		// Both bundle rows present.
		expect(findBundle(flat, 'TRK_UNIT_07.BUN')).toBeDefined();
		expect(findBundle(flat, 'WORLDCOL.BIN')).toBeDefined();
		// PSL multi-instance ResourceType row + 2 Instance rows beneath.
		expect(
			findResourceType(flat, 'WORLDCOL.BIN', 'polygonSoupList')?.isMultiInstance,
		).toBe(true);
		expect(findInstance(flat, 'WORLDCOL.BIN', 'polygonSoupList', 0)?.isSelected).toBe(
			true,
		);
		expect(findInstance(flat, 'WORLDCOL.BIN', 'polygonSoupList', 1)?.isSelected).toBe(
			false,
		);
		// Schema subtree under instance #0.
		const schemaRows = flat.filter(
			(n): n is SchemaFlatNode => n.kind === 'schema',
		);
		expect(schemaRows.length).toBeGreaterThan(0);
		expect(schemaRows.every((r) => r.bundleId === 'WORLDCOL.BIN')).toBe(true);
		expect(schemaRows.every((r) => r.index === 0)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Selection round-trips per row kind (issue #24 acceptance)
// ---------------------------------------------------------------------------

describe('Selection round-trips per row kind', () => {
	it('Bundle row → selection { bundleId, path: [] }', () => {
		// Round-trip: build a Bundle-level selection, verify selectionLevel
		// classifies it correctly, then verify the builder marks the right
		// row as selected.
		const bundles = [makeBundle('A.BUN', { aiSections: [{}] })];
		const sel: WorkspaceSelection = { bundleId: 'A.BUN', path: [] };
		expect(selectionLevel(sel)).toBe('bundle');
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set(),
			selection: sel,
		});
		expect(findBundle(flat, 'A.BUN')?.isSelected).toBe(true);
	});

	it('Resource-type row → selection { bundleId, resourceKey, path: [] } (multi-instance)', () => {
		const bundles = [makeBundle('A.BUN', { polygonSoupList: [{}, {}] })];
		const sel: WorkspaceSelection = {
			bundleId: 'A.BUN',
			resourceKey: 'polygonSoupList',
			path: [],
		};
		expect(selectionLevel(sel)).toBe('resourceType');
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([bundleKey('A.BUN')]),
			selection: sel,
		});
		expect(findResourceType(flat, 'A.BUN', 'polygonSoupList')?.isSelected).toBe(true);
	});

	it('Instance row → selection { bundleId, resourceKey, index, path: [] }', () => {
		const bundles = [makeBundle('A.BUN', { polygonSoupList: [{}, {}] })];
		const sel: WorkspaceSelection = {
			bundleId: 'A.BUN',
			resourceKey: 'polygonSoupList',
			index: 1,
			path: [],
		};
		expect(selectionLevel(sel)).toBe('instance');
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([
				bundleKey('A.BUN'),
				resourceTypeKey('A.BUN', 'polygonSoupList'),
			]),
			selection: sel,
		});
		expect(findInstance(flat, 'A.BUN', 'polygonSoupList', 1)?.isSelected).toBe(true);
	});

	it('Schema row → selection { bundleId, resourceKey, index, path: [...non-empty] }', () => {
		const bundles = [
			makeBundle('A.BUN', { aiSections: [{ sections: [{}, {}] }] }),
		];
		const sel: WorkspaceSelection = {
			bundleId: 'A.BUN',
			resourceKey: 'aiSections',
			index: 0,
			path: ['sections'],
		};
		expect(selectionLevel(sel)).toBe('schema');
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([bundleKey('A.BUN')]),
			selection: sel,
		});
		const target = flat.find(
			(n): n is SchemaFlatNode =>
				n.kind === 'schema' &&
				n.schemaPath.length === 1 &&
				n.schemaPath[0] === 'sections',
		);
		expect(target).toBeDefined();
		expect(target?.isSelected).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Visibility-icon rules per acceptance criterion
// ---------------------------------------------------------------------------

describe('eye icon (Visibility) per row kind', () => {
	it('Bundle row shows eye when any of its resources is World-viewport family', () => {
		const bundles = [makeBundle('A.BUN', { aiSections: [{}] })];
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set(),
			selection: null,
		});
		expect(findBundle(flat, 'A.BUN')?.showVisibility).toBe(true);
	});

	it('Bundle row hides eye when only Standard-viewport resources are present', () => {
		// challengeList / vehicleList have no scene contribution — no eye.
		const bundles = [makeBundle('A.BUN', { challengeList: [{}], vehicleList: [{}] })];
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set(),
			selection: null,
		});
		expect(findBundle(flat, 'A.BUN')?.showVisibility).toBe(false);
	});

	it('Schema rows do NOT carry a visibility flag (no eye icon)', () => {
		// ADR-0007: eye stops at the Instance level — schema rows are
		// sub-shapes of their parent Resource, not independent scene nodes.
		// The SchemaFlatNode shape doesn't even carry a `showVisibility` field;
		// the row component never renders an eye for kind === 'schema'. Sanity-
		// check by walking every schema row and asserting no such field.
		const bundles = [makeBundle('A.BUN', { aiSections: [{ sections: [] }] })];
		const sel: WorkspaceSelection = {
			bundleId: 'A.BUN',
			resourceKey: 'aiSections',
			index: 0,
			path: [],
		};
		const flat = buildWorkspaceFlat({
			bundles,
			expanded: new Set([bundleKey('A.BUN')]),
			selection: sel,
		});
		for (const row of flat) {
			if (row.kind === 'schema') {
				expect((row as Record<string, unknown>).showVisibility).toBeUndefined();
			}
		}
	});
});

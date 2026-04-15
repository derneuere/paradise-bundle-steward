// Schema coverage + path-walk + mutation tests for renderableResourceSchema.
//
// The schema wraps every parsed 0xC resource in a RenderableCollection
// record so the editor can show all of them in a single tree. This test
// mirrors that wrapping: it loads VEH_CARBRWDS_GR.BIN, parses every
// populated Renderable, and builds the same `{ renderables, _debugNames,
// _triCounts }` shape the page passes to the SchemaEditorProvider.
//
// Renderable is read-only (caps.write = false) so there is no byte
// round-trip assertion. Coverage:
//   1. Registry completeness — every record type referenced by a `record`
//      or `list<record>` field is registered.
//   2. Schema coverage — walkResource visits the wrapper without flagging
//      missing / unknown fields.
//   3. Path resolution — resolveSchemaAtPath handles deep paths like
//      `renderables[0].meshes[2].numIndices`.
//   4. Mutation — updateAtPath respects structural sharing on a deep edit.
//   5. Tree labels — the collection + per-item callbacks produce reasonable
//      strings on real data.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw } from '../../core/registry/extract';
import { resourceCtxFromBundle } from '../../core/registry/handler';
import {
	parseRenderable,
	RENDERABLE_TYPE_ID,
	type ParsedRenderable,
} from '../../core/renderable';

import { renderableResourceSchema } from './renderable';
import {
	getAtPath,
	resolveSchemaAtPath,
	setAtPath,
	updateAtPath,
	walkResource,
	formatPath,
} from '../walk';
import type { FieldSchema } from '../types';

// ---------------------------------------------------------------------------
// Fixture loader — load every populated Renderable in VEH_CARBRWDS_GR.BIN
// and wrap them the same way the page does.
// ---------------------------------------------------------------------------

type RenderableCollection = {
	renderables: ParsedRenderable[];
	_debugNames: (string | null)[];
	_triCounts: number[];
};

const FIXTURE = path.resolve(__dirname, '../../../../example/VEH_CARBRWDS_GR.BIN');

function loadRenderableCollection(): { wrapper: RenderableCollection; totalRenderables: number } {
	const fileBytes = fs.readFileSync(FIXTURE);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer);
	// Sanity check the registry ctx even though we don't use it directly
	// (parseRenderable doesn't consume it).
	resourceCtxFromBundle(bundle);

	const renderables = bundle.resources.filter(
		(r) => r.resourceTypeId === RENDERABLE_TYPE_ID,
	);
	if (renderables.length === 0) {
		throw new Error('VEH_CARBRWDS_GR.BIN has no Renderable resources — fixture moved?');
	}

	const parsed: ParsedRenderable[] = [];
	const debugNames: (string | null)[] = [];
	const triCounts: number[] = [];

	for (const r of renderables) {
		try {
			const raw = extractResourceRaw(buffer.buffer, bundle, r);
			const p = parseRenderable(raw, new Map());
			if (p.meshes.length === 0) continue;
			parsed.push(p);
			debugNames.push(null);
			let tris = 0;
			for (const m of p.meshes) {
				if (m.primitiveType === 4) tris += Math.floor(m.numIndices / 3);
			}
			triCounts.push(tris);
		} catch {
			// Skip header-only stubs — matches what the decoder does.
		}
	}

	if (parsed.length === 0) {
		throw new Error('VEH_CARBRWDS_GR.BIN has no populated Renderable resources');
	}

	return {
		wrapper: { renderables: parsed, _debugNames: debugNames, _triCounts: triCounts },
		totalRenderables: renderables.length,
	};
}

const { wrapper: collection, totalRenderables } = loadRenderableCollection();

// ---------------------------------------------------------------------------
// 1. Registry completeness
// ---------------------------------------------------------------------------

describe('renderableResourceSchema registry', () => {
	it('contains the root RenderableCollection type', () => {
		expect(renderableResourceSchema.registry.RenderableCollection).toBeDefined();
	});

	it('contains every nested record type', () => {
		const expected = [
			'ParsedRenderable',
			'RenderableHeader',
			'IndexBufferDescriptor',
			'VertexBufferDescriptor',
			'RenderableMesh',
		];
		for (const name of expected) {
			expect(renderableResourceSchema.registry[name]).toBeDefined();
		}
	});

	it('every `record` or `list<record>` field references a registered type', () => {
		const missing: string[] = [];
		for (const [recordName, record] of Object.entries(renderableResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(record.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}

		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!renderableResourceSchema.registry[f.type]) {
					out.push(`${where} -> "${f.type}"`);
				}
				return;
			}
			if (f.kind === 'list') {
				checkField(f.item, `${where}[]`, out);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// 2. Schema coverage — walker visits every parsed field
// ---------------------------------------------------------------------------

describe('renderableResourceSchema coverage', () => {
	it('fixture yields at least one populated renderable', () => {
		expect(totalRenderables).toBeGreaterThan(0);
		expect(collection.renderables.length).toBeGreaterThan(0);
		expect(collection.renderables[0].meshes.length).toBeGreaterThan(0);
	});

	it('walkResource visits records and fields without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(renderableResourceSchema, collection, (_path, _value, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		// Expect at least: root + N renderables × (header + indexBuffer +
		// vertexBuffer + meshes). With a populated bundle this comfortably
		// clears 20 records.
		expect(recordCount).toBeGreaterThan(10);
		expect(fieldCount).toBeGreaterThan(50);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(renderableResourceSchema, collection, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			// Skip Float32Array / typed-array leaves — matrix44 fields handle
			// them, and Object.keys() on a typed array yields numeric indices.
			if (ArrayBuffer.isView(value)) return;
			const declared = new Set(Object.keys(record.fields));
			for (const key of Object.keys(value as Record<string, unknown>)) {
				if (!declared.has(key)) {
					missing.push(`${formatPath(p)}.${key}  (record "${record.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(
				`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''}`,
			);
		}
	});

	it('every schema field exists on the parsed data', () => {
		const missing: string[] = [];
		walkResource(renderableResourceSchema, collection, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			if (ArrayBuffer.isView(value)) return;
			const obj = value as Record<string, unknown>;
			for (const fieldName of Object.keys(record.fields)) {
				if (!(fieldName in obj)) {
					missing.push(`${formatPath(p)}.${fieldName}  (record "${record.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(
				`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''}`,
			);
		}
	});
});

// ---------------------------------------------------------------------------
// 3. Path resolution
// ---------------------------------------------------------------------------

describe('resolveSchemaAtPath', () => {
	it('resolves the root to RenderableCollection', () => {
		const loc = resolveSchemaAtPath(renderableResourceSchema, []);
		expect(loc?.record?.name).toBe('RenderableCollection');
	});

	it('resolves renderables[0] to ParsedRenderable', () => {
		const loc = resolveSchemaAtPath(renderableResourceSchema, ['renderables', 0]);
		expect(loc?.record?.name).toBe('ParsedRenderable');
	});

	it('resolves renderables[0].header to RenderableHeader', () => {
		const loc = resolveSchemaAtPath(renderableResourceSchema, ['renderables', 0, 'header']);
		expect(loc?.record?.name).toBe('RenderableHeader');
	});

	it('resolves a deep primitive inside a mesh', () => {
		const loc = resolveSchemaAtPath(
			renderableResourceSchema,
			['renderables', 0, 'meshes', 0, 'numIndices'],
		);
		expect(loc?.field?.kind).toBe('u32');
	});

	it('resolves renderables[0].meshes[0].vertexDescriptorIds[0] as a bigint leaf', () => {
		const loc = resolveSchemaAtPath(
			renderableResourceSchema,
			['renderables', 0, 'meshes', 0, 'vertexDescriptorIds', 0],
		);
		expect(loc?.field?.kind).toBe('bigint');
	});

	it('returns null for an unknown field', () => {
		const loc = resolveSchemaAtPath(renderableResourceSchema, ['notAField']);
		expect(loc).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 4. Data get / update — structural sharing + deep edit
// ---------------------------------------------------------------------------

describe('getAtPath / updateAtPath', () => {
	it('getAtPath returns the root for an empty path', () => {
		expect(getAtPath(collection, [])).toBe(collection);
	});

	it('getAtPath walks into a mesh primitive', () => {
		const n = getAtPath(collection, ['renderables', 0, 'meshes', 0, 'numIndices']);
		expect(typeof n).toBe('number');
		expect(n).toBe(collection.renderables[0].meshes[0].numIndices);
	});

	it('setAtPath replaces a header field, leaves siblings intact', () => {
		const before = collection.renderables[0].header.flagsAndPadding;
		const next = setAtPath(
			collection,
			['renderables', 0, 'header', 'flagsAndPadding'],
			0xDEADBEEF,
		) as RenderableCollection;
		expect(next.renderables[0].header.flagsAndPadding).toBe(0xDEADBEEF);
		// Other renderables share references — structural sharing proof.
		for (let i = 1; i < collection.renderables.length; i++) {
			expect(next.renderables[i]).toBe(collection.renderables[i]);
		}
		// Original untouched.
		expect(collection.renderables[0].header.flagsAndPadding).toBe(before);
	});

	it('updateAtPath deep-edits renderables[0].meshes[0].meshFlags', () => {
		const before = collection.renderables[0].meshes[0].meshFlags;
		const next = updateAtPath(
			collection,
			['renderables', 0, 'meshes', 0, 'meshFlags'],
			() => 0xAB,
		) as RenderableCollection;
		expect(next.renderables[0].meshes[0].meshFlags).toBe(0xAB);
		// Sibling meshes untouched by reference.
		for (let i = 1; i < collection.renderables[0].meshes.length; i++) {
			expect(next.renderables[0].meshes[i]).toBe(collection.renderables[0].meshes[i]);
		}
		// Original untouched.
		expect(collection.renderables[0].meshes[0].meshFlags).toBe(before);
	});
});

// ---------------------------------------------------------------------------
// 5. Tree-label callbacks
// ---------------------------------------------------------------------------

describe('renderable tree labels', () => {
	const ctx = { root: collection, resource: renderableResourceSchema };

	it('collection label summarizes renderable count and triangles', () => {
		const schema = renderableResourceSchema.registry.RenderableCollection;
		const label = schema.label?.(
			collection as unknown as Record<string, unknown>,
			null,
			ctx,
		);
		expect(label).toBeDefined();
		// Use a lenient thousand-separator class (comma or period) so the test
		// is locale-agnostic — toLocaleString() on this box returns "27.715"
		// under de-DE but "27,715" under en-US.
		expect(label!).toMatch(/^\d+ renderables? · [\d.,]+ tris$/);
	});

	it('renderable-item label uses the tri count and mesh count', () => {
		const schema = renderableResourceSchema.registry.ParsedRenderable;
		const label = schema.label?.(
			collection.renderables[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(label).toBeDefined();
		// Either "#0 · N meshes · M tris" (no debug name in this fixture)
		// or "{name} · N meshes · M tris" if RST debug data is present.
		expect(label!).toMatch(/· \d+ mesh(es)? · /);
	});

	it('mesh label contains the index and a triangle or index count', () => {
		const schema = renderableResourceSchema.registry.RenderableMesh;
		const label = schema.label?.(
			collection.renderables[0].meshes[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(label).toBeDefined();
		expect(label!).toMatch(/^Mesh 0 · /);
		expect(label!).toMatch(/(tris|idx)$/);
	});
});

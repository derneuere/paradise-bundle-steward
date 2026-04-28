// Unit tests for the schema-tagged spatial-translate walker.

import { describe, it, expect } from 'vitest';
import { translateRecordBySpatial } from './spatial';
import type { FieldSchema, RecordSchema, SchemaRegistry } from './types';

// =============================================================================
// Builders
// =============================================================================

const u32: FieldSchema = { kind: 'u32' };
const vec2: FieldSchema = { kind: 'vec2' };
const vec3: FieldSchema = { kind: 'vec3' };
const vec4: FieldSchema = { kind: 'vec4' };

function recordRef(type: string): FieldSchema {
	return { kind: 'record', type };
}

function listOf(item: FieldSchema): FieldSchema {
	return { kind: 'list', item };
}

// =============================================================================
// Tests
// =============================================================================

describe('translateRecordBySpatial', () => {
	it('translates a vec2-xz field by (dx, dz)', () => {
		const schema: RecordSchema = {
			name: 'P',
			fields: { p: vec2 },
			fieldMetadata: { p: { spatial: 'vec2-xz' } },
		};
		const out = translateRecordBySpatial({ p: { x: 5, y: 7 } }, schema, { x: 1, y: 100, z: 2 }, { P: schema });
		// Y of the offset is irrelevant for vec2-xz: the y-field stores world Z.
		expect(out.p).toEqual({ x: 6, y: 9 });
	});

	it('translates a vec3 field by the full offset', () => {
		const schema: RecordSchema = {
			name: 'P',
			fields: { pos: vec3 },
			fieldMetadata: { pos: { spatial: 'vec3' } },
		};
		const out = translateRecordBySpatial({ pos: { x: 1, y: 2, z: 3 } }, schema, { x: 10, y: 20, z: 30 }, { P: schema });
		expect(out.pos).toEqual({ x: 11, y: 22, z: 33 });
	});

	it('translates both endpoints of a segment2d-xz packed Vector4', () => {
		const schema: RecordSchema = {
			name: 'BL',
			fields: { verts: vec4 },
			fieldMetadata: { verts: { spatial: 'segment2d-xz' } },
		};
		const out = translateRecordBySpatial(
			{ verts: { x: 1, y: 2, z: 3, w: 4 } },
			schema,
			{ x: 10, y: 999, z: 100 },
			{ BL: schema },
		);
		// (startX+dx, startZ+dz, endX+dx, endZ+dz). offset.y unused for segment2d-xz.
		expect(out.verts).toEqual({ x: 11, y: 102, z: 13, w: 104 });
	});

	it('translates every item of a `vec2-xz` list', () => {
		const schema: RecordSchema = {
			name: 'P',
			fields: { corners: listOf(vec2) },
			fieldMetadata: { corners: { spatial: 'vec2-xz' } },
		};
		const out = translateRecordBySpatial(
			{ corners: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
			schema,
			{ x: 1, y: 0, z: 2 },
			{ P: schema },
		);
		expect(out.corners).toEqual([{ x: 1, y: 2 }, { x: 6, y: 7 }]);
	});

	it('recurses into a nested record (untagged) and translates spatial fields inside', () => {
		const Inner: RecordSchema = {
			name: 'Inner',
			fields: { p: vec3 },
			fieldMetadata: { p: { spatial: 'vec3' } },
		};
		const Outer: RecordSchema = {
			name: 'Outer',
			fields: { inner: recordRef('Inner') },
		};
		const reg: SchemaRegistry = { Inner, Outer };
		const out = translateRecordBySpatial(
			{ inner: { p: { x: 1, y: 2, z: 3 } } },
			Outer,
			{ x: 10, y: 0, z: 0 },
			reg,
		);
		expect(out.inner).toEqual({ p: { x: 11, y: 2, z: 3 } });
	});

	it('recurses into a list of records', () => {
		const Item: RecordSchema = {
			name: 'Item',
			fields: { p: vec2 },
			fieldMetadata: { p: { spatial: 'vec2-xz' } },
		};
		const Outer: RecordSchema = {
			name: 'Outer',
			fields: { items: listOf(recordRef('Item')) },
		};
		const reg: SchemaRegistry = { Item, Outer };
		const out = translateRecordBySpatial(
			{ items: [{ p: { x: 1, y: 1 } }, { p: { x: 2, y: 2 } }] },
			Outer,
			{ x: 0, y: 0, z: 5 },
			reg,
		);
		expect(out.items).toEqual([{ p: { x: 1, y: 6 } }, { p: { x: 2, y: 7 } }]);
	});

	it('passes through untagged primitive fields unchanged', () => {
		const schema: RecordSchema = {
			name: 'P',
			fields: { id: u32, p: vec3 },
			fieldMetadata: { p: { spatial: 'vec3' } },
		};
		const out = translateRecordBySpatial(
			{ id: 0xDEAD, p: { x: 0, y: 0, z: 0 } },
			schema,
			{ x: 1, y: 2, z: 3 },
			{ P: schema },
		);
		expect(out.id).toBe(0xDEAD);
		expect(out.p).toEqual({ x: 1, y: 2, z: 3 });
	});

	it('returns a new object (no in-place mutation)', () => {
		const schema: RecordSchema = {
			name: 'P',
			fields: { p: vec2 },
			fieldMetadata: { p: { spatial: 'vec2-xz' } },
		};
		const input = { p: { x: 0, y: 0 } };
		const out = translateRecordBySpatial(input, schema, { x: 1, y: 0, z: 1 }, { P: schema });
		expect(out).not.toBe(input);
		expect(out.p).not.toBe(input.p);
		expect(input.p).toEqual({ x: 0, y: 0 }); // original untouched
	});

	it('passes null fields through without crashing', () => {
		const schema: RecordSchema = {
			name: 'P',
			fields: { p: vec3 },
			fieldMetadata: { p: { spatial: 'vec3' } },
		};
		const out = translateRecordBySpatial({ p: null }, schema, { x: 1, y: 2, z: 3 }, { P: schema });
		expect(out.p).toBeNull();
	});

	it('end-to-end: translate an AISection-shaped record by (dx, 0, dz)', () => {
		// Hand-build the same shape the real AISection schema uses, with all
		// spatial fields tagged.
		const BoundaryLine: RecordSchema = {
			name: 'BoundaryLine',
			fields: { verts: vec4 },
			fieldMetadata: { verts: { spatial: 'segment2d-xz' } },
		};
		const Portal: RecordSchema = {
			name: 'Portal',
			fields: {
				position: vec3,
				boundaryLines: listOf(recordRef('BoundaryLine')),
				linkSection: { kind: 'u16' },
			},
			fieldMetadata: { position: { spatial: 'vec3' } },
		};
		const AISection: RecordSchema = {
			name: 'AISection',
			fields: {
				portals: listOf(recordRef('Portal')),
				noGoLines: listOf(recordRef('BoundaryLine')),
				corners: listOf(vec2),
				id: { kind: 'u32' },
			},
			fieldMetadata: { corners: { spatial: 'vec2-xz' } },
		};
		const reg: SchemaRegistry = { BoundaryLine, Portal, AISection };

		const sec = {
			id: 1,
			corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
			portals: [
				{
					position: { x: 5, y: 27.99, z: 0 },
					linkSection: 7,
					boundaryLines: [{ verts: { x: 0, y: 0, z: 10, w: 0 } }],
				},
			],
			noGoLines: [{ verts: { x: 1, y: 1, z: 9, w: 1 } }],
		};

		// Drag offset in XZ: dx=100, dz=-50.
		const out = translateRecordBySpatial(sec, AISection, { x: 100, y: 0, z: -50 }, reg) as typeof sec;

		expect(out.corners).toEqual([
			{ x: 100, y: -50 },
			{ x: 110, y: -50 },
			{ x: 110, y: -40 },
			{ x: 100, y: -40 },
		]);
		expect(out.portals[0].position).toEqual({ x: 105, y: 27.99, z: -50 });
		expect(out.portals[0].linkSection).toBe(7); // untagged primitive untouched
		expect(out.portals[0].boundaryLines[0].verts).toEqual({ x: 100, y: -50, z: 110, w: -50 });
		expect(out.noGoLines[0].verts).toEqual({ x: 101, y: -49, z: 109, w: -49 });
		expect(out.id).toBe(1);
	});
});

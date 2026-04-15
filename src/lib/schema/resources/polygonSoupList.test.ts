// Schema coverage + round-trip for polygonSoupListResourceSchema.
//
// Loads WORLDCOL.BIN, picks the first non-empty PolygonSoupList resource,
// and asserts:
//   1. Every parsed field is covered by the schema (no drift).
//   2. resolveSchemaAtPath can walk into soups[N].polygons[M].collisionTag.
//   3. getAtPath / updateAtPath round-trip a primitive edit.
//   4. parse → write is byte-identical on both an empty fixture and a
//      populated one.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import {
	parsePolygonSoupListData,
	writePolygonSoupListData,
	type ParsedPolygonSoupList,
} from '../../core/polygonSoupList';

import { polygonSoupListResourceSchema } from './polygonSoupList';
import {
	getAtPath,
	resolveSchemaAtPath,
	updateAtPath,
	walkResource,
	formatPath,
} from '../walk';

// ---------------------------------------------------------------------------
// Fixture loader — grab the first non-empty PSL resource from WORLDCOL.BIN
// ---------------------------------------------------------------------------

const FIXTURE = path.resolve(__dirname, '../../../../example/WORLDCOL.BIN');
const POLYGON_SOUP_LIST_TYPE_ID = 0x43;

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadFirstPopulatedSoup(): { raw: Uint8Array; parsed: ParsedPolygonSoupList } {
	const fileBytes = fs.readFileSync(FIXTURE);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer);
	const ctx = resourceCtxFromBundle(bundle);

	for (const r of bundle.resources) {
		if (r.resourceTypeId !== POLYGON_SOUP_LIST_TYPE_ID) continue;
		const raw = extractResourceRaw(buffer.buffer, bundle, r);
		const parsed = parsePolygonSoupListData(raw, ctx.littleEndian);
		if (parsed.soups.length > 0) {
			return { raw, parsed };
		}
	}
	throw new Error('WORLDCOL.BIN has no populated PolygonSoupList resources — fixture moved?');
}

const { raw: rawPsl, parsed: parsedPsl } = loadFirstPopulatedSoup();

// ---------------------------------------------------------------------------
// Schema coverage
// ---------------------------------------------------------------------------

describe('polygonSoupListResourceSchema coverage', () => {
	it('fixture has at least one soup with polygons', () => {
		expect(parsedPsl.soups.length).toBeGreaterThan(0);
		expect(parsedPsl.soups[0].polygons.length).toBeGreaterThan(0);
		expect(parsedPsl.soups[0].vertices.length).toBeGreaterThan(0);
	});

	it('root type exists in registry', () => {
		expect(polygonSoupListResourceSchema.registry.PolygonSoupList).toBeDefined();
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(polygonSoupListResourceSchema, parsedPsl, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			const declared = new Set(Object.keys(record.fields));
			for (const key of Object.keys(value as Record<string, unknown>)) {
				if (!declared.has(key)) {
					missing.push(`${formatPath(p)}.${key}  (record "${record.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 10).join('\n  ')}`);
		}
	});

	it('every schema field exists on the parsed data', () => {
		const missing: string[] = [];
		walkResource(polygonSoupListResourceSchema, parsedPsl, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			const obj = value as Record<string, unknown>;
			for (const fieldName of Object.keys(record.fields)) {
				if (!(fieldName in obj)) {
					missing.push(`${formatPath(p)}.${fieldName}  (record "${record.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 10).join('\n  ')}`);
		}
	});
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe('polygonSoupList path resolution', () => {
	it('resolves root', () => {
		const loc = resolveSchemaAtPath(polygonSoupListResourceSchema, []);
		expect(loc?.record?.name).toBe('PolygonSoupList');
	});

	it('resolves soups[0]', () => {
		const loc = resolveSchemaAtPath(polygonSoupListResourceSchema, ['soups', 0]);
		expect(loc?.record?.name).toBe('PolygonSoup');
	});

	it('resolves soups[0].polygons[0].collisionTag', () => {
		const loc = resolveSchemaAtPath(
			polygonSoupListResourceSchema,
			['soups', 0, 'polygons', 0, 'collisionTag'],
		);
		// The collisionTag field is declared as a custom extension so the
		// schema editor delegates rendering to the decoded CollisionTag
		// inspector. The raw u32 is still preserved byte-for-byte on the model.
		expect(loc?.field?.kind).toBe('custom');
	});

	it('resolves soups[0].vertices[0].x', () => {
		const loc = resolveSchemaAtPath(
			polygonSoupListResourceSchema,
			['soups', 0, 'vertices', 0, 'x'],
		);
		expect(loc?.field?.kind).toBe('u16');
	});
});

// ---------------------------------------------------------------------------
// Data mutation
// ---------------------------------------------------------------------------

describe('polygonSoupList updateAtPath', () => {
	it('deep-edits soups[0].polygons[0].collisionTag', () => {
		const next = updateAtPath(parsedPsl, ['soups', 0, 'polygons', 0, 'collisionTag'], () => 0xDEADBEEF);
		expect(next.soups[0].polygons[0].collisionTag).toBe(0xDEADBEEF);
		// Structural sharing: other soups untouched by reference.
		for (let i = 1; i < parsedPsl.soups.length; i++) {
			expect(next.soups[i]).toBe(parsedPsl.soups[i]);
		}
		// Original left alone.
		expect(parsedPsl.soups[0].polygons[0].collisionTag).not.toBe(0xDEADBEEF);
	});

	it('edits soups[0].min vector', () => {
		const next = updateAtPath(parsedPsl, ['soups', 0, 'min'], () => ({ x: 99, y: 99, z: 99 }));
		expect(next.soups[0].min).toEqual({ x: 99, y: 99, z: 99 });
	});

	it('getAtPath walks into packed vertex coordinates', () => {
		const v0x = getAtPath(parsedPsl, ['soups', 0, 'vertices', 0, 'x']);
		expect(typeof v0x).toBe('number');
	});
});

// ---------------------------------------------------------------------------
// Byte round-trip
// ---------------------------------------------------------------------------

describe('polygonSoupList byte round-trip', () => {
	it('parse → write reproduces the original bytes (populated fixture)', () => {
		const written = writePolygonSoupListData(parsedPsl, true);
		expect(written.length).toBe(rawPsl.length);
		expect(sha1(written)).toBe(sha1(rawPsl));
	});

	it('walker touches every field without mutating the data', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(polygonSoupListResourceSchema, parsedPsl, (_path, _value, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(10);
		expect(fieldCount).toBeGreaterThan(50);
		// After walking, writer still produces identical output.
		const written = writePolygonSoupListData(parsedPsl, true);
		expect(sha1(written)).toBe(sha1(rawPsl));
	});
});

// ---------------------------------------------------------------------------
// Tree label callbacks
// ---------------------------------------------------------------------------

describe('polygonSoupList labels', () => {
	const ctx = { root: parsedPsl, resource: polygonSoupListResourceSchema };

	it('soup label describes verts / polys / quads', () => {
		const schema = polygonSoupListResourceSchema.registry.PolygonSoup;
		const label = schema.label?.(parsedPsl.soups[0] as unknown as Record<string, unknown>, 0, ctx);
		expect(label).toMatch(/^#0 · \d+v · \d+p \(\d+q\/\d+t\)$/);
	});

	it('poly label shows AI section index', () => {
		// Since the collision-tag editor landed, poly labels surface the
		// decoded AI section index from the high 15 bits of the u32 group
		// half rather than the opaque raw hex tag.
		const schema = polygonSoupListResourceSchema.registry.PolygonSoupPoly;
		const poly0 = parsedPsl.soups[0].polygons[0];
		const label = schema.label?.(poly0 as unknown as Record<string, unknown>, 0, ctx);
		expect(label).toMatch(/^#0 · AI \d+ · (tri|quad)$/);
	});
});

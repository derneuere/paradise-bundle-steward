// Schema coverage tests for worldPainter2DResourceSchema.
//
// Coverage fixture: example/DISTRICTS.DAT (the single retail Districts map).
//
// Mirrors staticSoundMap.test.ts: parse the model and walk it against the
// schema asserting record references resolve, walkResource visits cleanly,
// no parser/schema field drift in either direction, and representative
// paths resolve with the expected field kinds.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseWorldPainter2D, type ParsedWorldPainter2D } from '../../core/worldPainter2D';

import { worldPainter2DResourceSchema, districtCellLabel } from './worldPainter2D';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/DISTRICTS.DAT');
const WORLD_PAINTER_2D_TYPE_ID = 0x30;

function loadModel(fixturePath: string): ParsedWorldPainter2D {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === WORLD_PAINTER_2D_TYPE_ID);
	if (!resource) throw new Error('fixture has no WorldPainter2D resource');
	return parseWorldPainter2D(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('worldPainter2DResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.muWidth).toBeGreaterThan(0);
		expect(model.muHeight).toBeGreaterThan(0);
		expect(model.cells.length).toBe(model.muWidth * model.muHeight);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(worldPainter2DResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!worldPainter2DResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(worldPainter2DResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(worldPainter2DResourceSchema, model, (p, value, _field, rec) => {
			if (!rec) return;
			if (value == null || typeof value !== 'object') return;
			const declared = new Set(Object.keys(rec.fields));
			for (const key of Object.keys(value as Record<string, unknown>)) {
				if (!declared.has(key)) {
					missing.push(`${formatPath(p)}.${key}  (record "${rec.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(`Schema is missing fields present in parsed data:\n  ${missing.join('\n  ')}`);
		}
	});

	it('every schema field is represented in the parsed data', () => {
		const missing: string[] = [];
		walkResource(worldPainter2DResourceSchema, model, (p, value, _field, rec) => {
			if (!rec) return;
			if (value == null || typeof value !== 'object') return;
			const obj = value as Record<string, unknown>;
			for (const fieldName of Object.keys(rec.fields)) {
				if (!(fieldName in obj)) {
					missing.push(`${formatPath(p)}.${fieldName}  (record "${rec.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(`Schema declares fields missing from parsed data:\n  ${missing.join('\n  ')}`);
		}
	});
});

describe('worldPainter2D path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(worldPainter2DResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedWorldPainter2D');
	});

	it('resolves muWidth as read-only u16', () => {
		const loc = resolveSchemaAtPath(worldPainter2DResourceSchema, ['muWidth']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u16');
	});

	it('resolves cells as a custom leaf (the dense grid is not a schema list)', () => {
		const loc = resolveSchemaAtPath(worldPainter2DResourceSchema, ['cells']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('custom');
	});
});

describe('districtCellLabel', () => {
	it('labels valid districts with their v1.9/Remastered name', () => {
		expect(districtCellLabel(0)).toBe('0 Ocean View');
		expect(districtCellLabel(14)).toBe('14 Downtown');
		expect(districtCellLabel(22)).toBe("22 Perren's Point");
	});

	it('labels the 0xFF sentinel as unpainted', () => {
		expect(districtCellLabel(255)).toBe('255 (unpainted)');
	});

	it('labels out-of-table values neutrally (Ambiences maps reuse the container)', () => {
		expect(districtCellLabel(23)).toBe('23 (no district name)');
	});
});

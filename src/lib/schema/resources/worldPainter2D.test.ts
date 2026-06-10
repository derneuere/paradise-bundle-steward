// Schema coverage tests for worldPainter2DResourceSchema.
//
// Coverage fixtures: example/DISTRICTS.DAT (Districts) and
// example/SOUND/AMBIENCES.DAT (Ambiences) — the two retail variants of the
// identical container; drift checks walk both models.
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

import { worldPainter2DResourceSchema, worldPainter2DCellLabel } from './worldPainter2D';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const WORLD_PAINTER_2D_TYPE_ID = 0x30;

function loadModel(bundleFile: string): ParsedWorldPainter2D {
	const fileBytes = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === WORLD_PAINTER_2D_TYPE_ID);
	if (!resource) throw new Error('fixture has no WorldPainter2D resource');
	return parseWorldPainter2D(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const models = [
	{ label: 'Districts', model: loadModel('example/DISTRICTS.DAT') },
	{ label: 'Ambiences', model: loadModel('example/SOUND/AMBIENCES.DAT') },
];

describe('worldPainter2DResourceSchema coverage', () => {
	it.each(models)('$label fixture parses with non-trivial content', ({ model }) => {
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

	it.each(models)('$label: walkResource visits every parsed field without throwing', ({ model }) => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(worldPainter2DResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it.each(models)('$label: no parsed record has fields absent from the schema', ({ model }) => {
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

	it.each(models)('$label: every schema field is represented in the parsed data', ({ model }) => {
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

describe('worldPainter2DCellLabel', () => {
	it('labels district cells with their v1.9/Remastered name', () => {
		expect(worldPainter2DCellLabel(0, 'districts')).toBe('0 Ocean View');
		expect(worldPainter2DCellLabel(14, 'districts')).toBe('14 Downtown');
		expect(worldPainter2DCellLabel(22, 'districts')).toBe("22 Perren's Point");
	});

	it('labels ambience cells numerically — district names never apply to them', () => {
		expect(worldPainter2DCellLabel(0, 'ambiences')).toBe('Ambience 0');
		expect(worldPainter2DCellLabel(14, 'ambiences')).toBe('Ambience 14');
		expect(worldPainter2DCellLabel(20, 'ambiences')).toBe('Ambience 20');
	});

	it('labels the 0xFF sentinel as unpainted in every variant', () => {
		expect(worldPainter2DCellLabel(255, 'districts')).toBe('255 (unpainted)');
		expect(worldPainter2DCellLabel(255, 'ambiences')).toBe('255 (unpainted)');
		expect(worldPainter2DCellLabel(255, null)).toBe('255 (unpainted)');
	});

	it('labels out-of-table values neutrally, per variant', () => {
		expect(worldPainter2DCellLabel(23, 'districts')).toBe('23 (no district name)');
		expect(worldPainter2DCellLabel(21, 'ambiences')).toBe('21 (beyond retail ambience ids)');
	});

	it('stays palette-neutral when the debug name resolved to no variant', () => {
		expect(worldPainter2DCellLabel(14, null)).toBe('14');
	});
});

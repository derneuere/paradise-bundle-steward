// Schema coverage tests for textureNameMapResourceSchema.
//
// Coverage fixture: example/PARTICLES.BUNDLE (the single retail map, 50
// entries). Mirrors staticSoundMap.test.ts: parse the model and walk it
// against the schema asserting record references resolve, walkResource
// visits cleanly, no parser/schema field drift in either direction, deep
// paths resolve — plus the derive hook that keeps the hash in lockstep with
// the GDB URI, and the tree labels that surface the bare texture names.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseTextureNameMap, hashLionTextureName, type ParsedTextureNameMap } from '../../core/textureNameMap';

import { textureNameMapResourceSchema } from './textureNameMap';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/PARTICLES.BUNDLE');
const TEXTURE_NAME_MAP_TYPE_ID = 0x1000b;

function loadModel(fixturePath: string): ParsedTextureNameMap {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === TEXTURE_NAME_MAP_TYPE_ID)!;
	return parseTextureNameMap(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);
const schema = textureNameMapResourceSchema;

describe('textureNameMapResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.entries.length).toBeGreaterThan(0);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(schema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!schema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(schema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(schema, model, (p, value, _field, rec) => {
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
		walkResource(schema, model, (p, value, _field, rec) => {
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

describe('textureNameMap path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(schema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedTextureNameMap');
	});

	it('resolves entries[0] as a TextureNameMapEntry', () => {
		const loc = resolveSchemaAtPath(schema, ['entries', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('TextureNameMapEntry');
	});

	it('resolves entries[0].mGDBTextureName as string and the hash as u32', () => {
		expect(resolveSchemaAtPath(schema, ['entries', 0, 'mGDBTextureName'])!.field?.kind).toBe('string');
		expect(resolveSchemaAtPath(schema, ['entries', 0, 'muHashedLionTextureName'])!.field?.kind).toBe('u32');
	});
});

describe('textureNameMap derive hook (hash follows the URI)', () => {
	const rec = schema.registry.TextureNameMapEntry;

	it('re-derives the hash when the GDB name changes', () => {
		const prev = { ...model.entries[0] } as Record<string, unknown>;
		const uri = 'gamedb://burnout5/Burnout/Effects/Textures/NewName.TextureConfig2d?ID=1';
		const next = { ...prev, mGDBTextureName: uri };
		expect(rec.derive!(prev, next)).toEqual({ muHashedLionTextureName: hashLionTextureName(uri) });
	});

	it('returns an empty patch when the GDB name is untouched', () => {
		const prev = { ...model.entries[0] } as Record<string, unknown>;
		const next = { ...prev, muHashedLionTextureName: 0 };
		expect(rec.derive!(prev, next)).toEqual({});
	});
});

describe('textureNameMap tree labels (actual texture names)', () => {
	it('labels entries with the bare Lion texture name, not the full URI', () => {
		const rec = schema.registry.TextureNameMapEntry;
		const label = rec.label!(model.entries[0] as unknown as Record<string, unknown>, 0, { root: model, resource: schema });
		expect(label).toBe('#0 · SparkBlast');
	});

	it('falls back gracefully for unnamed or malformed items', () => {
		const rec = schema.registry.TextureNameMapEntry;
		expect(rec.label!({ mGDBTextureName: '' }, 2, { root: model, resource: schema })).toBe('#2 · (unnamed)');
		expect(rec.label!(null as unknown as Record<string, unknown>, 5, { root: model, resource: schema })).toBe('#5');
	});
});

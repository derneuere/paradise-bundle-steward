// Schema coverage tests for propPhysicsResourceSchema.
//
// Coverage fixture: example/PROPPHYSICS.BUNDLE — the one PropPhysics resource
// in the game, which conveniently exercises every record shape (entries with
// parts and without, all three retail volume types, empty volume arrays with
// garbage pointers).
//
// Mirrors staticSoundMap.test.ts: walk the parsed model against the schema
// asserting record references resolve, walkResource visits cleanly, no
// parser/schema field drift in either direction, and representative deep
// paths resolve with the expected field kinds.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parsePropPhysics, type ParsedPropPhysics } from '../../core/propPhysics';

import { propPhysicsResourceSchema } from './propPhysics';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function loadModel(): ParsedPropPhysics {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, 'example/PROPPHYSICS.BUNDLE'));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const res = bundle.resources.find((r) => r.resourceTypeId === 0x1000f);
	if (!res) throw new Error('fixture missing PropPhysics resource');
	return parsePropPhysics(extractResourceRaw(buffer, bundle, res), ctx.littleEndian);
}

const model = loadModel();

describe('propPhysicsResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.propTypes.length).toBe(247);
		expect(model.propTypes.some((t) => t.parts.length > 0)).toBe(true);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(propPhysicsResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!propPhysicsResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(propPhysicsResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(propPhysicsResourceSchema, model, (p, value, _field, rec) => {
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
			throw new Error(`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 20).join('\n  ')}`);
		}
	});

	it('every schema field is represented in the parsed data', () => {
		const missing: string[] = [];
		walkResource(propPhysicsResourceSchema, model, (p, value, _field, rec) => {
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
			throw new Error(`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 20).join('\n  ')}`);
		}
	});
});

describe('propPhysics path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(propPhysicsResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedPropPhysics');
	});

	it('resolves propTypes[6] as a PropPhysicsType', () => {
		const loc = resolveSchemaAtPath(propPhysicsResourceSchema, ['propTypes', 6]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('PropPhysicsType');
	});

	it('resolves propTypes[6].parts[0] as a PropPartType', () => {
		const loc = resolveSchemaAtPath(propPhysicsResourceSchema, ['propTypes', 6, 'parts', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('PropPartType');
	});

	it('resolves propTypes[6].parts[0].volumes[0] as a PropPhysicsVolume', () => {
		const loc = resolveSchemaAtPath(propPhysicsResourceSchema, ['propTypes', 6, 'parts', 0, 'volumes', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('PropPhysicsVolume');
	});

	it('resolves vType as an enum and mu8JointType as an enum', () => {
		const v = resolveSchemaAtPath(propPhysicsResourceSchema, ['propTypes', 0, 'volumes', 0, 'vType']);
		expect(v!.field?.kind).toBe('enum');
		const j = resolveSchemaAtPath(propPhysicsResourceSchema, ['propTypes', 0, 'mu8JointType']);
		expect(j!.field?.kind).toBe('enum');
	});

	it('resolves mResourceId as bigint', () => {
		const loc = resolveSchemaAtPath(propPhysicsResourceSchema, ['propTypes', 0, 'mResourceId']);
		expect(loc!.field?.kind).toBe('bigint');
	});
});

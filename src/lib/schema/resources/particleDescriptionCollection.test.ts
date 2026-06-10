// Schema coverage tests for particleDescriptionCollectionResourceSchema.
//
// Coverage fixture: example/PARTICLES.BUNDLE (the single retail collection,
// 42 descriptions). Mirrors staticSoundMap.test.ts: parse the model and walk
// it against the schema asserting record references resolve, walkResource
// visits cleanly, no parser/schema field drift in either direction, and
// representative deep paths resolve with the expected field kinds.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import {
	parseParticleDescriptionCollection,
	type ParsedParticleDescriptionCollection,
} from '../../core/particleDescriptionCollection';

import { particleDescriptionCollectionResourceSchema } from './particleDescriptionCollection';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/PARTICLES.BUNDLE');
const COLLECTION_TYPE_ID = 0x10008;

function loadModel(fixturePath: string): ParsedParticleDescriptionCollection {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === COLLECTION_TYPE_ID)!;
	return parseParticleDescriptionCollection(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);
const schema = particleDescriptionCollectionResourceSchema;

describe('particleDescriptionCollectionResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.descriptions.length).toBeGreaterThan(0);
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

describe('particleDescriptionCollection path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(schema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedParticleDescriptionCollection');
	});

	it('resolves descriptions[0] as a ParticleDescriptionRef', () => {
		const loc = resolveSchemaAtPath(schema, ['descriptions', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParticleDescriptionRef');
	});

	it('resolves descriptions[0].mDescriptionId as a hex bigint', () => {
		const loc = resolveSchemaAtPath(schema, ['descriptions', 0, 'mDescriptionId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});
});

describe('particleDescriptionCollection tree labels', () => {
	it('labels entries with their description id', () => {
		const rec = schema.registry.ParticleDescriptionRef;
		const label = rec.label!(
			{ mDescriptionId: model.descriptions[0].mDescriptionId } as Record<string, unknown>,
			0,
			{ root: model, resource: schema },
		);
		expect(label).toBe('#0 · 0xEAFED743');
	});

	it('falls back gracefully for malformed items', () => {
		const rec = schema.registry.ParticleDescriptionRef;
		expect(rec.label!(null as unknown as Record<string, unknown>, 3, { root: model, resource: schema })).toBe('#3');
	});
});

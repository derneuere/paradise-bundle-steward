// Schema coverage tests for vfxMeshCollectionResourceSchema.
//
// Coverage fixture: example/PARTICLES.BUNDLE, which carries all THREE retail
// collections. The same schema must cover all of them — they differ only in
// texture-name length (which shifts the variable layout) and buffer contents.
//
// Mirrors staticSoundMap.test.ts: parse each model and walk it against the
// schema asserting record references resolve, walkResource visits cleanly,
// no parser/schema field drift in either direction, and representative deep
// paths resolve with the expected field kinds.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseVFXMeshCollection, type ParsedVFXMeshCollection } from '../../core/vfxMeshCollection';

import { vfxMeshCollectionResourceSchema } from './vfxMeshCollection';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/PARTICLES.BUNDLE');
const VFX_MESH_COLLECTION_TYPE_ID = 0x10019;

function loadAllModels(fixturePath: string): ParsedVFXMeshCollection[] {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	return bundle.resources
		.filter((r) => r.resourceTypeId === VFX_MESH_COLLECTION_TYPE_ID)
		.map((r) => parseVFXMeshCollection(extractResourceRaw(buffer.buffer, bundle, r), ctx.littleEndian));
}

const models = loadAllModels(BUNDLE_FIXTURE);

for (const [label, model] of [
	['highres_debris (resource 0)', models[0]],
	['lowres_debris (resource 1)', models[1]],
	['glass_debris (resource 2)', models[2]],
] as const) {
	describe(`vfxMeshCollectionResourceSchema coverage — ${label}`, () => {
		it('fixture parses with non-trivial content', () => {
			expect(model.mafRadius.length).toBe(32);
			expect(model.indexBuffers.length).toBeGreaterThan(0);
			expect(model.vertexBuffers.length).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(vfxMeshCollectionResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!vfxMeshCollectionResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(vfxMeshCollectionResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(vfxMeshCollectionResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(vfxMeshCollectionResourceSchema, model, (p, value, _field, rec) => {
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
}

describe('vfxMeshCollection path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(vfxMeshCollectionResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedVFXMeshCollection');
	});

	it('resolves indexBuffers[0] as a VFXBufferDescriptor', () => {
		const loc = resolveSchemaAtPath(vfxMeshCollectionResourceSchema, ['indexBuffers', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('VFXBufferDescriptor');
	});

	it('resolves vertexBuffers[0].muByteLength as u32', () => {
		const loc = resolveSchemaAtPath(vfxMeshCollectionResourceSchema, ['vertexBuffers', 0, 'muByteLength']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});

	it('resolves mafRadius[5] as f32', () => {
		const loc = resolveSchemaAtPath(vfxMeshCollectionResourceSchema, ['mafRadius', 5]);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('f32');
	});

	it('resolves textureName as string', () => {
		const loc = resolveSchemaAtPath(vfxMeshCollectionResourceSchema, ['textureName']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
	});
});

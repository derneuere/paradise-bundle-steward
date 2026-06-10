// Schema coverage tests for aptDataResourceSchema.
//
// Coverage fixtures: example/GUIAPT/B5BIKEICONS.BUNDLE (the richest shape —
// a vector mesh with null textureResourceId next to four textured meshes,
// plus the only retail pairing where baseName != movieName) and
// example/GUIAPT/B5ALWAYSAVAILABLECONTAINER.BUNDLE (geometry-less movie).
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
import { parseAptData, type ParsedAptData } from '../../core/aptData';

import { aptDataResourceSchema } from './aptData';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const APT_DATA_TYPE_ID = 0x1e;

function loadModel(bundleFile: string): ParsedAptData {
	const fileBytes = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === APT_DATA_TYPE_ID);
	if (!resource) throw new Error(`${bundleFile}: no 0x1E resource`);
	return parseAptData(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const models: [string, ParsedAptData][] = [
	['B5BIKEICONS (vector + textured meshes)', loadModel('example/GUIAPT/B5BIKEICONS.BUNDLE')],
	['B5ALWAYSAVAILABLECONTAINER (no geometry)', loadModel('example/GUIAPT/B5ALWAYSAVAILABLECONTAINER.BUNDLE')],
];

for (const [label, model] of models) {
	describe(`aptDataResourceSchema coverage — ${label}`, () => {
		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(aptDataResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!aptDataResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(aptDataResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(aptDataResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(aptDataResourceSchema, model, (p, value, _field, rec) => {
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

describe('aptData path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(aptDataResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedAptData');
	});

	it('resolves movieName as a string', () => {
		const loc = resolveSchemaAtPath(aptDataResourceSchema, ['movieName']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
	});

	it('resolves meCurrentState as a read-only enum', () => {
		const loc = resolveSchemaAtPath(aptDataResourceSchema, ['meCurrentState']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
	});

	it('resolves geometryFiles[0] as an AptGuiGeometryFile', () => {
		const loc = resolveSchemaAtPath(aptDataResourceSchema, ['geometryFiles', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('AptGuiGeometryFile');
	});

	it('resolves geometryFiles[0].meshes[0] as an AptGuiMesh', () => {
		const loc = resolveSchemaAtPath(aptDataResourceSchema, ['geometryFiles', 0, 'meshes', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('AptGuiMesh');
	});

	it('resolves the texture import binding as a hex bigint', () => {
		const loc = resolveSchemaAtPath(aptDataResourceSchema, ['geometryFiles', 0, 'meshes', 0, 'textureResourceId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});

	it('resolves vertices[0].mv2Pos as vec2', () => {
		const loc = resolveSchemaAtPath(aptDataResourceSchema, ['geometryFiles', 0, 'meshes', 0, 'vertices', 0, 'mv2Pos']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec2');
	});
});

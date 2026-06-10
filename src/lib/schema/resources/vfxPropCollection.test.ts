// Schema coverage tests for vfxPropCollectionResourceSchema.
//
// Coverage fixture: example/PARTICLES.BUNDLE (the single retail instance).
//
// Mirrors staticSoundMap.test.ts: parse the model and walk it against the
// schema asserting record references resolve, walkResource visits cleanly,
// no parser/schema field drift in either direction, and representative deep
// paths (including the element-index ref fields) resolve with the expected
// field kinds.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseVFXPropCollection, VFX_NULL_INDEX, type ParsedVFXPropCollection } from '../../core/vfxPropCollection';

import { vfxPropCollectionResourceSchema } from './vfxPropCollection';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/PARTICLES.BUNDLE');
const VFX_PROP_COLLECTION_TYPE_ID = 0x1001b;

function loadModel(fixturePath: string): ParsedVFXPropCollection {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === VFX_PROP_COLLECTION_TYPE_ID)!;
	return parseVFXPropCollection(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('vfxPropCollectionResourceSchema coverage', () => {
	it('fixture parses with non-trivial content in every table', () => {
		expect(model.props.length).toBeGreaterThan(0);
		expect(model.propStates.length).toBeGreaterThan(0);
		expect(model.materials.length).toBeGreaterThan(0);
		expect(model.locators.length).toBeGreaterThan(0);
		expect(model.coronas.length).toBeGreaterThan(0);
		expect(model.coronaTypeData.length).toBeGreaterThan(0);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(vfxPropCollectionResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!vfxPropCollectionResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('every ref field targets a list that exists at the resource root', () => {
		const root = model as unknown as Record<string, unknown>;
		for (const rec of Object.values(vfxPropCollectionResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				if (field.kind !== 'ref') continue;
				const [listKey] = field.target.listPath;
				expect(Array.isArray(root[listKey as string]), `${rec.name}.${fieldName} -> ${String(listKey)}`).toBe(true);
			}
		}
	});

	it('every in-range ref value resolves to an element of its target list', () => {
		// The element-index discovery this schema is built on: every non-sentinel
		// run start must land inside its target table.
		for (const p of model.props) expect(p.mpPropStates).toBeLessThan(model.propStates.length);
		for (const s of model.propStates) {
			expect(s.mpVFXMaterial).toBeLessThan(model.materials.length);
			if (s.mpCoronaType !== VFX_NULL_INDEX) expect(s.mpCoronaType).toBeLessThan(model.coronas.length);
		}
		for (const m of model.materials) {
			if (m.mpLocators !== VFX_NULL_INDEX) expect(m.mpLocators).toBeLessThan(model.locators.length);
		}
		for (const c of model.coronas) expect(c.mpTypeData).toBeLessThan(model.coronaTypeData.length);
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(vfxPropCollectionResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(vfxPropCollectionResourceSchema, model, (p, value, _field, rec) => {
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
		walkResource(vfxPropCollectionResourceSchema, model, (p, value, _field, rec) => {
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

describe('vfxPropCollection path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(vfxPropCollectionResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedVFXPropCollection');
	});

	it('resolves props[0] as a VFXProp', () => {
		const loc = resolveSchemaAtPath(vfxPropCollectionResourceSchema, ['props', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('VFXProp');
	});

	it('resolves props[0].mpPropStates as a ref into propStates', () => {
		const loc = resolveSchemaAtPath(vfxPropCollectionResourceSchema, ['props', 0, 'mpPropStates']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('ref');
		if (loc!.field?.kind === 'ref') {
			expect(loc!.field.target.listPath).toEqual(['propStates']);
		}
	});

	it('resolves materials[0].mType as a u32 enum', () => {
		const loc = resolveSchemaAtPath(vfxPropCollectionResourceSchema, ['materials', 0, 'mType']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
		if (loc!.field?.kind === 'enum') {
			expect(loc!.field.values.length).toBe(16);
			expect(loc!.field.values[14].label).toBe('None');
		}
	});

	it('resolves locators[0].mPosition as vec3', () => {
		const loc = resolveSchemaAtPath(vfxPropCollectionResourceSchema, ['locators', 0, 'mPosition']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec3');
	});

	it('resolves coronas[0].mTransform as matrix44', () => {
		const loc = resolveSchemaAtPath(vfxPropCollectionResourceSchema, ['coronas', 0, 'mTransform']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('matrix44');
	});

	it('resolves coronaTypeData[0].mbSynchronised as bool', () => {
		const loc = resolveSchemaAtPath(vfxPropCollectionResourceSchema, ['coronaTypeData', 0, 'mbSynchronised']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bool');
	});
});

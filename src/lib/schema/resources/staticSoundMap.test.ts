// Schema coverage tests for staticSoundMapResourceSchema.
//
// Coverage fixture: example/TRK_UNIT100_GR.BNDL, which carries BOTH map roles
// (TRK_UNIT100_Emitter + TRK_UNIT100_Passby). The same schema must cover both
// because the on-disk shape is identical — only the debug name differs.
//
// Mirrors propInstanceData.test.ts: parse each model and walk it against the
// schema asserting record references resolve, walkResource visits cleanly,
// no parser/schema field drift in either direction, and representative deep
// paths resolve with the expected field kinds.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseStaticSoundMap, type ParsedStaticSoundMap } from '../../core/staticSoundMap';

import { staticSoundMapResourceSchema, typeOrDistanceLabel } from './staticSoundMap';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/TRK_UNIT100_GR.BNDL');
const STATIC_SOUND_MAP_TYPE_ID = 0x10016;

function loadBothModels(fixturePath: string): ParsedStaticSoundMap[] {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	return bundle.resources
		.filter((r) => r.resourceTypeId === STATIC_SOUND_MAP_TYPE_ID)
		.map((r) => parseStaticSoundMap(extractResourceRaw(buffer.buffer, bundle, r), ctx.littleEndian));
}

const models = loadBothModels(BUNDLE_FIXTURE);

for (const [label, model] of [
	['emitter map (resource 0)', models[0]],
	['passby map (resource 1)', models[1]],
] as const) {
	describe(`staticSoundMapResourceSchema coverage — ${label}`, () => {
		it('fixture parses with non-trivial content', () => {
			expect(model.entities.length).toBeGreaterThan(0);
			expect(model.subRegions.length).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(staticSoundMapResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!staticSoundMapResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(staticSoundMapResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(staticSoundMapResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(staticSoundMapResourceSchema, model, (p, value, _field, rec) => {
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

describe('staticSoundMap path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(staticSoundMapResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedStaticSoundMap');
	});

	it('resolves entities[0] as a StaticSoundEntity', () => {
		const loc = resolveSchemaAtPath(staticSoundMapResourceSchema, ['entities', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('StaticSoundEntity');
	});

	it('resolves entities[0].mPosition as vec3', () => {
		const loc = resolveSchemaAtPath(staticSoundMapResourceSchema, ['entities', 0, 'mPosition']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec3');
	});

	it('resolves subRegions[0].mi16First as read-only i16', () => {
		const loc = resolveSchemaAtPath(staticSoundMapResourceSchema, ['subRegions', 0, 'mi16First']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('i16');
	});

	it('resolves mMin as vec2', () => {
		const loc = resolveSchemaAtPath(staticSoundMapResourceSchema, ['mMin']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec2');
	});
});

describe('editability metadata (rebucketing lifted the old restrictions)', () => {
	function listFieldAt(pathSegs: (string | number)[]) {
		const loc = resolveSchemaAtPath(staticSoundMapResourceSchema, pathSegs);
		expect(loc).not.toBeNull();
		const field = loc!.field;
		expect(field?.kind).toBe('list');
		return field as Extract<FieldSchema, { kind: 'list' }>;
	}

	it('entities are addable and removable with a makeEmpty factory', () => {
		const field = listFieldAt(['entities']);
		expect(field.addable).toBe(true);
		expect(field.removable).toBe(true);
		expect(field.makeEmpty).toBeTypeOf('function');
	});

	it('makeEmpty produces a record covering every StaticSoundEntity field', () => {
		const field = listFieldAt(['entities']);
		const fresh = field.makeEmpty!({} as never) as Record<string, unknown>;
		const declared = Object.keys(staticSoundMapResourceSchema.registry.StaticSoundEntity.fields);
		expect(Object.keys(fresh).sort()).toEqual(declared.slice().sort());
		expect(fresh.mPosition).toEqual({ x: 0, y: 0, z: 0 });
	});

	it('the derived subRegions grid stays fixed (recomputed on save, not hand-edited)', () => {
		const field = listFieldAt(['subRegions']);
		expect(field.addable).toBe(false);
		expect(field.removable).toBe(false);
	});

	it('entity positions carry no stale-subregion warning anymore', () => {
		const meta = staticSoundMapResourceSchema.registry.StaticSoundEntity.fieldMetadata?.mPosition;
		expect(meta?.description).toMatch(/rebucket/i);
		expect(meta?.description).not.toMatch(/stale/i);
		expect(meta?.readOnly).toBeFalsy();
	});
});

describe('typeOrDistanceLabel (dual-semantics u16)', () => {
	it('labels values inside the passby enum with both readings', () => {
		// 12 is Collision in a passby map but could be a 12 m radius in an
		// emitter map — the label must not pretend to know the role.
		expect(typeOrDistanceLabel(12)).toBe('Collision / 12 m');
	});

	it('labels values beyond the enum as emitter distances', () => {
		expect(typeOrDistanceLabel(86)).toBe('86 m');
	});
});

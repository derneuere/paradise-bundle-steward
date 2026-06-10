// Schema coverage tests for particleDescriptionResourceSchema.
//
// Coverage fixtures from example/PARTICLES.BUNDLE: the first resource
// (Prop_Foilage — 2 descriptors, no scratch blobs, a genuinely-null
// normal-map pointer), BoostRecharge (scratch blobs + 2-behaviour arrays)
// and NativeFXTextures (the 17-descriptor giant). Together they exercise
// every model shape the parser can produce.
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
import { parseDebugDataFromXml, findDebugResourceById } from '../../core/bundle/debugData';
import {
	parseParticleDescription,
	deriveParticleKey,
	type ParsedParticleDescription,
} from '../../core/particleDescription';

import { particleDescriptionResourceSchema } from './particleDescription';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/PARTICLES.BUNDLE');
const PARTICLE_DESCRIPTION_TYPE_ID = 0x1001d;

function loadModels(): Map<string, ParsedParticleDescription> {
	const fileBytes = fs.readFileSync(BUNDLE_FIXTURE);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const debugResources = typeof bundle.debugData === 'string'
		? parseDebugDataFromXml(bundle.debugData)
		: [];
	const out = new Map<string, ParsedParticleDescription>();
	for (const r of bundle.resources) {
		if (r.resourceTypeId !== PARTICLE_DESCRIPTION_TYPE_ID) continue;
		const name = findDebugResourceById(debugResources, r.resourceId.low.toString(16))?.name ?? '?';
		out.set(name, parseParticleDescription(extractResourceRaw(buffer.buffer, bundle, r), ctx.littleEndian));
	}
	return out;
}

const byName = loadModels();
const pick = (substr: string): ParsedParticleDescription => {
	for (const [name, model] of byName) if (name.includes(substr)) return model;
	throw new Error(`no resource matching ${substr}`);
};

for (const [label, model] of [
	['Prop_Foilage (plain shape)', pick('Prop_Foilage')],
	['BoostRecharge (scratch blobs, 2-behaviour arrays)', pick('BoostRecharge')],
	['NativeFXTextures (17 descriptors)', pick('NativeFXTextures')],
] as const) {
	describe(`particleDescriptionResourceSchema coverage — ${label}`, () => {
		it('fixture parses with non-trivial content', () => {
			expect(model.descriptors.length).toBeGreaterThan(0);
			expect(model.descriptors[0].behaviours.length).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(particleDescriptionResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!particleDescriptionResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(particleDescriptionResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(particleDescriptionResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(particleDescriptionResourceSchema, model, (p, value, _field, rec) => {
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

		it('property groups only reference declared fields', () => {
			for (const rec of Object.values(particleDescriptionResourceSchema.registry)) {
				for (const group of rec.propertyGroups ?? []) {
					if (!('properties' in group)) continue;
					for (const prop of group.properties) {
						expect(rec.fields[prop], `${rec.name} group "${group.title}" → ${prop}`).toBeDefined();
					}
				}
			}
		});
	});
}

describe('particleDescription path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(particleDescriptionResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedParticleDescription');
	});

	it('resolves descriptors[0] as a ParticleDescriptor', () => {
		const loc = resolveSchemaAtPath(particleDescriptionResourceSchema, ['descriptors', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParticleDescriptor');
	});

	it('resolves descriptors[0].mFlags as a flags field', () => {
		const loc = resolveSchemaAtPath(particleDescriptionResourceSchema, ['descriptors', 0, 'mFlags']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('flags');
	});

	it('resolves descriptors[0].behaviours[0].mVelBase as vec4', () => {
		const loc = resolveSchemaAtPath(particleDescriptionResourceSchema, ['descriptors', 0, 'behaviours', 0, 'mVelBase']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec4');
	});

	it('resolves descriptors[0].behaviours[0].mRGBABase as a Colour8 record', () => {
		const loc = resolveSchemaAtPath(particleDescriptionResourceSchema, ['descriptors', 0, 'behaviours', 0, 'mRGBABase']);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('Colour8');
	});

	it('resolves descriptors[0].material.textureName as string', () => {
		const loc = resolveSchemaAtPath(particleDescriptionResourceSchema, ['descriptors', 0, 'material', 'textureName']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
	});
});

describe('particleDescription derive hook (mKey from name)', () => {
	const root = particleDescriptionResourceSchema.registry.ParsedParticleDescription;

	it('re-derives mKey when the name changes', () => {
		const prev = { name: 'Prop_Foilage.lef', mKey: 0x70 };
		const next = { name: 'Boost_New.lef', mKey: 0x70 };
		expect(root.derive!(prev, next)).toEqual({ mKey: 0x62 }); // 'b'
	});

	it('returns an empty patch when the name is untouched', () => {
		const value = { name: 'Prop_Foilage.lef', mKey: 0x70 };
		expect(root.derive!(value, { ...value })).toEqual({});
	});

	it('derivation matches every retail resource', () => {
		for (const model of byName.values()) {
			expect(model.mKey).toBe(deriveParticleKey(model.name));
		}
	});
});

// Schema coverage tests for environmentTimeLineResourceSchema.
//
// Coverage fixture: example/ENVIRONMENTSETTINGS/000_DLC24HR_FOG_A.BUNDLE —
// its single timeline (one location, 11 keyframe entries).
//
// Mirrors staticSoundMap.test.ts: parse the model and walk it against the
// schema asserting record references resolve, walkResource visits cleanly,
// no parser/schema field drift in either direction, and representative deep
// paths resolve with the expected field kinds. Also pins the location-level
// ascending-times validation hook.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseEnvironmentTimeLine, type ParsedEnvironmentTimeLine } from '../../core/environmentSettings';

import { environmentTimeLineResourceSchema } from './environmentTimeLine';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema, SchemaContext } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/ENVIRONMENTSETTINGS/000_DLC24HR_FOG_A.BUNDLE');
const TIME_LINE_TYPE_ID = 0x10013;

function loadModel(fixturePath: string): ParsedEnvironmentTimeLine {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === TIME_LINE_TYPE_ID)!;
	return parseEnvironmentTimeLine(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('environmentTimeLineResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.locations.length).toBe(1);
		expect(model.locations[0].keyframes.length).toBeGreaterThan(0);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(environmentTimeLineResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!environmentTimeLineResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(environmentTimeLineResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(environmentTimeLineResourceSchema, model, (p, value, _field, rec) => {
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
		walkResource(environmentTimeLineResourceSchema, model, (p, value, _field, rec) => {
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

describe('environmentTimeLine path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(environmentTimeLineResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedEnvironmentTimeLine');
	});

	it('resolves locations[0] as an EnvironmentTimeLineLocation', () => {
		const loc = resolveSchemaAtPath(environmentTimeLineResourceSchema, ['locations', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('EnvironmentTimeLineLocation');
	});

	it('resolves locations[0].keyframes[0] as an EnvironmentTimeLineKeyframe', () => {
		const loc = resolveSchemaAtPath(environmentTimeLineResourceSchema, ['locations', 0, 'keyframes', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('EnvironmentTimeLineKeyframe');
	});

	it('resolves locations[0].keyframes[0].mfTimeOfDay as f32', () => {
		const loc = resolveSchemaAtPath(environmentTimeLineResourceSchema, ['locations', 0, 'keyframes', 0, 'mfTimeOfDay']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('f32');
	});

	it('resolves locations[0].keyframes[0].mKeyframeId as a hex bigint', () => {
		const loc = resolveSchemaAtPath(environmentTimeLineResourceSchema, ['locations', 0, 'keyframes', 0, 'mKeyframeId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});
});

describe('environmentTimeLine location validation', () => {
	const locationSchema = environmentTimeLineResourceSchema.registry.EnvironmentTimeLineLocation;
	const ctx: SchemaContext = { root: model, resource: environmentTimeLineResourceSchema };

	it('accepts the retail ascending schedule', () => {
		expect(locationSchema.validate!(model.locations[0] as never, ctx)).toEqual([]);
	});

	it('warns when schedule times do not ascend', () => {
		const broken = {
			keyframes: [
				{ mfTimeOfDay: 14400, mKeyframeId: 1n },
				{ mfTimeOfDay: 0, mKeyframeId: 2n },
			],
		};
		const results = locationSchema.validate!(broken as never, ctx);
		expect(results.length).toBe(1);
		expect(results[0].severity).toBe('warning');
		expect(results[0].message).toMatch(/ascend/);
	});
});

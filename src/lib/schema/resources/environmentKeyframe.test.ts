// Schema coverage tests for environmentKeyframeResourceSchema.
//
// Coverage fixture: example/ENVIRONMENTSETTINGS/000_DLC24HR_FOG_A.BUNDLE —
// the first keyframe in bundle order plus a second one, since all 48 retail
// keyframes share one rigid shape and the schema must drift against none.
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
import { parseEnvironmentKeyframe, type ParsedEnvironmentKeyframe } from '../../core/environmentSettings';

import { environmentKeyframeResourceSchema } from './environmentKeyframe';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/ENVIRONMENTSETTINGS/000_DLC24HR_FOG_A.BUNDLE');
const KEYFRAME_TYPE_ID = 0x10012;

function loadModels(fixturePath: string, count: number): ParsedEnvironmentKeyframe[] {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	return bundle.resources
		.filter((r) => r.resourceTypeId === KEYFRAME_TYPE_ID)
		.slice(0, count)
		.map((r) => parseEnvironmentKeyframe(extractResourceRaw(buffer.buffer, bundle, r), ctx.littleEndian));
}

const models = loadModels(BUNDLE_FIXTURE, 2);

for (const [label, model] of [
	['keyframe (resource 0)', models[0]],
	['keyframe (resource 1)', models[1]],
] as const) {
	describe(`environmentKeyframeResourceSchema coverage — ${label}`, () => {
		it('fixture parses with non-trivial content', () => {
			expect(model.muVersion).toBe(8);
			expect(model.mColourCubeId).not.toBe(0n);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(environmentKeyframeResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!environmentKeyframeResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(environmentKeyframeResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(environmentKeyframeResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(environmentKeyframeResourceSchema, model, (p, value, _field, rec) => {
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

describe('environmentKeyframe path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(environmentKeyframeResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedEnvironmentKeyframe');
	});

	it('resolves mBloomData as an EnvironmentBloomData record', () => {
		const loc = resolveSchemaAtPath(environmentKeyframeResourceSchema, ['mBloomData']);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('EnvironmentBloomData');
	});

	it('resolves mLightingData.mv3KeyLightColour as vec3', () => {
		const loc = resolveSchemaAtPath(environmentKeyframeResourceSchema, ['mLightingData', 'mv3KeyLightColour']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec3');
	});

	it('resolves mVignetteData.mv4InnerColour as vec4', () => {
		const loc = resolveSchemaAtPath(environmentKeyframeResourceSchema, ['mVignetteData', 'mv4InnerColour']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec4');
	});

	it('resolves mCloudsData.mav3LayerLiteColour[1] as vec3', () => {
		const loc = resolveSchemaAtPath(environmentKeyframeResourceSchema, ['mCloudsData', 'mav3LayerLiteColour', 1]);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec3');
	});

	it('resolves mScatteringData.mafScattDist[0] as f32', () => {
		const loc = resolveSchemaAtPath(environmentKeyframeResourceSchema, ['mScatteringData', 'mafScattDist', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('f32');
	});

	it('resolves mColourCubeId as a hex bigint', () => {
		const loc = resolveSchemaAtPath(environmentKeyframeResourceSchema, ['mColourCubeId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});
});

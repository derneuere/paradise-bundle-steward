// Schema coverage tests for genericRwacWaveContentResourceSchema.
//
// Coverage fixtures: two GLOBALWAVES shapes that differ structurally — a
// looped single-chunk wave (BikeToyCarHorn, first in bundle order) and the
// loop-split two-chunk stereo wave (HUD_counter_crit) — plus a one-shot
// (B2FDeLorean_Down) whose model has loopStartSample null.
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
import { parseGenericRwacWaveContent, type ParsedGenericRwacWaveContent } from '../../core/genericRwacWaveContent';

import { genericRwacWaveContentResourceSchema } from './genericRwacWaveContent';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/SOUND/GLOBALWAVES.BUNDLE');
const WAVE_TYPE_ID = 0xa020;

function loadModels(fixturePath: string): ParsedGenericRwacWaveContent[] {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	return bundle.resources
		.filter((r) => r.resourceTypeId === WAVE_TYPE_ID)
		.map((r) => parseGenericRwacWaveContent(extractResourceRaw(buffer.buffer, bundle, r), ctx.littleEndian));
}

const models = loadModels(BUNDLE_FIXTURE);
const looped = models.find((m) => m.loopStartSample === 0 && m.chunks.length === 1)!;
const twoChunk = models.find((m) => m.chunks.length === 2)!;
const oneShot = models.find((m) => m.loopStartSample === null)!;

for (const [label, model] of [
	['looped single-chunk wave', looped],
	['loop-split two-chunk wave', twoChunk],
	['one-shot wave (null loop field)', oneShot],
] as const) {
	describe(`genericRwacWaveContentResourceSchema coverage — ${label}`, () => {
		it('fixture parses with non-trivial content', () => {
			expect(model.chunks.length).toBeGreaterThan(0);
			expect(model.numSamples).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(genericRwacWaveContentResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!genericRwacWaveContentResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(genericRwacWaveContentResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(genericRwacWaveContentResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(genericRwacWaveContentResourceSchema, model, (p, value, _field, rec) => {
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

describe('genericRwacWaveContent path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(genericRwacWaveContentResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedGenericRwacWaveContent');
	});

	it('resolves chunks[0] as a WaveDataChunk', () => {
		const loc = resolveSchemaAtPath(genericRwacWaveContentResourceSchema, ['chunks', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('WaveDataChunk');
	});

	it('resolves chunks[0].samples as read-only u32', () => {
		const loc = resolveSchemaAtPath(genericRwacWaveContentResourceSchema, ['chunks', 0, 'samples']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});

	it('resolves codec as a labeled enum covering all 16 SndPlayer codecs', () => {
		const loc = resolveSchemaAtPath(genericRwacWaveContentResourceSchema, ['codec']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
		const values = (loc!.field as { values: { value: number; label: string }[] }).values;
		expect(values.length).toBe(16);
		expect(values[5].label).toBe('EALayer3 v1');
	});

	it('resolves playType as a labeled enum', () => {
		const loc = resolveSchemaAtPath(genericRwacWaveContentResourceSchema, ['playType']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
		const values = (loc!.field as { values: { value: number; label: string }[] }).values;
		expect(values.map((v) => v.label)).toEqual(['RAM', 'Stream', 'Gigasample']);
	});

	it('caps sampleRate at the 18-bit field width', () => {
		const loc = resolveSchemaAtPath(genericRwacWaveContentResourceSchema, ['sampleRate']);
		expect(loc).not.toBeNull();
		expect(loc!.field).toMatchObject({ kind: 'u32', max: 0x3ffff });
	});
});

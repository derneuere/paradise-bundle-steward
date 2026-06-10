// Schema coverage tests for nicotineResourceSchema.
//
// Coverage fixtures: both retail Nicotine maps (stereo + surround) — the
// same schema must cover both since they share an identical structure.
// Mirrors staticSoundMap.test.ts: parse each model and walk it against the
// schema asserting record references resolve, walkResource visits cleanly,
// no parser/schema field drift in either direction, and representative deep
// paths resolve with the expected field kinds. Null sections (absent state
// sections) are skipped by the walker, so states[0] (no 3D section) and
// states[1] (all six sections) between them exercise every record type.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseNicotine, type ParsedNicotine } from '../../core/nicotine';

import { nicotineResourceSchema, hex8 } from './nicotine';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const NICOTINE_TYPE_ID = 0xa024;

function loadModel(bundleFile: string): ParsedNicotine {
	const fileBytes = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === NICOTINE_TYPE_ID)!;
	return parseNicotine(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

for (const [label, bundleFile] of [
	['stereo map', 'example/SOUND/NICOTINEASSETMAIN.BUNDLE'],
	['surround map', 'example/SOUND/NICOTINEASSETSURROUND.BUNDLE'],
] as const) {
	describe(`nicotineResourceSchema coverage — ${label}`, () => {
		const model = loadModel(bundleFile);

		it('fixture parses with non-trivial content', () => {
			expect(model.states.length).toBeGreaterThan(0);
			expect(model.states[1].threeDControls?.controls.length).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(nicotineResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!nicotineResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(nicotineResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(nicotineResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(nicotineResourceSchema, model, (p, value, _field, rec) => {
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

describe('nicotine path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(nicotineResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedNicotine');
	});

	it('resolves states[0] as a NicotineState', () => {
		const loc = resolveSchemaAtPath(nicotineResourceSchema, ['states', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('NicotineState');
	});

	it('resolves states[0].masterMix.channels[0].mixData as u32', () => {
		const loc = resolveSchemaAtPath(nicotineResourceSchema, ['states', 0, 'masterMix', 'channels', 0, 'mixData']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});

	it('resolves states[1].threeDControls.controls[0].stateParams[0] as Nicotine3DStateParams', () => {
		const loc = resolveSchemaAtPath(nicotineResourceSchema, ['states', 1, 'threeDControls', 'controls', 0, 'stateParams', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('Nicotine3DStateParams');
	});

	it('resolves states[0].presets[0].extraData as a fixed u32 list', () => {
		const loc = resolveSchemaAtPath(nicotineResourceSchema, ['states', 0, 'presets', 0, 'extraData']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('list');
		if (loc!.field?.kind === 'list') {
			expect(loc!.field.item.kind).toBe('u32');
			expect(loc!.field.addable).toBe(false);
		}
	});
});

describe('hex8 label helper', () => {
	it('formats ids as zero-padded uppercase hex', () => {
		expect(hex8(0xc0020003)).toBe('0xC0020003');
		expect(hex8(0xd8f0)).toBe('0x0000D8F0');
	});

	it('never returns NaN-ish text for non-numbers', () => {
		expect(hex8(null)).toBe('?');
		expect(hex8(undefined)).toBe('?');
	});
});

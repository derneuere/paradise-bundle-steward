// Schema coverage tests for splicerResourceSchema.
//
// Coverage fixtures: BIKESOUNDS (smallest retail splicer, mono samples) and
// PRESENTATIONASSET (largest splice count, stereo samples, zero-ref splices
// — including splice 0). The same schema must cover both shapes.
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
import { parseSplicer, type ParsedSplicer } from '../../core/splicer';

import { splicerResourceSchema, sampleLabel } from './splicer';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema, ListFieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SPLICER_TYPE_ID = 0xa025;

function loadModel(bundleFile: string): ParsedSplicer {
	const fileBytes = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === SPLICER_TYPE_ID)!;
	return parseSplicer(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const fixtures = [
	['BikeSounds', loadModel('example/SOUND/SPLICER/BIKESOUNDS.BUNDLE')],
	['PresentationAsset', loadModel('example/SOUND/SPLICER/PRESENTATIONASSET.BUNDLE')],
] as const;

for (const [label, model] of fixtures) {
	describe(`splicerResourceSchema coverage — ${label}`, () => {
		it('fixture parses with non-trivial content', () => {
			expect(model.splices.length).toBeGreaterThan(0);
			expect(model.samples.length).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(splicerResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!splicerResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(splicerResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(splicerResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(splicerResourceSchema, model, (p, value, _field, rec) => {
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

describe('splicer path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(splicerResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedSplicer');
	});

	it('resolves splices[0] as a SpliceData', () => {
		const loc = resolveSchemaAtPath(splicerResourceSchema, ['splices', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('SpliceData');
	});

	it('resolves splices[0].sampleRefs[0] as a SpliceSampleRef', () => {
		const loc = resolveSchemaAtPath(splicerResourceSchema, ['splices', 0, 'sampleRefs', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('SpliceSampleRef');
	});

	it('resolves splices[0].sampleRefs[0].Pitch as f32', () => {
		const loc = resolveSchemaAtPath(splicerResourceSchema, ['splices', 0, 'sampleRefs', 0, 'Pitch']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('f32');
	});

	it('resolves splices[0].SpliceIndex as read-only u16', () => {
		const loc = resolveSchemaAtPath(splicerResourceSchema, ['splices', 0, 'SpliceIndex']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u16');
		const rec = splicerResourceSchema.registry.SpliceData;
		expect(rec.fieldMetadata?.SpliceIndex?.readOnly).toBe(true);
	});

	it('resolves samples[0] as a custom (rawBytes) leaf', () => {
		const loc = resolveSchemaAtPath(splicerResourceSchema, ['samples', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('custom');
	});
});

describe('splicer labels and list affordances', () => {
	const model = fixtures[0][1];

	it('sample labels decode the embedded EA-XAS header', () => {
		// BIKESOUNDS sample 0: 21161 samples @ 48 kHz mono, 5979 bytes.
		expect(sampleLabel(model.samples[0], 0)).toBe('#0 · 0.44 s · mono · 5979 B');
		// Garbage-tolerant: too-short blobs fall back to the byte count.
		expect(sampleLabel(new Uint8Array(4), 3)).toBe('#3 · 4 B');
		expect(sampleLabel(undefined, 5)).toBe('#5');
	});

	it('splice and ref labels survive null-ish values', () => {
		const spliceList = splicerResourceSchema.registry.ParsedSplicer.fields.splices as ListFieldSchema;
		expect(spliceList.itemLabel!(model.splices[0], 0, { root: model, resource: splicerResourceSchema })).toContain('2 refs');
		expect(spliceList.itemLabel!(null, 7, { root: model, resource: splicerResourceSchema })).toBe('#7');
		const refList = splicerResourceSchema.registry.SpliceData.fields.sampleRefs as ListFieldSchema;
		expect(refList.itemLabel!(model.splices[0].sampleRefs[0], 0, { root: model, resource: splicerResourceSchema })).toContain('sample 7');
	});

	it('sampleRefs.makeEmpty produces a record matching the schema exactly (drift guard)', () => {
		const refList = splicerResourceSchema.registry.SpliceData.fields.sampleRefs as ListFieldSchema;
		const empty = refList.makeEmpty!({ root: model, resource: splicerResourceSchema }) as Record<string, unknown>;
		const declared = Object.keys(splicerResourceSchema.registry.SpliceSampleRef.fields).sort();
		expect(Object.keys(empty).sort()).toEqual(declared);
		// Defaults the writer accepts: in-range sample, audible duration.
		expect(empty.SampleIndex).toBe(0);
		expect(empty.Duration).toBe(1);
	});

	it('the samples list is fixed (no add/remove) and splices are remove-only', () => {
		const samplesList = splicerResourceSchema.registry.ParsedSplicer.fields.samples as ListFieldSchema;
		expect(samplesList.addable).toBe(false);
		expect(samplesList.removable).toBe(false);
		const splicesList = splicerResourceSchema.registry.ParsedSplicer.fields.splices as ListFieldSchema;
		expect(splicesList.addable).toBe(false);
		expect(splicesList.removable).toBe(true);
	});
});

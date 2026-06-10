// Schema coverage tests for flaptFileResourceSchema.
//
// Coverage fixture: example/FLAPTHUD.BUNDLE — the single retail FlaptFile
// resource (the in-game HUD).
//
// Mirrors staticSoundMap.test.ts: parse the model and walk it against the
// schema asserting record references resolve, walkResource visits cleanly,
// no parser/schema field drift in either direction, and representative deep
// paths resolve with the expected field kinds.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseFlaptFile, type ParsedFlaptFile } from '../../core/flaptFile';

import { flaptFileResourceSchema } from './flaptFile';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/FLAPTHUD.BUNDLE');
const FLAPT_TYPE_ID = 0x10020;

function loadModel(fixturePath: string): ParsedFlaptFile {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const res = bundle.resources.find((r) => r.resourceTypeId === FLAPT_TYPE_ID);
	if (!res) throw new Error('no 0x10020 resource in fixture');
	return parseFlaptFile(extractResourceRaw(buffer.buffer, bundle, res), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('flaptFileResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.movieClips.length).toBeGreaterThan(0);
		expect(model.textures.length).toBeGreaterThan(0);
		expect(model.strings.length).toBeGreaterThan(0);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(flaptFileResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!flaptFileResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(flaptFileResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(flaptFileResourceSchema, model, (p, value, _field, rec) => {
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
		walkResource(flaptFileResourceSchema, model, (p, value, _field, rec) => {
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

	it('tree labels never throw on real or degenerate items', () => {
		const reg = flaptFileResourceSchema.registry;
		const ctx = { root: model, resource: flaptFileResourceSchema };
		const rec = (v: unknown) => v as Record<string, unknown>;
		expect(reg.FlaptMovieClip.label?.(rec(model.movieClips[2]), 2, ctx)).toContain('B5FriendListChangeIconComponent');
		expect(reg.FlaptTexture.label?.(rec(model.textures[52]), 52, ctx)).toContain('special');
		expect(reg.FlaptTexture.label?.(rec(model.textures[0]), 0, ctx)).toContain('0xF2247A5A');
		expect(reg.FlaptFontStyle.label?.(rec(model.fontStyles[0]), 0, ctx)).toContain('B5EAConDisSDrop');
		for (const r of Object.values(reg)) {
			expect(r.label?.(rec(null), 3, ctx) ?? '#3').toBe('#3');
			expect(r.label?.(rec(undefined), 3, ctx) ?? '#3').toBe('#3');
		}
	});
});

describe('flaptFile path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(flaptFileResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedFlaptFile');
	});

	it('resolves movieClips[0] as a FlaptMovieClip', () => {
		const loc = resolveSchemaAtPath(flaptFileResourceSchema, ['movieClips', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('FlaptMovieClip');
	});

	it('resolves vertices[0].mv2Pos as vec2', () => {
		const loc = resolveSchemaAtPath(flaptFileResourceSchema, ['vertices', 0, 'mv2Pos']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec2');
	});

	it('resolves textures[0].resourceId as bigint', () => {
		const loc = resolveSchemaAtPath(flaptFileResourceSchema, ['textures', 0, 'resourceId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});

	it('resolves fontStyles[0].mfFontHeight as f32', () => {
		const loc = resolveSchemaAtPath(flaptFileResourceSchema, ['fontStyles', 0, 'mfFontHeight']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('f32');
	});

	it('resolves strings[0] as string', () => {
		const loc = resolveSchemaAtPath(flaptFileResourceSchema, ['strings', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
	});

	it('resolves mfTimePerFrame as editable f32 (the one editable header scalar)', () => {
		const loc = resolveSchemaAtPath(flaptFileResourceSchema, ['mfTimePerFrame']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('f32');
	});
});

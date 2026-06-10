// Schema coverage tests for fontResourceSchema.
//
// Coverage fixtures: CHINESE_SIMPLIFIED.FONT (single page, largest glyph
// table) and CHINESE_SIMPLIFIED_LIMITED.FONT (the 2-page shape whose second
// page imports an external Texture and carries a garbage pointer slot). The
// same schema must cover both — only the page count differs.
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
import { parseFont, FONT_TYPE_ID, type ParsedFont } from '../../core/font';

import { fontResourceSchema, charIdLabel } from './font';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function loadModel(fontFile: string): ParsedFont {
	const fileBytes = fs.readFileSync(path.resolve(REPO_ROOT, 'example/FONTS', fontFile));
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const res = bundle.resources.find((r) => r.resourceTypeId === FONT_TYPE_ID);
	if (!res) throw new Error(`${fontFile}: no Font resource`);
	return parseFont(extractResourceRaw(buffer.buffer, bundle, res), ctx.littleEndian);
}

for (const [label, file] of [
	['single-page font', 'CHINESE_SIMPLIFIED.FONT'],
	['2-page font', 'CHINESE_SIMPLIFIED_LIMITED.FONT'],
] as const) {
	describe(`fontResourceSchema coverage — ${label}`, () => {
		const model = loadModel(file);

		it('fixture parses with non-trivial content', () => {
			expect(model.chars.length).toBeGreaterThan(0);
			expect(model.texturePages.length).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(fontResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!fontResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('ref fields target lists that exist on the parsed model', () => {
			for (const rec of Object.values(fontResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					if (field.kind !== 'ref') continue;
					let target: unknown = model;
					for (const seg of field.target.listPath) {
						target = (target as Record<string | number, unknown>)[seg];
					}
					expect(Array.isArray(target), `${rec.name}.${fieldName} target`).toBe(true);
					expect(fontResourceSchema.registry[field.target.itemType], `${rec.name}.${fieldName} itemType`).toBeDefined();
				}
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(fontResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(fontResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(fontResourceSchema, model, (p, value, _field, rec) => {
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

describe('font path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(fontResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedFont');
	});

	it('resolves chars[0] as a FontChar', () => {
		const loc = resolveSchemaAtPath(fontResourceSchema, ['chars', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('FontChar');
	});

	it('resolves chars[0].mTopLeftUV as vec2', () => {
		const loc = resolveSchemaAtPath(fontResourceSchema, ['chars', 0, 'mTopLeftUV']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec2');
	});

	it('resolves chars[0].mu16TexturePageId as a ref into texturePages', () => {
		const loc = resolveSchemaAtPath(fontResourceSchema, ['chars', 0, 'mu16TexturePageId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('ref');
		if (loc!.field?.kind === 'ref') {
			expect(loc!.field.target.listPath).toEqual(['texturePages']);
		}
	});

	it('resolves texturePages[0] as a FontTexturePage with a hex bigint id', () => {
		const loc = resolveSchemaAtPath(fontResourceSchema, ['texturePages', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('FontTexturePage');
		const idLoc = resolveSchemaAtPath(fontResourceSchema, ['texturePages', 0, 'textureId']);
		expect(idLoc!.field?.kind).toBe('bigint');
	});

	it('resolves macTypefaceFamilyName as string', () => {
		const loc = resolveSchemaAtPath(fontResourceSchema, ['macTypefaceFamilyName']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
	});
});

describe('charIdLabel', () => {
	it('shows the actual character where printable', () => {
		expect(charIdLabel(0x4e00)).toBe("'一' U+4E00");
		expect(charIdLabel(0x41)).toBe("'A' U+0041");
		expect(charIdLabel(0x0e01)).toBe("'ก' U+0E01");
	});

	it('falls back to codepoint-only for spaces, controls, and the Latin-1 gap', () => {
		expect(charIdLabel(0x20)).toBe('U+0020');
		expect(charIdLabel(0xa0)).toBe('U+00A0');
		expect(charIdLabel(0x3000)).toBe('U+3000');
		expect(charIdLabel(0x7f)).toBe('U+007F');
	});
});

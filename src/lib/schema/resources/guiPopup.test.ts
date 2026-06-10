// Schema coverage tests for guiPopupResourceSchema.
//
// Coverage fixture: example/POPUPS.PUP — the game-wide popup catalogue
// (111 popups, every field shape the parser produces).
//
// Mirrors staticSoundMap.test.ts: parse the model and walk it against the
// schema asserting record references resolve, walkResource visits cleanly,
// no parser/schema field drift in either direction, and representative deep
// paths resolve with the expected field kinds. Adds coverage for this
// schema's derive hook (mNameId from macName, miMessageParamsUsed from
// maeMessageParams) and the char-buffer length validation.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseGuiPopup, type ParsedGuiPopup } from '../../core/guiPopup';
import { encodeCgsId } from '../../core/cgsid';

import { guiPopupResourceSchema } from './guiPopup';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema, SchemaContext } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/POPUPS.PUP');
const GUI_POPUP_TYPE_ID = 0x1f;

function loadModel(fixturePath: string): ParsedGuiPopup {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === GUI_POPUP_TYPE_ID);
	if (!resource) throw new Error('fixture has no GuiPopup resource');
	return parseGuiPopup(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('guiPopupResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.popups.length).toBeGreaterThan(0);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(guiPopupResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!guiPopupResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(guiPopupResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(guiPopupResourceSchema, model, (p, value, _field, rec) => {
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
		walkResource(guiPopupResourceSchema, model, (p, value, _field, rec) => {
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

describe('guiPopup path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(guiPopupResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedGuiPopup');
	});

	it('resolves popups[0] as a GuiPopup', () => {
		const loc = resolveSchemaAtPath(guiPopupResourceSchema, ['popups', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('GuiPopup');
	});

	it('resolves popups[0].meStyle as a u32-backed enum', () => {
		const loc = resolveSchemaAtPath(guiPopupResourceSchema, ['popups', 0, 'meStyle']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
	});

	it('resolves popups[0].mNameId as a hex bigint', () => {
		const loc = resolveSchemaAtPath(guiPopupResourceSchema, ['popups', 0, 'mNameId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});

	it('resolves popups[0].maeMessageParams as a fixed list of enums', () => {
		const loc = resolveSchemaAtPath(guiPopupResourceSchema, ['popups', 0, 'maeMessageParams']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('list');
	});
});

describe('guiPopup derive hook', () => {
	const rec = guiPopupResourceSchema.registry.GuiPopup;
	const base = model.popups[0] as unknown as Record<string, unknown>;

	it('re-derives mNameId when macName changes', () => {
		const next = { ...base, macName: 'Renamed' };
		const patch = rec.derive!(base, next);
		expect(patch.mNameId).toBe(encodeCgsId('RENAMED'));
	});

	it('re-derives miMessageParamsUsed when params change', () => {
		// popups[0] is the (1,0)/used=1 shape; switching slot 2 on makes it 2.
		const next = { ...base, maeMessageParams: [1, 2] };
		const patch = rec.derive!(base, next);
		expect(patch.miMessageParamsUsed).toBe(2);
	});

	it('returns an empty patch when nothing derived changed', () => {
		expect(rec.derive!(base, { ...base })).toEqual({});
	});

	it('skips the name id while the name is too long to encode', () => {
		const next = { ...base, macName: 'WayTooLongPopupName' };
		const patch = rec.derive!(base, next);
		expect('mNameId' in patch).toBe(false);
	});
});

describe('guiPopup validation', () => {
	const rec = guiPopupResourceSchema.registry.GuiPopup;
	const ctx: SchemaContext = { root: model, resource: guiPopupResourceSchema };
	const base = model.popups[0] as unknown as Record<string, unknown>;

	it('accepts every retail popup', () => {
		for (const p of model.popups) {
			expect(rec.validate!(p as unknown as Record<string, unknown>, ctx)).toEqual([]);
		}
	});

	it('errors on a name that cannot fit char[13]', () => {
		const results = rec.validate!({ ...base, macName: 'ThirteenChars' }, ctx);
		expect(results.some((r) => r.severity === 'error' && r.field === 'macName')).toBe(true);
	});

	it('errors on a Language key that cannot fit char[32]', () => {
		const results = rec.validate!({ ...base, macMessageId: 'X'.repeat(32) }, ctx);
		expect(results.some((r) => r.severity === 'error' && r.field === 'macMessageId')).toBe(true);
	});

	it('warns on characters the CgsID encoding cannot round-trip', () => {
		const results = rec.validate!({ ...base, macName: 'Bad.Name' }, ctx);
		expect(results.some((r) => r.severity === 'warning' && r.field === 'macName')).toBe(true);
	});
});

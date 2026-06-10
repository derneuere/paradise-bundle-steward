// Schema coverage tests for hudMessageResourceSchema.
//
// Coverage fixture: example/HUDMESSAGES.HM — the only retail HudMessage
// resource (308 messages).
//
// Mirrors staticSoundMap.test.ts: parse the model and walk it against the
// schema asserting record references resolve, walkResource visits cleanly,
// no parser/schema field drift in either direction, and representative deep
// paths resolve with the expected field kinds. Also pins the derive hook
// that keeps mMessageIdHash in sync with macMessageId.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseHudMessage, type ParsedHudMessage } from '../../core/hudMessage';
import { encodeCgsId } from '../../core/cgsid';

import { hudMessageResourceSchema, paramTypeName } from './hudMessage';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/HUDMESSAGES.HM');
const HUD_MESSAGE_TYPE_ID = 0x2c;

function loadModel(fixturePath: string): ParsedHudMessage {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === HUD_MESSAGE_TYPE_ID)!;
	return parseHudMessage(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('hudMessageResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.messages.length).toBeGreaterThan(0);
		expect(model.messages[0].lines.length).toBe(3);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(hudMessageResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!hudMessageResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(hudMessageResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(hudMessageResourceSchema, model, (p, value, _field, rec) => {
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
		walkResource(hudMessageResourceSchema, model, (p, value, _field, rec) => {
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

describe('hudMessage path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(hudMessageResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedHudMessage');
	});

	it('resolves messages[0] as a HudMessage', () => {
		const loc = resolveSchemaAtPath(hudMessageResourceSchema, ['messages', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('HudMessage');
	});

	it('resolves messages[0].lines[0] as a HudMessageLine', () => {
		const loc = resolveSchemaAtPath(hudMessageResourceSchema, ['messages', 0, 'lines', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('HudMessageLine');
	});

	it('resolves muAvailabilityBitSet as flags and meMessageGroup as enum', () => {
		const flags = resolveSchemaAtPath(hudMessageResourceSchema, ['messages', 0, 'muAvailabilityBitSet']);
		expect(flags!.field?.kind).toBe('flags');
		const group = resolveSchemaAtPath(hudMessageResourceSchema, ['messages', 0, 'meMessageGroup']);
		expect(group!.field?.kind).toBe('enum');
	});

	it('resolves mMessageIdHash as a hex bigint', () => {
		const loc = resolveSchemaAtPath(hudMessageResourceSchema, ['messages', 0, 'mMessageIdHash']);
		expect(loc!.field?.kind).toBe('bigint');
	});
});

describe('hudMessage derive + labels', () => {
	it('derive recomputes the CgsID when the message id changes', () => {
		const rec = hudMessageResourceSchema.registry.HudMessage;
		const prev = model.messages[0] as unknown as Record<string, unknown>;
		const next = { ...prev, macMessageId: 'StewardTest' };
		const patch = rec.derive!(prev, next);
		expect(patch.mMessageIdHash).toBe(encodeCgsId('STEWARDTEST'));
	});

	it('derive leaves the hash alone when the id is untouched', () => {
		const rec = hudMessageResourceSchema.registry.HudMessage;
		const prev = model.messages[0] as unknown as Record<string, unknown>;
		const next = { ...prev, mfDuration: 5 };
		expect(rec.derive!(prev, next)).toEqual({});
	});

	it('message labels surface the id and first line', () => {
		const rec = hudMessageResourceSchema.registry.HudMessage;
		const ctx = { root: model, resource: hudMessageResourceSchema };
		const label = rec.label!(model.messages[0] as unknown as Record<string, unknown>, 0, ctx);
		expect(label).toContain('AggDrBstStrt');
		expect(label).toContain('HUDMESSAGE_ONLINE_BOOST_STARTS');
	});

	it('line labels distinguish used and unused lanes', () => {
		const rec = hudMessageResourceSchema.registry.HudMessageLine;
		const ctx = { root: model, resource: hudMessageResourceSchema };
		const used = rec.label!(model.messages[0].lines[0] as unknown as Record<string, unknown>, 0, ctx);
		expect(used).toContain('HUDMESSAGE_ONLINE_BOOST_STARTS');
		const unused = rec.label!(model.messages[0].lines[2] as unknown as Record<string, unknown>, 2, ctx);
		expect(unused).toContain('(unused)');
	});

	it('paramTypeName names the retail param types', () => {
		expect(paramTypeName(1)).toBe('String');
		expect(paramTypeName(6)).toBe('StringId');
		expect(paramTypeName(99)).toBe('?99');
	});

	it('line validation flags count/type drift the game would ignore', () => {
		const rec = hudMessageResourceSchema.registry.HudMessageLine;
		const ctx = { root: model, resource: hudMessageResourceSchema };
		// Param beyond the declared count.
		const drifted = { macStringId: 'X', miParamCount: 0, maeParamTypes: [1, 0, 0, 0] };
		expect(rec.validate!(drifted, ctx).length).toBeGreaterThan(0);
		// Retail line passes clean.
		const retail = model.messages[0].lines[0] as unknown as Record<string, unknown>;
		expect(rec.validate!(retail, ctx)).toEqual([]);
	});
});

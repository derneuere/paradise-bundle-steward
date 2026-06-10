// Schema coverage tests for snapshotDataResourceSchema.
//
// Coverage fixture: example/SOUND/NICOTINEASSETMAIN.BUNDLE (the surround
// SnapshotData is byte-identical, so one fixture covers both). Mirrors
// staticSoundMap.test.ts: parse the model and walk it against the schema
// asserting record references resolve, walkResource visits cleanly, no
// parser/schema field drift in either direction, and representative deep
// paths resolve with the expected field kinds.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseSnapshotData, type ParsedSnapshotData } from '../../core/snapshotData';

import { snapshotDataResourceSchema } from './snapshotData';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/SOUND/NICOTINEASSETMAIN.BUNDLE');
const SNAPSHOT_TYPE_ID = 0xa029;

function loadModel(fixturePath: string): ParsedSnapshotData {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === SNAPSHOT_TYPE_ID)!;
	return parseSnapshotData(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('snapshotDataResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.channels.length).toBeGreaterThan(0);
		expect(model.snapshots.length).toBeGreaterThan(0);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(snapshotDataResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!snapshotDataResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(snapshotDataResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(snapshotDataResourceSchema, model, (p, value, _field, rec) => {
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
		walkResource(snapshotDataResourceSchema, model, (p, value, _field, rec) => {
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

describe('snapshotData path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(snapshotDataResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedSnapshotData');
	});

	it('resolves channels[0] as a read-only-keyed SnapshotChannel', () => {
		const loc = resolveSchemaAtPath(snapshotDataResourceSchema, ['channels', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('SnapshotChannel');
		expect(loc!.record?.fieldMetadata?.mixChId?.readOnly).toBe(true);
	});

	it('resolves snapshots[0].entries[0].value as f32', () => {
		const loc = resolveSchemaAtPath(snapshotDataResourceSchema, ['snapshots', 0, 'entries', 0, 'value']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('f32');
	});

	it('resolves snapshots[0].entries[0].control as u32', () => {
		const loc = resolveSchemaAtPath(snapshotDataResourceSchema, ['snapshots', 0, 'entries', 0, 'control']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});

	it('channel and snapshot lists are locked (cross-indexed on disk)', () => {
		for (const fieldPath of [['channels'], ['snapshots']] as const) {
			const loc = resolveSchemaAtPath(snapshotDataResourceSchema, [...fieldPath]);
			expect(loc).not.toBeNull();
			if (loc!.field?.kind === 'list') {
				expect(loc!.field.addable, fieldPath.join('.')).toBe(false);
				expect(loc!.field.removable, fieldPath.join('.')).toBe(false);
			} else {
				throw new Error(`${fieldPath.join('.')} is not a list`);
			}
		}
	});
});

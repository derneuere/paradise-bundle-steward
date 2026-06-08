// Schema coverage tests for instanceListResourceSchema.
//
// Two coverage fixtures — both real track-unit bundles, from which we extract
// the embedded InstanceList resource (type 0x23):
//   - example/TRK_UNIT9_GR.BNDL
//   - example/TRK_UNIT10_GR.BNDL
//
// Mirrors propInstanceData.test.ts: parse each model and walk it against the
// schema asserting that
//   - every record reference resolves to a registered type
//   - walkResource visits every parsed field without throwing
//   - no parsed field is undeclared in the schema, and no schema field is
//     missing from the parsed data (parser/schema drift detector)
//   - representative deep paths resolve with the expected field kinds
//   - tree-label callbacks return sensible strings on real fixture data

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import {
	parseInstanceList,
	type ParsedInstanceList,
} from '../../core/instanceList';

import { instanceListResourceSchema } from './instanceList';
import {
	getAtPath,
	resolveSchemaAtPath,
	walkResource,
	formatPath,
} from '../walk';
import type { FieldSchema } from '../types';

// ---------------------------------------------------------------------------
// Fixture loaders
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_9 = path.resolve(REPO_ROOT, 'example/TRK_UNIT9_GR.BNDL');
const BUNDLE_10 = path.resolve(REPO_ROOT, 'example/TRK_UNIT10_GR.BNDL');
const INSTANCE_LIST_TYPE_ID = 0x23;

function readBytes(fixturePath: string): Uint8Array {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	return buffer;
}

// The bundle fixture embeds the resource — extract it, then parse.
function loadBundleModel(fixturePath: string): ParsedInstanceList {
	const buffer = readBytes(fixturePath);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === INSTANCE_LIST_TYPE_ID);
	if (!resource) throw new Error(`${fixturePath} missing InstanceList resource`);
	const raw = extractResourceRaw(buffer.buffer, bundle, resource);
	return parseInstanceList(raw, ctx.littleEndian);
}

const trk9Model = loadBundleModel(BUNDLE_9);
const trk10Model = loadBundleModel(BUNDLE_10);

// Run the same coverage checks against each fixture.
for (const [label, model] of [
	['bundle TRK_UNIT9_GR.BNDL', trk9Model],
	['bundle TRK_UNIT10_GR.BNDL', trk10Model],
] as const) {
	describe(`instanceListResourceSchema coverage — ${label}`, () => {
		it('fixture parses with non-trivial content', () => {
			expect(model.instances.length).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(instanceListResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!instanceListResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(instanceListResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(instanceListResourceSchema, model, (p, value, _field, rec) => {
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
				throw new Error(
					`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${
						missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''
					}`,
				);
			}
		});

		it('every schema field is represented in the parsed data', () => {
			const missing: string[] = [];
			walkResource(instanceListResourceSchema, model, (p, value, _field, rec) => {
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
				throw new Error(
					`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${
						missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''
					}`,
				);
			}
		});
	});
}

// ---------------------------------------------------------------------------
// Path resolution + field kinds (single fixture is enough)
// ---------------------------------------------------------------------------

describe('instanceList path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(instanceListResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedInstanceList');
	});

	it('resolves instances[0] as an InstanceListEntry', () => {
		const loc = resolveSchemaAtPath(instanceListResourceSchema, ['instances', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('InstanceListEntry');
	});

	it('resolves instances[0].mWorldTransform as matrix44', () => {
		const loc = resolveSchemaAtPath(instanceListResourceSchema, ['instances', 0, 'mWorldTransform']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('matrix44');
	});

	it('resolves instances[0].mpModel as u32', () => {
		const loc = resolveSchemaAtPath(instanceListResourceSchema, ['instances', 0, 'mpModel']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});

	it('resolves instances[0].mi16BackdropZoneID as i16', () => {
		const loc = resolveSchemaAtPath(instanceListResourceSchema, ['instances', 0, 'mi16BackdropZoneID']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('i16');
	});

	it('resolves instances[0].mfMaxVisibleDistanceSquared as f32', () => {
		const loc = resolveSchemaAtPath(instanceListResourceSchema, ['instances', 0, 'mfMaxVisibleDistanceSquared']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('f32');
	});

	it('resolves instances[0]._pad into the InstanceListPad record', () => {
		const loc = resolveSchemaAtPath(instanceListResourceSchema, ['instances', 0, '_pad']);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('InstanceListPad');
	});

	it('resolves muNumInstances as u32', () => {
		const loc = resolveSchemaAtPath(instanceListResourceSchema, ['muNumInstances']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});
});

// ---------------------------------------------------------------------------
// Tree labels
// ---------------------------------------------------------------------------

describe('instanceList tree labels', () => {
	it('instance label includes the index and (x, z) world position', () => {
		// instances[0] in TRK_UNIT9 sits at world (-567, -2779), not a backdrop.
		const inst = trk9Model.instances[0];
		const field = instanceListResourceSchema.registry.ParsedInstanceList.fields.instances;
		if (field.kind !== 'list') throw new Error('expected list');
		const labelFn = field.itemLabel as (v: unknown, i: number) => string;
		const label = labelFn(inst, 0);
		expect(label).toBe('#0 · (-567, -2779)');
		expect(label).not.toContain('backdrop');
	});

	it('instance label tags backdrop entries with their zone id', () => {
		// instances[41] in TRK_UNIT9 is a backdrop piece in zone 334 at (-1633, -3785).
		const inst = trk9Model.instances[41];
		const field = instanceListResourceSchema.registry.ParsedInstanceList.fields.instances;
		if (field.kind !== 'list') throw new Error('expected list');
		const labelFn = field.itemLabel as (v: unknown, i: number) => string;
		const label = labelFn(inst, 41);
		expect(label).toBe('#41 · (-1633, -3785) · backdrop 334');
	});

	it('InstanceListEntry.label callback returns a non-empty string', () => {
		const ctx = { root: trk9Model, resource: instanceListResourceSchema };
		const instLabel = instanceListResourceSchema.registry.InstanceListEntry.label!(
			trk9Model.instances[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(typeof instLabel).toBe('string');
		expect(instLabel.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Sanity: representative reads via getAtPath
// ---------------------------------------------------------------------------

describe('instanceList getAtPath', () => {
	it('reads an instance world position component as a number', () => {
		const x = getAtPath(trk9Model, ['instances', 0, 'mWorldTransform', 12]);
		expect(typeof x).toBe('number');
		expect(Number.isFinite(x)).toBe(true);
	});

	it('reads instances[0].mpModel as a number (0 on disk)', () => {
		const mpModel = getAtPath(trk9Model, ['instances', 0, 'mpModel']);
		expect(mpModel).toBe(0);
	});

	it('reads a nested pad slot as a number', () => {
		const pad = getAtPath(trk9Model, ['instances', 0, '_pad', 'mu16Pad']);
		expect(typeof pad).toBe('number');
	});
});

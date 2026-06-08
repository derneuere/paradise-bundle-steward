// Schema coverage tests for propInstanceDataResourceSchema.
//
// Two coverage fixtures:
//   - example/BE_9F_C7_93.dat — a RAW extracted PropInstanceData resource (TRK
//     206, 27680 bytes), parsed directly from bytes (it is NOT a bundle).
//   - example/TRK_UNIT9_GR.BNDL — a real bundle; we extract the embedded
//     PropInstanceData resource for a second, independently-shaped fixture.
//
// Mirrors zoneList.test.ts: parse each model and walk it against the schema
// asserting that
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
	parsePropInstanceData,
	type ParsedPropInstanceData,
} from '../../core/propInstanceData';
import { PROP_ALT_TYPE_NONE } from '../../core/propTypes';

import { propInstanceDataResourceSchema } from './propInstanceData';
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
const GOLD_RAW = path.resolve(REPO_ROOT, 'example/BE_9F_C7_93.dat');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/TRK_UNIT9_GR.BNDL');
const PROP_INSTANCE_TYPE_ID = 0x10011;

function readBytes(fixturePath: string): Uint8Array {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	return buffer;
}

// The gold file is a raw extracted resource — parse its bytes directly.
function loadRawModel(fixturePath: string): ParsedPropInstanceData {
	return parsePropInstanceData(readBytes(fixturePath));
}

// The bundle fixture embeds the resource — extract it, then parse.
function loadBundleModel(fixturePath: string): ParsedPropInstanceData {
	const buffer = readBytes(fixturePath);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === PROP_INSTANCE_TYPE_ID);
	if (!resource) throw new Error(`${fixturePath} missing PropInstanceData resource`);
	const raw = extractResourceRaw(buffer.buffer, bundle, resource);
	return parsePropInstanceData(raw, ctx.littleEndian);
}

const goldModel = loadRawModel(GOLD_RAW);
const bundleModel = loadBundleModel(BUNDLE_FIXTURE);

// Run the same coverage checks against each fixture.
for (const [label, model] of [
	['raw gold BE_9F_C7_93.dat', goldModel],
	['bundle TRK_UNIT9_GR.BNDL', bundleModel],
] as const) {
	describe(`propInstanceDataResourceSchema coverage — ${label}`, () => {
		it('fixture parses with non-trivial content', () => {
			expect(model.instances.length).toBeGreaterThan(0);
			expect(model.cells.length).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(propInstanceDataResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!propInstanceDataResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(propInstanceDataResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(propInstanceDataResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(propInstanceDataResourceSchema, model, (p, value, _field, rec) => {
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

describe('propInstanceData path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(propInstanceDataResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedPropInstanceData');
	});

	it('resolves instances[0] as a PropInstance', () => {
		const loc = resolveSchemaAtPath(propInstanceDataResourceSchema, ['instances', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('PropInstance');
	});

	it('resolves instances[0].mWorldTransform as matrix44', () => {
		const loc = resolveSchemaAtPath(propInstanceDataResourceSchema, ['instances', 0, 'mWorldTransform']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('matrix44');
	});

	it('resolves instances[0].typeId as enum', () => {
		const loc = resolveSchemaAtPath(propInstanceDataResourceSchema, ['instances', 0, 'typeId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
	});

	it('resolves instances[0].flags as flags', () => {
		const loc = resolveSchemaAtPath(propInstanceDataResourceSchema, ['instances', 0, 'flags']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('flags');
	});

	it('resolves instances[0].muAlternativeType as enum (with a (none) sentinel)', () => {
		const loc = resolveSchemaAtPath(propInstanceDataResourceSchema, ['instances', 0, 'muAlternativeType']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
		if (loc!.field?.kind !== 'enum') throw new Error('expected enum');
		const noneEntry = loc!.field.values.find((v) => v.value === PROP_ALT_TYPE_NONE);
		expect(noneEntry?.label).toBe('(none)');
	});

	it('resolves cells[0] as a PropCell', () => {
		const loc = resolveSchemaAtPath(propInstanceDataResourceSchema, ['cells', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('PropCell');
	});

	it('resolves cells[0].muX as u16', () => {
		const loc = resolveSchemaAtPath(propInstanceDataResourceSchema, ['cells', 0, 'muX']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u16');
	});
});

// ---------------------------------------------------------------------------
// Tree labels
// ---------------------------------------------------------------------------

describe('propInstanceData tree labels', () => {
	it('instance label includes the prop name, instance id, and (x, z)', () => {
		// instances[10] in the gold file is billboard_overdrive_YELLOW, id 473825.
		const inst = goldModel.instances[10];
		const field = propInstanceDataResourceSchema.registry.ParsedPropInstanceData.fields.instances;
		if (field.kind !== 'list') throw new Error('expected list');
		const labelFn = field.itemLabel as (v: unknown, i: number) => string;
		const label = labelFn(inst, 10);
		expect(label).toContain('#10');
		expect(label).toContain('billboard_overdrive_YELLOW');
		expect(label).toContain('id 473825');
		expect(label).toMatch(/\(-?\d+, -?\d+\)/);
	});

	it('cell label includes grid coords, the index range, and R/D counts', () => {
		// cells[2] in the gold file: X=70 Z=37 start=10 count=51 R=1 D=4.
		const cell = goldModel.cells[2];
		const field = propInstanceDataResourceSchema.registry.ParsedPropInstanceData.fields.cells;
		if (field.kind !== 'list') throw new Error('expected list');
		const labelFn = field.itemLabel as (v: unknown, i: number) => string;
		const label = labelFn(cell, 2);
		expect(label).toBe('(X=70, Z=37) · #10..#61 · R1/D4');
	});

	it('PropInstance.label and PropCell.label callbacks return strings', () => {
		const ctx = { root: goldModel, resource: propInstanceDataResourceSchema };
		const instLabel = propInstanceDataResourceSchema.registry.PropInstance.label!(
			goldModel.instances[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		const cellLbl = propInstanceDataResourceSchema.registry.PropCell.label!(
			goldModel.cells[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(typeof instLabel).toBe('string');
		expect(instLabel.length).toBeGreaterThan(0);
		expect(typeof cellLbl).toBe('string');
		expect(cellLbl.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Sanity: representative reads via getAtPath
// ---------------------------------------------------------------------------

describe('propInstanceData getAtPath', () => {
	it('reads an instance world position component as a number', () => {
		const x = getAtPath(goldModel, ['instances', 0, 'mWorldTransform', 12]);
		expect(typeof x).toBe('number');
		expect(Number.isFinite(x)).toBe(true);
	});

	it('reads a cell grid coord as a number', () => {
		const muX = getAtPath(goldModel, ['cells', 0, 'muX']);
		expect(typeof muX).toBe('number');
	});

	it('reads instances[0].typeId as a number (enum storage)', () => {
		const typeId = getAtPath(goldModel, ['instances', 0, 'typeId']);
		expect(typeof typeId).toBe('number');
	});
});

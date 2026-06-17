// Schema coverage tests for propGraphicsListResourceSchema.
//
// Coverage fixture: the real track-unit bundle example/TRK_UNIT9_GR.BNDL, from
// which we extract the embedded PropGraphicsList resource (type 0x10010). That
// model has both props (10) and parts (52), so it exercises every record type.
// The binary is untracked, so the whole suite is skipped when it's absent —
// same convention as the core gold test (fs.existsSync + describe.skip).
//
// Mirrors instanceList.test.ts: parse the model and walk it against the schema
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
import { extractResourceRaw } from '../../core/registry';
import {
	parsePropGraphicsList,
	type ParsedPropGraphicsList,
} from '../../core/propGraphicsList';

import { propGraphicsListResourceSchema } from './propGraphicsList';
import {
	getAtPath,
	resolveSchemaAtPath,
	walkResource,
	formatPath,
} from '../walk';
import type { FieldSchema } from '../types';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_9 = path.resolve(REPO_ROOT, 'example/TRK_UNIT9_GR.BNDL');
const PROP_GRAPHICS_LIST_TYPE_ID = 0x10010;

function loadBundleModel(fixturePath: string): ParsedPropGraphicsList {
	const file = fs.readFileSync(fixturePath);
	const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
	const bundle = parseBundle(buffer as ArrayBuffer, { strict: false });
	const resource = bundle.resources.find((r) => r.resourceTypeId === PROP_GRAPHICS_LIST_TYPE_ID);
	if (!resource) throw new Error(`${fixturePath} missing PropGraphicsList resource`);
	const raw = extractResourceRaw(buffer as ArrayBuffer, bundle, resource);
	return parsePropGraphicsList(raw);
}

// The fixture binary is untracked — skip the whole suite when it's absent.
const hasFixture = fs.existsSync(BUNDLE_9);
const describeFixture = hasFixture ? describe : describe.skip;

const model = hasFixture ? loadBundleModel(BUNDLE_9) : (undefined as unknown as ParsedPropGraphicsList);

describeFixture('propGraphicsListResourceSchema coverage — bundle TRK_UNIT9_GR.BNDL', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.props.length).toBeGreaterThan(0);
		expect(model.props.reduce((n, p) => n + p.parts.length, 0)).toBeGreaterThan(0);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(propGraphicsListResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!propGraphicsListResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(propGraphicsListResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(propGraphicsListResourceSchema, model, (p, value, _field, rec) => {
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
		walkResource(propGraphicsListResourceSchema, model, (p, value, _field, rec) => {
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

// ---------------------------------------------------------------------------
// Path resolution + field kinds
// ---------------------------------------------------------------------------

describe('propGraphicsList path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(propGraphicsListResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedPropGraphicsList');
	});

	it('resolves props[0] as a PropGraphics', () => {
		const loc = resolveSchemaAtPath(propGraphicsListResourceSchema, ['props', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('PropGraphics');
	});

	it('resolves props[0].muTypeId as an enum (prop-types vocabulary)', () => {
		const loc = resolveSchemaAtPath(propGraphicsListResourceSchema, ['props', 0, 'muTypeId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
	});

	it('resolves props[0].mpModelId as an editable bigint resource id', () => {
		const loc = resolveSchemaAtPath(propGraphicsListResourceSchema, ['props', 0, 'mpModelId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});

	it('resolves a nested part props[0].parts[0] as a PropPartGraphics', () => {
		const loc = resolveSchemaAtPath(propGraphicsListResourceSchema, ['props', 0, 'parts', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('PropPartGraphics');
	});

	it('resolves props[0].parts[0].muPartId as u32', () => {
		const loc = resolveSchemaAtPath(propGraphicsListResourceSchema, ['props', 0, 'parts', 0, 'muPartId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});

	it('resolves props[0].parts[0].mpModelId as an editable bigint resource id', () => {
		const loc = resolveSchemaAtPath(propGraphicsListResourceSchema, ['props', 0, 'parts', 0, 'mpModelId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});

	it('exposes props AND each prop\'s nested parts as addable/removable lists', () => {
		const props = propGraphicsListResourceSchema.registry.ParsedPropGraphicsList.fields.props;
		const parts = propGraphicsListResourceSchema.registry.PropGraphics.fields.parts;
		if (props.kind !== 'list' || parts.kind !== 'list') throw new Error('expected lists');
		expect(props.addable).toBe(true);
		expect(props.removable).toBe(true);
		// Parts are now add/removable, nested under their owning prop.
		expect(parts.addable).toBe(true);
		expect(parts.removable).toBe(true);
		// makeEmpty: a new prop starts partless with a default Model id; a new part
		// just needs an id + Model (its type is the owning prop's). Lock ALL four
		// fields a partless prop needs to round-trip — _mpPartsRaw and muTypeId are
		// load-bearing for the writer (writeU32 silently coerces undefined → 0, so a
		// regression dropping them would otherwise escape the suite).
		const emptyProp = props.makeEmpty!({ root: {}, resource: propGraphicsListResourceSchema }) as Record<string, unknown>;
		expect(emptyProp.mpModelId).toBe(0n);
		expect(emptyProp.parts).toEqual([]);
		expect(emptyProp).toHaveProperty('_mpPartsRaw', 0);
		expect(emptyProp).toHaveProperty('muTypeId', 0);
		const emptyPart = parts.makeEmpty!({ root: {}, resource: propGraphicsListResourceSchema }) as { muPartId: number; mpModelId: bigint };
		expect(emptyPart.mpModelId).toBe(0n);
		expect(emptyPart.muPartId).toBe(0);
	});

	it('resolves muZoneNumber as u32', () => {
		const loc = resolveSchemaAtPath(propGraphicsListResourceSchema, ['muZoneNumber']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});
});

// ---------------------------------------------------------------------------
// Tree labels
// ---------------------------------------------------------------------------

describeFixture('propGraphicsList tree labels', () => {
	it('prop label includes the index, prop name, and Model id', () => {
		// props[0] in TRK_UNIT9 has type id 0x28 and Model 0x12F7700A.
		const prop = model.props[0];
		const field = propGraphicsListResourceSchema.registry.ParsedPropGraphicsList.fields.props;
		if (field.kind !== 'list') throw new Error('expected list');
		const labelFn = field.itemLabel as (v: unknown, i: number) => string;
		const label = labelFn(prop, 0);
		expect(label.startsWith('#0 · ')).toBe(true);
		expect(label).toContain('model 0x12F7700A');
	});

	it('part label (nested under a prop) includes the index, part number, and Model id', () => {
		// props[0] in TRK_UNIT9 owns parts 0,1,… of type 0x28.
		const part = model.props[0].parts[1];
		const field = propGraphicsListResourceSchema.registry.PropGraphics.fields.parts;
		if (field.kind !== 'list') throw new Error('expected list');
		const labelFn = field.itemLabel as (v: unknown, i: number) => string;
		const label = labelFn(part, 1);
		expect(label.startsWith('#1 · ')).toBe(true);
		expect(label).toContain('part 1');
		expect(label).toContain('model 0x');
	});

	it('PropGraphics.label callback returns a non-empty string', () => {
		const ctx = { root: model, resource: propGraphicsListResourceSchema };
		const label = propGraphicsListResourceSchema.registry.PropGraphics.label!(
			model.props[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(typeof label).toBe('string');
		expect(label.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Sanity: representative reads via getAtPath
// ---------------------------------------------------------------------------

describeFixture('propGraphicsList getAtPath', () => {
	it('reads a prop type id as a number', () => {
		const id = getAtPath(model, ['props', 0, 'muTypeId']);
		expect(typeof id).toBe('number');
		expect(Number.isFinite(id)).toBe(true);
	});

	it('reads props[0].mpModelId as a bigint Model resource id', () => {
		const id = getAtPath(model, ['props', 0, 'mpModelId']);
		expect(typeof id).toBe('bigint');
		expect(id).toBe(0x12f7700an);
	});

	it('reads a nested part Model id as a bigint', () => {
		const id = getAtPath(model, ['props', 0, 'parts', 0, 'mpModelId']);
		expect(typeof id).toBe('bigint');
	});
});

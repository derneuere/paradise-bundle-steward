// Schema coverage + navigation tests for textureResourceSchema.
//
// The texture handler is read-only (`caps.write: false`), so this suite
// does NOT include a byte round-trip check — there is no writer to round
// through. What we CAN verify:
//
//   1. Every parsed header field is covered by the schema and vice versa
//      (walks across every texture in the fixture, not just the first one,
//      to catch format-specific divergence).
//   2. `resolveSchemaAtPath` lands on the expected field kinds.
//   3. `getAtPath` / `updateAtPath` round-trip a primitive edit with
//      structural sharing preserved.
//   4. The schema registry is internally consistent (no dangling record
//      type references).
//
// Fixture: `example/VEH_CARBRWDS_GR.BIN` contains 113 texture resources at
// last count — more than enough to stress the schema across a variety of
// texture sizes and formats.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw } from '../../core/registry';
import {
	parseTextureHeader,
	TEXTURE_TYPE_ID,
	type ParsedTextureHeader,
} from '../../core/texture';

import { textureResourceSchema } from './texture';
import {
	getAtPath,
	resolveSchemaAtPath,
	updateAtPath,
	walkResource,
	formatPath,
} from '../walk';
import type { FieldSchema } from '../types';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const FIXTURE = path.resolve(__dirname, '../../../../example/VEH_CARBRWDS_GR.BIN');

function loadAllTextureHeaders(): ParsedTextureHeader[] {
	const fileBytes = fs.readFileSync(FIXTURE);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer);

	const out: ParsedTextureHeader[] = [];
	for (const r of bundle.resources) {
		if (r.resourceTypeId !== TEXTURE_TYPE_ID) continue;
		try {
			const raw = extractResourceRaw(buffer.buffer, bundle, r);
			out.push(parseTextureHeader(raw));
		} catch {
			// A few entries in the bundle may have empty blocks or unparsable
			// headers — the handler itself tolerates this, and so does the
			// schema test. Skip them here so coverage runs across the healthy
			// majority.
		}
	}
	if (out.length === 0) {
		throw new Error(`${FIXTURE} has no parseable textures — fixture moved?`);
	}
	return out;
}

const allTextures = loadAllTextureHeaders();
const firstTexture = allTextures[0];

// ---------------------------------------------------------------------------
// Schema coverage
// ---------------------------------------------------------------------------

describe('textureResourceSchema coverage', () => {
	it('fixture contains multiple textures', () => {
		expect(allTextures.length).toBeGreaterThan(1);
	});

	it('root type exists in registry', () => {
		expect(textureResourceSchema.registry.Texture).toBeDefined();
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, record] of Object.entries(textureResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(record.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}

		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!textureResourceSchema.registry[f.type]) {
					out.push(`${where} -> "${f.type}"`);
				}
				return;
			}
			if (f.kind === 'list') {
				checkField(f.item, `${where}[]`, out);
			}
		}
	});

	it('no parsed record has fields absent from the schema (checked across every texture)', () => {
		const missing: string[] = [];
		for (let i = 0; i < allTextures.length; i++) {
			const texture = allTextures[i];
			walkResource(textureResourceSchema, texture, (p, value, _field, record) => {
				if (!record) return;
				if (value == null || typeof value !== 'object') return;
				const declared = new Set(Object.keys(record.fields));
				for (const key of Object.keys(value as Record<string, unknown>)) {
					if (!declared.has(key)) {
						missing.push(`texture[${i}]${formatPath(p) ? '.' + formatPath(p) : ''}.${key}  (record "${record.name}")`);
					}
				}
			});
		}
		if (missing.length > 0) {
			throw new Error(`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 10).join('\n  ')}`);
		}
	});

	it('every schema field exists on the parsed data (checked across every texture)', () => {
		const missing: string[] = [];
		for (let i = 0; i < allTextures.length; i++) {
			const texture = allTextures[i];
			walkResource(textureResourceSchema, texture, (p, value, _field, record) => {
				if (!record) return;
				if (value == null || typeof value !== 'object') return;
				const obj = value as Record<string, unknown>;
				for (const fieldName of Object.keys(record.fields)) {
					if (!(fieldName in obj)) {
						missing.push(`texture[${i}]${formatPath(p) ? '.' + formatPath(p) : ''}.${fieldName}  (record "${record.name}")`);
					}
				}
			});
		}
		if (missing.length > 0) {
			throw new Error(`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 10).join('\n  ')}`);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(textureResourceSchema, firstTexture, (_path, _value, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		// Single-record schema with 8 fields — one record visit, at least
		// eight field visits.
		expect(recordCount).toBe(1);
		expect(fieldCount).toBeGreaterThanOrEqual(8);
	});
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe('texture path resolution', () => {
	it('resolves root', () => {
		const loc = resolveSchemaAtPath(textureResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('Texture');
	});

	it('resolves format (string)', () => {
		const loc = resolveSchemaAtPath(textureResourceSchema, ['format']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
		expect(loc!.parentRecord?.name).toBe('Texture');
	});

	it('resolves formatRaw (u32)', () => {
		const loc = resolveSchemaAtPath(textureResourceSchema, ['formatRaw']);
		expect(loc!.field?.kind).toBe('u32');
	});

	it('resolves width / height (u16)', () => {
		expect(resolveSchemaAtPath(textureResourceSchema, ['width'])!.field?.kind).toBe('u16');
		expect(resolveSchemaAtPath(textureResourceSchema, ['height'])!.field?.kind).toBe('u16');
	});

	it('resolves mipLevels (u8)', () => {
		const loc = resolveSchemaAtPath(textureResourceSchema, ['mipLevels']);
		expect(loc!.field?.kind).toBe('u8');
	});

	it('returns null for an unknown field', () => {
		expect(resolveSchemaAtPath(textureResourceSchema, ['nonexistent'])).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Data mutation
// ---------------------------------------------------------------------------

describe('texture getAtPath / updateAtPath', () => {
	it('getAtPath returns the root for empty path', () => {
		expect(getAtPath(firstTexture, [])).toBe(firstTexture);
	});

	it('getAtPath returns a nested primitive', () => {
		expect(getAtPath(firstTexture, ['width'])).toBe(firstTexture.width);
		expect(getAtPath(firstTexture, ['format'])).toBe(firstTexture.format);
	});

	it('updateAtPath replaces a primitive and preserves siblings (structural sharing)', () => {
		const original = firstTexture;
		const next = updateAtPath(original, ['width'], () => 9999);
		expect(next.width).toBe(9999);
		// Sibling primitives untouched
		expect(next.height).toBe(original.height);
		expect(next.format).toBe(original.format);
		expect(next.formatRaw).toBe(original.formatRaw);
		expect(next.mipLevels).toBe(original.mipLevels);
		// Original left alone
		expect(original.width).not.toBe(9999);
		// Root reference changed (a new object was created)
		expect(next).not.toBe(original);
	});

	it('updateAtPath on format string value works', () => {
		const next = updateAtPath(firstTexture, ['format'], () => 'A8R8G8B8' as const);
		expect(next.format).toBe('A8R8G8B8');
	});
});

// ---------------------------------------------------------------------------
// Field metadata sanity
// ---------------------------------------------------------------------------

describe('texture field metadata', () => {
	it('every field is marked readOnly because the handler has no writer', () => {
		const record = textureResourceSchema.registry.Texture;
		const meta = record.fieldMetadata ?? {};
		for (const fieldName of Object.keys(record.fields)) {
			expect(meta[fieldName]?.readOnly).toBe(true);
		}
	});

	it('propertyGroups cover every field', () => {
		const record = textureResourceSchema.registry.Texture;
		const covered = new Set<string>();
		for (const group of record.propertyGroups ?? []) {
			if ('properties' in group) {
				for (const p of group.properties) covered.add(p);
			}
		}
		for (const fieldName of Object.keys(record.fields)) {
			expect(covered.has(fieldName)).toBe(true);
		}
	});
});

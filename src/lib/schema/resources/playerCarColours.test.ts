// Schema coverage + round-trip for playerCarColoursResourceSchema.
//
// Loads VEHICLELIST.BUNDLE (committed fixture), locates the PlayerCarColours
// resource, parses it, walks it against the schema, and asserts:
//   1. Every parsed field is declared by the schema (no drift).
//   2. Every schema field exists on the parsed data (no typos).
//   3. resolveSchemaAtPath walks into palettes[N].paintColours[M].red.
//   4. getAtPath / updateAtPath round-trip a deep primitive edit with
//      structural sharing.
//   5. Labels render the expected palette names + hex values.
//   6. Writer is stable: parse → write → parse → write is sha1-identical
//      on the second write. Retail files can have palette gaps / aliased
//      pointers, so the handler uses `stableWriter` instead of strict
//      byte-exact — we mirror that here.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw } from '../../core/registry';
import {
	parsePlayerCarColoursData,
	writePlayerCarColoursData,
	type PlayerCarColours,
} from '../../core/playerCarColors';

import { playerCarColoursResourceSchema } from './playerCarColours';
import {
	getAtPath,
	setAtPath,
	updateAtPath,
	resolveSchemaAtPath,
	walkResource,
	formatPath,
} from '../walk';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const FIXTURE = path.resolve(__dirname, '../../../../example/VEHICLELIST.BUNDLE');
const PLAYER_CAR_COLOURS_TYPE_ID = 0x1001e;

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadPlayerCarColours(): { raw: Uint8Array; parsed: PlayerCarColours } {
	const fileBytes = fs.readFileSync(FIXTURE);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === PLAYER_CAR_COLOURS_TYPE_ID);
	if (!resource) {
		throw new Error('VEHICLELIST.BUNDLE has no PlayerCarColours resource — fixture moved?');
	}
	const raw = extractResourceRaw(buffer.buffer, bundle, resource);
	const parsed = parsePlayerCarColoursData(raw);
	return { raw, parsed };
}

const { raw: rawColours, parsed: parsedColours } = loadPlayerCarColours();

// ---------------------------------------------------------------------------
// Schema coverage
// ---------------------------------------------------------------------------

describe('playerCarColoursResourceSchema coverage', () => {
	it('fixture has all 5 palettes with at least one populated paint list', () => {
		expect(parsedColours.palettes.length).toBe(5);
		const populated = parsedColours.palettes.some((p) => p.paintColours.length > 0);
		expect(populated).toBe(true);
	});

	it('root type exists in registry', () => {
		expect(playerCarColoursResourceSchema.registry.PlayerCarColours).toBeDefined();
		expect(playerCarColoursResourceSchema.registry.PlayerCarColourPalette).toBeDefined();
		expect(playerCarColoursResourceSchema.registry.PlayerCarColor).toBeDefined();
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(playerCarColoursResourceSchema, parsedColours, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			const declared = new Set(Object.keys(record.fields));
			for (const key of Object.keys(value as Record<string, unknown>)) {
				if (!declared.has(key)) {
					missing.push(`${formatPath(p)}.${key}  (record "${record.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 10).join('\n  ')}`);
		}
	});

	it('every schema field exists on the parsed data', () => {
		const missing: string[] = [];
		walkResource(playerCarColoursResourceSchema, parsedColours, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			const obj = value as Record<string, unknown>;
			for (const fieldName of Object.keys(record.fields)) {
				if (!(fieldName in obj)) {
					missing.push(`${formatPath(p)}.${fieldName}  (record "${record.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 10).join('\n  ')}`);
		}
	});

	it('walkResource visits root, palettes, and individual colors', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(playerCarColoursResourceSchema, parsedColours, (_p, _v, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		// 1 root + 5 palettes + N color records; at least the 6 structural ones.
		expect(recordCount).toBeGreaterThanOrEqual(6);
		expect(fieldCount).toBeGreaterThan(20);
	});
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe('playerCarColours path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(playerCarColoursResourceSchema, []);
		expect(loc?.record?.name).toBe('PlayerCarColours');
	});

	it('resolves a top-level primitive field', () => {
		const loc = resolveSchemaAtPath(playerCarColoursResourceSchema, ['totalColors']);
		expect(loc?.field?.kind).toBe('u32');
		expect(loc?.parentRecord?.name).toBe('PlayerCarColours');
	});

	it('resolves a fixed palette record', () => {
		const loc = resolveSchemaAtPath(playerCarColoursResourceSchema, ['palettes', 0]);
		expect(loc?.record?.name).toBe('PlayerCarColourPalette');
	});

	it('resolves a deep list-inside-list path into a color channel', () => {
		const pi = parsedColours.palettes.findIndex((p) => p.paintColours.length > 0);
		expect(pi).toBeGreaterThanOrEqual(0);
		const loc = resolveSchemaAtPath(
			playerCarColoursResourceSchema,
			['palettes', pi, 'paintColours', 0, 'red'],
		);
		expect(loc?.field?.kind).toBe('f32');
		expect(loc?.parentRecord?.name).toBe('PlayerCarColor');
	});

	it('returns null for an unknown field', () => {
		const loc = resolveSchemaAtPath(playerCarColoursResourceSchema, ['nonexistent']);
		expect(loc).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Data mutation
// ---------------------------------------------------------------------------

describe('playerCarColours updateAtPath', () => {
	it('deep-edits a paint color channel with structural sharing', () => {
		const pi = parsedColours.palettes.findIndex((p) => p.paintColours.length > 0);
		expect(pi).toBeGreaterThanOrEqual(0);
		const before = parsedColours.palettes[pi].paintColours[0].red;

		const next = updateAtPath(
			parsedColours,
			['palettes', pi, 'paintColours', 0, 'red'],
			() => 0.42,
		);
		expect(next.palettes[pi].paintColours[0].red).toBe(0.42);

		// Structural sharing: sibling palettes share references.
		for (let i = 0; i < parsedColours.palettes.length; i++) {
			if (i !== pi) expect(next.palettes[i]).toBe(parsedColours.palettes[i]);
		}
		// Top-level object is a new reference.
		expect(next).not.toBe(parsedColours);
		// Original untouched.
		expect(parsedColours.palettes[pi].paintColours[0].red).toBe(before);
	});

	it('setAtPath replaces a top-level primitive without cloning sub-lists', () => {
		const next = setAtPath(parsedColours, ['totalColors'], 999);
		expect(next.totalColors).toBe(999);
		// Palette list reference preserved by structural sharing.
		expect(next.palettes).toBe(parsedColours.palettes);
	});

	it('getAtPath walks into a nested color', () => {
		const pi = parsedColours.palettes.findIndex((p) => p.paintColours.length > 0);
		const red = getAtPath(parsedColours, ['palettes', pi, 'paintColours', 0, 'red']);
		expect(typeof red).toBe('number');
	});
});

// ---------------------------------------------------------------------------
// Writer stability (stableWriter contract)
// ---------------------------------------------------------------------------

describe('playerCarColours writer stability', () => {
	it('parse → write → parse → write is sha1-identical on the second write', () => {
		// First write may differ from the retail bytes because the writer
		// normalizes (dense layout, no aliased pointers). The handler declares
		// `stableWriter: true` for that reason — idempotence after the first
		// write is the realistic bar.
		const write1 = writePlayerCarColoursData(parsedColours);
		const reparsed = parsePlayerCarColoursData(write1);
		const write2 = writePlayerCarColoursData(reparsed);
		expect(write2.length).toBe(write1.length);
		expect(sha1(write2)).toBe(sha1(write1));
	});

	it('parse → walk → write matches parse → write (walker must not mutate)', () => {
		let visitCount = 0;
		walkResource(playerCarColoursResourceSchema, parsedColours, () => {
			visitCount++;
		});
		expect(visitCount).toBeGreaterThan(20);
		// After walking, the writer still produces the same normalized output
		// as before walking — this is the "walker doesn't mutate" guarantee.
		const writeAfterWalk = writePlayerCarColoursData(parsedColours);
		const writeFresh = writePlayerCarColoursData(parsePlayerCarColoursData(rawColours));
		expect(sha1(writeAfterWalk)).toBe(sha1(writeFresh));
	});
});

// ---------------------------------------------------------------------------
// Tree label callbacks
// ---------------------------------------------------------------------------

describe('playerCarColours labels', () => {
	const ctx = { root: parsedColours, resource: playerCarColoursResourceSchema };

	it('palette label uses the type name and colour count', () => {
		const schema = playerCarColoursResourceSchema.registry.PlayerCarColourPalette;
		const p0 = parsedColours.palettes[0] as unknown as Record<string, unknown>;
		const label = schema.label?.(p0, 0, ctx);
		// First palette is Gloss (type 0).
		expect(label).toMatch(/^Gloss · \d+ colors$/);
	});

	it('color label uses the computed hex value', () => {
		const pi = parsedColours.palettes.findIndex((p) => p.paintColours.length > 0);
		expect(pi).toBeGreaterThanOrEqual(0);
		const schema = playerCarColoursResourceSchema.registry.PlayerCarColor;
		const c0 = parsedColours.palettes[pi].paintColours[0] as unknown as Record<string, unknown>;
		const label = schema.label?.(c0, 0, ctx);
		expect(label).toMatch(/^#0 · #[0-9a-f]{6}( · Neon)?$/);
	});
});

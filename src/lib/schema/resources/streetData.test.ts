// Schema coverage + round-trip tests for streetDataResourceSchema.
//
// Modeled after trafficData.test.ts. StreetData differs in one important
// way: the writer is intentionally lossy on its first pass (drops the
// spans/exits tail from 29584 bytes down to 26992 bytes to satisfy the
// retail FixUp() safety margin). That means we cannot assert
// sha1(write(parse(raw))) === sha1(raw) the way trafficData can.
//
// Instead we pin:
//   1. The raw fixture payload's own sha1 (fixture-integrity check).
//   2. The walker doesn't mutate (write-before-walk == write-after-walk).
//   3. The writer is idempotent after its first lossy pass
//      (write(parse(write(parse(raw)))) === write(parse(raw))).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../../core/bundle';
import { RESOURCE_TYPE_IDS } from '../../core/types';
import { extractResourceSize, isCompressed, decompressData } from '../../core/resourceManager';
import {
	parseStreetDataData,
	writeStreetDataData,
	type ParsedStreetData,
} from '../../core/streetData';

import { streetDataResourceSchema } from './streetData';
import {
	getAtPath,
	setAtPath,
	updateAtPath,
	insertListItem,
	removeListItem,
	resolveSchemaAtPath,
	walkResource,
	formatPath,
} from '../walk';
import type { FieldSchema } from '../types';

// ---------------------------------------------------------------------------
// Fixture loader — mirrors trafficData.test.ts
// ---------------------------------------------------------------------------

const FIXTURE = path.resolve(__dirname, '../../../../example/BTTSTREETDATA.DAT');

// Uncompressed raw payload pin. This is the known-good sha1 for the
// 29584-byte StreetData resource inside BTTSTREETDATA.DAT. If the fixture
// is regenerated or corrupted, this test fails loudly.
const RAW_PAYLOAD_SHA1 = '9be20668da1bd69e1ac483018b5d7a7736f3e936';
const RAW_PAYLOAD_LENGTH = 29584;

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadStreetDataRaw(): Uint8Array {
	const raw = fs.readFileSync(FIXTURE);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	const bundle = parseBundle(bytes.buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === RESOURCE_TYPE_IDS.STREET_DATA);
	if (!resource) throw new Error('Fixture missing StreetData resource');
	for (let bi = 0; bi < 3; bi++) {
		const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[bi]);
		if (size <= 0) continue;
		const base = bundle.header.resourceDataOffsets[bi] >>> 0;
		const rel = resource.diskOffsets[bi] >>> 0;
		const start = (base + rel) >>> 0;
		let slice = new Uint8Array(bytes.buffer.slice(start, start + size));
		if (isCompressed(slice)) slice = decompressData(slice) as Uint8Array;
		return slice;
	}
	throw new Error('Fixture has no non-empty StreetData payload');
}

const rawStreetData = loadStreetDataRaw();
const parsedStreetData = parseStreetDataData(rawStreetData, true);

// ---------------------------------------------------------------------------
// 0. Fixture integrity pin
// ---------------------------------------------------------------------------

describe('BTTSTREETDATA.DAT fixture integrity', () => {
	it('raw payload length matches the expected pin', () => {
		expect(rawStreetData.byteLength).toBe(RAW_PAYLOAD_LENGTH);
	});

	it('raw payload sha1 matches the expected pin', () => {
		expect(sha1(rawStreetData)).toBe(RAW_PAYLOAD_SHA1);
	});
});

// ---------------------------------------------------------------------------
// 1. Schema coverage — every parsed field has a schema entry, and vice versa
// ---------------------------------------------------------------------------

describe('streetDataResourceSchema coverage', () => {
	it('root type exists in registry', () => {
		expect(streetDataResourceSchema.registry.StreetData).toBeDefined();
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, record] of Object.entries(streetDataResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(record.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}

		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!streetDataResourceSchema.registry[f.type]) {
					out.push(`${where} -> "${f.type}"`);
				}
				return;
			}
			if (f.kind === 'list') {
				checkField(f.item, `${where}[]`, out);
			}
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(streetDataResourceSchema, parsedStreetData, (_path, _value, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(streetDataResourceSchema, parsedStreetData, (p, value, _field, record) => {
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
			throw new Error(
				`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''}`,
			);
		}
	});

	it('every record-level field in the schema is represented in the parsed data', () => {
		const missing: string[] = [];
		walkResource(streetDataResourceSchema, parsedStreetData, (p, value, _field, record) => {
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
			throw new Error(
				`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''}`,
			);
		}
	});
});

// ---------------------------------------------------------------------------
// 2. Path resolution
// ---------------------------------------------------------------------------

describe('resolveSchemaAtPath', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(streetDataResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('StreetData');
	});

	it('resolves a top-level primitive field', () => {
		const loc = resolveSchemaAtPath(streetDataResourceSchema, ['miVersion']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('i32');
		expect(loc!.parentRecord?.name).toBe('StreetData');
	});

	it('resolves a list item and lands on its record', () => {
		if (parsedStreetData.streets.length === 0) return;
		const loc = resolveSchemaAtPath(streetDataResourceSchema, ['streets', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('Street');
	});

	it('resolves a nested record inside a list item', () => {
		if (parsedStreetData.streets.length === 0) return;
		const loc = resolveSchemaAtPath(streetDataResourceSchema, ['streets', 0, 'superSpanBase']);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('SpanBase');
	});

	it('resolves a deep list-inside-record-inside-list path', () => {
		if (parsedStreetData.challenges.length === 0) return;
		const loc = resolveSchemaAtPath(
			streetDataResourceSchema,
			['challenges', 0, 'challengeData', 'mScoreList', 'maScores', 0],
		);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('i32');
	});

	it('resolves a bigint leaf field', () => {
		if (parsedStreetData.roads.length === 0) return;
		const loc = resolveSchemaAtPath(streetDataResourceSchema, ['roads', 0, 'mId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});

	it('returns null for an unknown field', () => {
		const loc = resolveSchemaAtPath(streetDataResourceSchema, ['nonexistent']);
		expect(loc).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 3. Data get / update round-trips
// ---------------------------------------------------------------------------

describe('getAtPath / updateAtPath', () => {
	it('getAtPath returns the root for empty path', () => {
		expect(getAtPath(parsedStreetData, [])).toBe(parsedStreetData);
	});

	it('getAtPath returns a nested primitive', () => {
		expect(getAtPath(parsedStreetData, ['miVersion'])).toBe(parsedStreetData.miVersion);
	});

	it('getAtPath returns a nested list item', () => {
		if (parsedStreetData.streets.length === 0) return;
		const first = getAtPath(parsedStreetData, ['streets', 0]);
		expect(first).toBe(parsedStreetData.streets[0]);
	});

	it('setAtPath replaces a primitive and leaves the rest intact (structural sharing)', () => {
		const before = parsedStreetData.miVersion;
		const next = setAtPath(parsedStreetData, ['miVersion'], 99);
		expect(next.miVersion).toBe(99);
		// Other top-level fields unchanged by reference (structural sharing)
		expect(next.streets).toBe(parsedStreetData.streets);
		expect(next.junctions).toBe(parsedStreetData.junctions);
		expect(next.roads).toBe(parsedStreetData.roads);
		expect(next.challenges).toBe(parsedStreetData.challenges);
		// Original untouched
		expect(parsedStreetData.miVersion).toBe(before);
	});

	it('updateAtPath deep-edits a list item field', () => {
		if (parsedStreetData.streets.length === 0) return;
		const next = updateAtPath(
			parsedStreetData,
			['streets', 0, 'mAiInfo', 'muMaxSpeedMPS'],
			() => 200,
		);
		expect(next.streets[0].mAiInfo.muMaxSpeedMPS).toBe(200);
		// The un-edited streets share references
		for (let i = 1; i < parsedStreetData.streets.length; i++) {
			expect(next.streets[i]).toBe(parsedStreetData.streets[i]);
		}
		// Other collections still share by reference
		expect(next.junctions).toBe(parsedStreetData.junctions);
		expect(next.roads).toBe(parsedStreetData.roads);
		// Original untouched
		expect(parsedStreetData.streets[0].mAiInfo.muMaxSpeedMPS).not.toBe(200);
	});

	it('insertListItem appends and removeListItem removes', () => {
		if (parsedStreetData.streets.length === 0) return;
		const withExtra = insertListItem(
			parsedStreetData,
			['streets'],
			{
				superSpanBase: { miRoadIndex: 0, miSpanIndex: 0, padding: [0, 0], meSpanType: 0 },
				mAiInfo: { muMaxSpeedMPS: 0, muMinSpeedMPS: 0 },
				padding: [0, 0],
			},
		);
		expect(withExtra.streets.length).toBe(parsedStreetData.streets.length + 1);
		const backOut = removeListItem(withExtra, ['streets'], withExtra.streets.length - 1);
		expect(backOut.streets.length).toBe(parsedStreetData.streets.length);
	});
});

// ---------------------------------------------------------------------------
// 4. Walker-doesn't-mutate + stable writer
// ---------------------------------------------------------------------------

describe('streetData round-trip integrity', () => {
	it('walker does not mutate: write(before walk) === write(after walk)', () => {
		const before = writeStreetDataData(parsedStreetData, true);
		let visitCount = 0;
		walkResource(streetDataResourceSchema, parsedStreetData, () => {
			visitCount++;
		});
		expect(visitCount).toBeGreaterThan(100);
		const after = writeStreetDataData(parsedStreetData, true);
		expect(sha1(after)).toBe(sha1(before));
	});

	it('writer is stable: write(parse(write(parse(raw)))) === write(parse(raw))', () => {
		const write1 = writeStreetDataData(parsedStreetData, true);
		const reparsed = parseStreetDataData(write1, true);
		const write2 = writeStreetDataData(reparsed, true);
		expect(write2.byteLength).toBe(write1.byteLength);
		expect(sha1(write2)).toBe(sha1(write1));
	});

	it('first write is smaller than raw payload (spans/exits tail dropped)', () => {
		// Sanity check — confirms the lossy-first-pass behavior is still in
		// effect. If the writer ever becomes byte-exact against the raw, flip
		// this test and add a byteRoundTrip check to the handler.
		const write1 = writeStreetDataData(parsedStreetData, true);
		expect(write1.byteLength).toBeLessThan(rawStreetData.byteLength);
	});

	it('updateAtPath on a primitive produces a writable model', () => {
		const next = setAtPath(parsedStreetData, ['miVersion'], 6);
		expect(() => writeStreetDataData(next, true)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// 5. Label callbacks
// ---------------------------------------------------------------------------

describe('schema labels', () => {
	const ctx = {
		root: parsedStreetData,
		resource: streetDataResourceSchema,
	};

	it('Street label names the road index and speed range', () => {
		if (parsedStreetData.streets.length === 0) return;
		const schema = streetDataResourceSchema.registry.Street;
		const label = schema.label?.(
			parsedStreetData.streets[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(label).toMatch(/^#0/);
		expect(label).toMatch(/road/);
		expect(label).toMatch(/m\/s/);
	});

	it('Junction label includes index and road reference', () => {
		if (parsedStreetData.junctions.length === 0) return;
		const schema = streetDataResourceSchema.registry.Junction;
		const label = schema.label?.(
			parsedStreetData.junctions[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(label).toMatch(/^#0/);
	});

	it('Road label includes debug name or no-name placeholder', () => {
		if (parsedStreetData.roads.length === 0) return;
		const schema = streetDataResourceSchema.registry.Road;
		const label = schema.label?.(
			parsedStreetData.roads[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(label).toMatch(/^#0/);
		// Reference position should be in the label when present
		expect(label).toMatch(/\(/);
	});

	it('ChallengeParScores label references the paired road and shows scores', () => {
		if (parsedStreetData.challenges.length === 0) return;
		const schema = streetDataResourceSchema.registry.ChallengeParScores;
		const label = schema.label?.(
			parsedStreetData.challenges[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(label).toMatch(/^#0/);
		expect(label).toMatch(/\[/); // score brackets
	});

	it('label callbacks do not throw when passed an empty object', () => {
		for (const recordName of ['Street', 'Junction', 'Road', 'ChallengeParScores']) {
			const schema = streetDataResourceSchema.registry[recordName];
			if (!schema.label) continue;
			expect(() => schema.label!({}, 0, ctx)).not.toThrow();
		}
	});
});

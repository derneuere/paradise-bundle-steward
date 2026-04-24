// Schema coverage + round-trip tests for challengeListResourceSchema.
//
// Loads ONLINECHALLENGES.BNDL, parses it, walks it against the schema,
// and asserts:
//   1. Every field in the parsed model is described by the schema (no
//      unknown fields slipping through).
//   2. Every record type referenced by the schema exists in the registry.
//   3. resolveSchemaAtPath / updateAtPath round-trip correctly.
//   4. Walking then writing is idempotent (the fixture uses stableWriter
//      rather than byteRoundTrip, matching the handler expectation).
//   5. Tree-label callbacks return the expected shape against real data.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../../core/bundle';
import { RESOURCE_TYPE_IDS } from '../../core/types';
import {
	extractResourceSize,
	isCompressed,
	decompressData,
} from '../../core/resourceManager';
import {
	parseChallengeListData,
	writeChallengeListData,
	type ParsedChallengeList,
} from '../../core/challengeList';

import {
	challengeListResourceSchema,
	challengeLabel,
	actionLabel,
	actionTypeShortLabel,
} from './challengeList';
import {
	getAtPath,
	setAtPath,
	updateAtPath,
	resolveSchemaAtPath,
	walkResource,
	formatPath,
} from '../walk';
import type { FieldSchema } from '../types';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const FIXTURE = path.resolve(__dirname, '../../../../example/ONLINECHALLENGES.BNDL');

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadChallengeListRaw(): Uint8Array {
	const raw = fs.readFileSync(FIXTURE);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	const bundle = parseBundle(bytes.buffer);
	const resource = bundle.resources.find(
		(r) => r.resourceTypeId === RESOURCE_TYPE_IDS.CHALLENGE_LIST,
	);
	if (!resource) throw new Error('Fixture missing ChallengeList resource');
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
	throw new Error('Fixture has no non-empty ChallengeList payload');
}

const rawChallenges = loadChallengeListRaw();
const parsedChallenges = parseChallengeListData(rawChallenges, true);

// The fixture uses `stableWriter` rather than `byteRoundTrip` (see
// handler registration), so the first write may differ from the raw
// input. Capture a stable baseline once to compare subsequent writes
// against.
const stableBaseline = writeChallengeListData(parsedChallenges, true);
const stableModel = parseChallengeListData(stableBaseline, true);

// ---------------------------------------------------------------------------
// 1. Schema coverage
// ---------------------------------------------------------------------------

describe('challengeListResourceSchema coverage', () => {
	it('root type exists in registry', () => {
		expect(challengeListResourceSchema.registry.ChallengeList).toBeDefined();
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, record] of Object.entries(challengeListResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(record.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}

		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!challengeListResourceSchema.registry[f.type]) {
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
		walkResource(challengeListResourceSchema, parsedChallenges, (_path, _value, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(challengeListResourceSchema, parsedChallenges, (p, value, _field, record) => {
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
				`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${
					missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''
				}`,
			);
		}
	});

	it('every record-level field in the schema is represented in the parsed data', () => {
		const missing: string[] = [];
		walkResource(challengeListResourceSchema, parsedChallenges, (p, value, _field, record) => {
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
				`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${
					missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''
				}`,
			);
		}
	});
});

// ---------------------------------------------------------------------------
// 2. Path resolution
// ---------------------------------------------------------------------------

describe('resolveSchemaAtPath', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(challengeListResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ChallengeList');
	});

	it('resolves a top-level primitive field', () => {
		const loc = resolveSchemaAtPath(challengeListResourceSchema, ['numChallenges']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
		expect(loc!.parentRecord?.name).toBe('ChallengeList');
	});

	it('resolves a challenge list item and lands on ChallengeListEntry', () => {
		if (parsedChallenges.challenges.length === 0) return;
		const loc = resolveSchemaAtPath(challengeListResourceSchema, ['challenges', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ChallengeListEntry');
	});

	it('resolves a nested record inside a challenge entry', () => {
		if (parsedChallenges.challenges.length === 0) return;
		const loc = resolveSchemaAtPath(
			challengeListResourceSchema,
			['challenges', 0, 'actions', 0],
		);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ChallengeListEntryAction');
	});

	it('resolves a deep list-inside-list path', () => {
		if (parsedChallenges.challenges.length === 0) return;
		const loc = resolveSchemaAtPath(
			challengeListResourceSchema,
			['challenges', 0, 'actions', 0, 'locationData', 0, 'triggerID'],
		);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});

	it('resolves an action enum discriminator', () => {
		if (parsedChallenges.challenges.length === 0) return;
		const loc = resolveSchemaAtPath(
			challengeListResourceSchema,
			['challenges', 0, 'actions', 0, 'actionType'],
		);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
	});

	it('returns null for an unknown field', () => {
		const loc = resolveSchemaAtPath(challengeListResourceSchema, ['nonexistent']);
		expect(loc).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 3. Data get / update round-trips
// ---------------------------------------------------------------------------

describe('getAtPath / updateAtPath', () => {
	it('getAtPath returns the root for empty path', () => {
		expect(getAtPath(parsedChallenges, [])).toBe(parsedChallenges);
	});

	it('getAtPath returns a nested primitive', () => {
		expect(getAtPath(parsedChallenges, ['numChallenges'])).toBe(parsedChallenges.numChallenges);
	});

	it('getAtPath returns a nested list item', () => {
		if (parsedChallenges.challenges.length === 0) return;
		expect(getAtPath(parsedChallenges, ['challenges', 0]))
			.toBe(parsedChallenges.challenges[0]);
	});

	it('setAtPath replaces a primitive and leaves siblings intact', () => {
		if (parsedChallenges.challenges.length === 0) return;
		const before = parsedChallenges.challenges[0].difficulty;
		const next = setAtPath(parsedChallenges, ['challenges', 0, 'difficulty'], 3);
		expect(next.challenges[0].difficulty).toBe(3);
		// Siblings share references (structural sharing).
		if (parsedChallenges.challenges.length > 1) {
			expect(next.challenges[1]).toBe(parsedChallenges.challenges[1]);
		}
		// Original untouched.
		expect(parsedChallenges.challenges[0].difficulty).toBe(before);
	});

	it('updateAtPath deep-edits a list-of-list-of-list primitive', () => {
		if (parsedChallenges.challenges.length === 0) return;
		const next = updateAtPath(
			parsedChallenges,
			['challenges', 0, 'actions', 0, 'locationData', 0, 'district'],
			() => 42,
		);
		expect(next.challenges[0].actions[0].locationData[0].district).toBe(42);
		// Un-edited challenges share references.
		for (let i = 1; i < parsedChallenges.challenges.length; i++) {
			expect(next.challenges[i]).toBe(parsedChallenges.challenges[i]);
		}
		// actions[1] of challenge 0 is also unchanged.
		expect(next.challenges[0].actions[1]).toBe(parsedChallenges.challenges[0].actions[1]);
		// Original untouched.
		expect(parsedChallenges.challenges[0].actions[0].locationData[0].district).not.toBe(42);
	});
});

// ---------------------------------------------------------------------------
// 4. Byte round-trip — the writer is byte-exact against the source fixture
//    (the fixture still keeps `stableWriter: true` alongside `byteRoundTrip`
//    as a belt-and-braces check). The byte-exactness here is what catches
//    regressions of the LocationData-union bug that used to zero byte 2 of
//    every trigger ID on save.
// ---------------------------------------------------------------------------

describe('challengeList writer stability', () => {
	it('write(parse(raw)) is byte-exact with the source fixture', () => {
		// Guards against any regression of the LocationData union handling
		// (the user-reported "third byte of every trigger ID zeroed" bug).
		expect(sha1(stableBaseline)).toBe(sha1(rawChallenges));
	});

	it('writer is idempotent on a walk-only pass', () => {
		// Walk the tree (read-only) then write. Must match the stable
		// baseline captured at the top of the suite.
		let visitCount = 0;
		walkResource(challengeListResourceSchema, parsedChallenges, () => {
			visitCount++;
		});
		expect(visitCount).toBeGreaterThan(10);
		const written = writeChallengeListData(parsedChallenges, true);
		expect(sha1(written)).toBe(sha1(stableBaseline));
	});

	it('writer is idempotent across two full parse+write cycles', () => {
		const second = parseChallengeListData(stableBaseline, true);
		const written = writeChallengeListData(second, true);
		expect(sha1(written)).toBe(sha1(stableBaseline));
	});

	it('editing a primitive through updateAtPath produces a writable model', () => {
		if (stableModel.challenges.length === 0) return;
		// Edit difficulty and convoyTime in a couple of deeply-nested paths.
		let next = setAtPath(stableModel, ['challenges', 0, 'difficulty'], 1);
		next = setAtPath(next, ['challenges', 0, 'actions', 0, 'convoyTime'], 0);
		// Writing the mutated model must not throw, and the change must
		// survive the round-trip.
		const bytes = writeChallengeListData(next, true);
		const reparsed = parseChallengeListData(bytes, true);
		expect(reparsed.challenges[0].difficulty).toBe(1);
		expect(reparsed.challenges[0].actions[0].convoyTime).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 5. Count-field reconciliation — the writer requires numChallenges to
//    equal challenges.length, matching the handler's `tolerateErrors`
//    fuzz rule. Verify the failure mode and the fix path.
// ---------------------------------------------------------------------------

describe('count-field reconciliation', () => {
	it('removing a challenge without updating numChallenges throws on write', () => {
		if (parsedChallenges.challenges.length < 2) return;
		const modified: ParsedChallengeList = {
			...parsedChallenges,
			challenges: parsedChallenges.challenges.slice(0, -1),
			// numChallenges deliberately NOT updated — the writer rejects this.
		};
		expect(() => writeChallengeListData(modified, true))
			.toThrow(/numChallenges.*must equal challenges\.length/i);
	});

	it('removing a challenge and updating numChallenges writes cleanly', () => {
		if (parsedChallenges.challenges.length < 2) return;
		const remaining = parsedChallenges.challenges.slice(0, -1);
		const modified: ParsedChallengeList = {
			...parsedChallenges,
			challenges: remaining,
			numChallenges: remaining.length,
		};
		const bytes = writeChallengeListData(modified, true);
		const reparsed = parseChallengeListData(bytes, true);
		expect(reparsed.challenges.length).toBe(remaining.length);
		expect(reparsed.numChallenges).toBe(remaining.length);
	});
});

// ---------------------------------------------------------------------------
// 6. Label callbacks
// ---------------------------------------------------------------------------

describe('schema labels', () => {
	it('actionTypeShortLabel returns a human string for known codes', () => {
		expect(actionTypeShortLabel(17)).toBe('Billboard');
		expect(actionTypeShortLabel(0)).toBe('Min Speed');
	});

	it('actionTypeShortLabel gracefully handles unknown codes', () => {
		expect(actionTypeShortLabel(9999)).toBe('Type 9999');
		expect(actionTypeShortLabel(undefined)).toBe('?');
	});

	it('challengeLabel includes the index, type, and a name or id', () => {
		if (parsedChallenges.challenges.length === 0) return;
		const label = challengeLabel(parsedChallenges.challenges[0], 0);
		expect(label).toMatch(/^#0 · /);
		// Either a parenthesized title or a hex challenge ID.
		expect(label.split(' · ').length).toBeGreaterThanOrEqual(3);
	});

	it('actionLabel names the action by its type short label', () => {
		if (parsedChallenges.challenges.length === 0) return;
		const label = actionLabel(parsedChallenges.challenges[0].actions[0], 0);
		expect(label).toMatch(/^Action 1 · /);
	});

	it('ChallengeListEntry record label matches challengeLabel output', () => {
		if (parsedChallenges.challenges.length === 0) return;
		const recordSchema = challengeListResourceSchema.registry.ChallengeListEntry;
		const ctx = { root: parsedChallenges, resource: challengeListResourceSchema };
		const label = recordSchema.label?.(
			parsedChallenges.challenges[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(label).toBe(challengeLabel(parsedChallenges.challenges[0], 0));
	});

	it('challenges list itemLabel callback runs against the live fixture', () => {
		if (parsedChallenges.challenges.length === 0) return;
		const listField = challengeListResourceSchema.registry.ChallengeList.fields.challenges;
		if (listField.kind !== 'list') throw new Error('expected list');
		const ctx = { root: parsedChallenges, resource: challengeListResourceSchema };
		const label = listField.itemLabel?.(parsedChallenges.challenges[0], 0, ctx);
		expect(label).toBe(challengeLabel(parsedChallenges.challenges[0], 0));
	});
});

// ---------------------------------------------------------------------------
// 7. LocationData union round-trip — regression tests for the bug where the
//    reader/writer treated each 8-byte slot as (districtCounty:u32,
//    triggerID:u32), zeroing byte 2 of every trigger/road CgsID on save.
//    Each test exercises one union arm end-to-end (write → re-parse).
// ---------------------------------------------------------------------------

describe('LocationData union round-trip (regression)', () => {
	// LocationType codes from the wiki spec, inlined to keep this test
	// independent of the public enum export.
	const ANYWHERE = 0;
	const DISTRICT = 1;
	const COUNTY = 2;
	const TRIGGER = 3;
	const ROAD = 4;
	const ROAD_NO_MARKER = 5;

	function freshModel(): ParsedChallengeList {
		// Start from a freshly-reparsed copy so in-test mutations don't
		// bleed across cases.
		return parseChallengeListData(stableBaseline, true);
	}

	function slotView(value: bigint) {
		return {
			district: Number(value & 0xFFFFFFFFn),
			county: Number(value & 0xFFFFFFFFn),
			triggerID: value,
			roadID: value,
		};
	}

	function setSlot(
		model: ParsedChallengeList,
		locationType: number,
		value: bigint,
	): ParsedChallengeList {
		const action = model.challenges[0].actions[0];
		action.locationType[0] = locationType;
		action.locationData[0] = slotView(value);
		return model;
	}

	function roundTrip(model: ParsedChallengeList): ParsedChallengeList {
		return parseChallengeListData(writeChallengeListData(model, true), true);
	}

	it('TRIGGER slot preserves byte 2 of the CgsID (the user-reported bug)', () => {
		// 0x00000000_0008C3D6 — laid out on disk as "d6 c3 08 00 00 00 00 00".
		// Pre-fix the writer zeroed byte 2 (the 0x08), truncating the ID to
		// 0x0000_C3D6.
		const cgs = 0x0008C3D6n;
		const reparsed = roundTrip(setSlot(freshModel(), TRIGGER, cgs));
		expect(reparsed.challenges[0].actions[0].locationData[0].triggerID).toBe(cgs);
	});

	it('TRIGGER slot preserves the full 8-byte CgsID including high half', () => {
		const cgs = 0xDEADBEEFCAFEBABEn;
		const reparsed = roundTrip(setSlot(freshModel(), TRIGGER, cgs));
		expect(reparsed.challenges[0].actions[0].locationData[0].triggerID).toBe(cgs);
	});

	it('ROAD slot preserves the full 8-byte CgsID via roadID', () => {
		const cgs = 0x0102030405060708n;
		const reparsed = roundTrip(setSlot(freshModel(), ROAD, cgs));
		expect(reparsed.challenges[0].actions[0].locationData[0].roadID).toBe(cgs);
	});

	it('ROAD_NO_MARKER slot uses the same union arm as ROAD', () => {
		const cgs = 0xFEDCBA9876543210n;
		const reparsed = roundTrip(setSlot(freshModel(), ROAD_NO_MARKER, cgs));
		expect(reparsed.challenges[0].actions[0].locationData[0].roadID).toBe(cgs);
	});

	it('DISTRICT slot stores EDistrict u32 in the low 4 bytes, high half is zero', () => {
		const district = 0x12345678;
		const reparsed = roundTrip(setSlot(freshModel(), DISTRICT, BigInt(district)));
		const loc = reparsed.challenges[0].actions[0].locationData[0];
		expect(loc.district).toBe(district);
		// High 32 bits of the slot are zero per the union spec, so the
		// CgsID-view of the bytes equals the u32 value.
		expect(loc.triggerID).toBe(BigInt(district));
	});

	it('COUNTY slot stores ECounty u32 in the low 4 bytes', () => {
		const county = 0x000000FF;
		const reparsed = roundTrip(setSlot(freshModel(), COUNTY, BigInt(county)));
		expect(reparsed.challenges[0].actions[0].locationData[0].county).toBe(county);
	});

	it('ANYWHERE slot is written as 8 zero bytes regardless of field content', () => {
		const model = setSlot(freshModel(), ANYWHERE, 0xDEADBEEFCAFEBABEn);
		const reparsed = roundTrip(model);
		const loc = reparsed.challenges[0].actions[0].locationData[0];
		expect(loc.triggerID).toBe(0n);
		expect(loc.roadID).toBe(0n);
		expect(loc.district).toBe(0);
		expect(loc.county).toBe(0);
	});
});

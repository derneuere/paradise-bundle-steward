// Tests for the pure collisionTag decode/encode module, plus a fixture-wide
// sanity check that validates the "material = low 16, group = high 16"
// transformation hypothesis against every polygon in example/WORLDCOL.BIN.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	decodeCollisionTag,
	encodeCollisionTag,
	setAiSectionIndex,
	setSurfaceId,
	setTrafficInfo,
	setFlagFatal,
	setFlagDriveable,
	setFlagSuperfatal,
	trafficInfoLabel,
	FLAG_FATAL,
	FLAG_DRIVEABLE,
	FLAG_SUPERFATAL,
	MATERIAL_HIGHEST_BIT,
	GROUP_HIGHEST_BIT,
	RESERVED_MASK,
	RESERVED_SHIFT,
	SURFACE_ID_MASK,
	SURFACE_ID_SHIFT,
	TRAFFIC_INFO_MASK,
	AI_SECTION_INDEX_MASK,
} from './collisionTag';

import { parseBundle } from './bundle';
import { extractResourceRaw, resourceCtxFromBundle } from './registry';
import { parsePolygonSoupListData } from './polygonSoupList';

const FIXTURE = path.resolve(__dirname, '../../../example/WORLDCOL.BIN');
const POLYGON_SOUP_LIST_TYPE_ID = 0x43;

// Curated values hitting every interesting bit pattern.
const ROUND_TRIP_VALUES = [
	0x80008000, // all zero except the two "highest bit" guards
	0xFFFFFFFF, // everything set
	0x8001800F, // material traffic = 0, then traffic = max
	0xA028806E, // user's screenshot value — expected: AI=8232, surface=6, traffic=14
	0x80008000 | (FLAG_FATAL << 0),                 // fatal only
	0x80008000 | (FLAG_DRIVEABLE << 0),              // driveable only
	0x80008000 | (FLAG_SUPERFATAL << 0),             // superfatal only
	0x80008000 | ((FLAG_FATAL | FLAG_DRIVEABLE | FLAG_SUPERFATAL) << 0), // all flags
	0x80008000 | (0x0C00),                           // reserved = 3
	0x80008000 | (0x03F0),                           // surface = 63
	0xFFFF8000,                                      // AI section = max
];

describe('collisionTag decode/encode', () => {
	it('round-trips curated values byte-for-byte', () => {
		for (const raw of ROUND_TRIP_VALUES) {
			const decoded = decodeCollisionTag(raw);
			const reencoded = encodeCollisionTag(decoded);
			expect(reencoded >>> 0).toBe(raw >>> 0);
		}
	});

	it('decodes the screenshot value correctly', () => {
		// User's bundle: soups[0].polygons[12].collisionTag = 0xA028806E
		// material = 0x806E, group = 0xA028
		const decoded = decodeCollisionTag(0xA028806E);
		expect(decoded.materialHighestBit).toBe(true);
		expect(decoded.fatal).toBe(false);
		expect(decoded.driveable).toBe(false);
		expect(decoded.superfatal).toBe(false);
		expect(decoded.reserved).toBe(0);
		expect(decoded.surfaceId).toBe(6);
		expect(decoded.trafficInfo).toBe(14);
		expect(decoded.groupHighestBit).toBe(true);
		expect(decoded.aiSectionIndex).toBe(0x2028); // = 8232
	});
});

describe('collisionTag per-field setters preserve everything else', () => {
	// Start from a raw with every interesting bit set, so we can catch any
	// setter that accidentally clobbers a neighboring field.
	const BASE = 0xFFFFFFFF;

	it('setAiSectionIndex only touches bits 30-16', () => {
		const next = setAiSectionIndex(BASE, 0x1234);
		// Material half unchanged
		expect(next & 0xFFFF).toBe(BASE & 0xFFFF);
		// Group highest bit preserved
		expect((next >>> 16) & GROUP_HIGHEST_BIT).toBe(GROUP_HIGHEST_BIT);
		// AI section set
		expect((next >>> 16) & AI_SECTION_INDEX_MASK).toBe(0x1234);
	});

	it('setAiSectionIndex clamps out-of-range values into 15 bits', () => {
		const next = setAiSectionIndex(0x80008000, 0xFFFFF);
		expect((next >>> 16) & AI_SECTION_INDEX_MASK).toBe(AI_SECTION_INDEX_MASK);
		// Group highest bit still set
		expect((next >>> 16) & GROUP_HIGHEST_BIT).toBe(GROUP_HIGHEST_BIT);
	});

	it('setSurfaceId only touches bits 9-4', () => {
		const next = setSurfaceId(BASE, 0x2A);
		// Other material bits unchanged
		expect(next & ~SURFACE_ID_MASK & 0xFFFF).toBe(BASE & ~SURFACE_ID_MASK & 0xFFFF);
		// Group half unchanged
		expect(next >>> 16).toBe((BASE >>> 16) >>> 0);
		// Surface set
		expect((next & SURFACE_ID_MASK) >>> SURFACE_ID_SHIFT).toBe(0x2A);
	});

	it('setSurfaceId clamps out-of-range values into 6 bits', () => {
		const next = setSurfaceId(0x80008000, 1000);
		expect((next & SURFACE_ID_MASK) >>> SURFACE_ID_SHIFT).toBeLessThanOrEqual(0x3F);
	});

	it('setTrafficInfo only touches bits 3-0', () => {
		const next = setTrafficInfo(BASE, 0x7);
		expect(next & ~TRAFFIC_INFO_MASK & 0xFFFF).toBe(BASE & ~TRAFFIC_INFO_MASK & 0xFFFF);
		expect(next >>> 16).toBe((BASE >>> 16) >>> 0);
		expect(next & TRAFFIC_INFO_MASK).toBe(0x7);
	});

	it('setFlagFatal only toggles bit 14 of the material half', () => {
		const cleared = setFlagFatal(BASE, false);
		expect(cleared & FLAG_FATAL).toBe(0);
		// Everything else in the u32 unchanged. Force-unsigned both sides so
		// JS's signed bitwise semantics don't trip the comparison.
		expect((cleared | FLAG_FATAL) >>> 0).toBe(BASE >>> 0);
		const restored = setFlagFatal(cleared, true);
		expect(restored >>> 0).toBe(BASE >>> 0);
	});

	it('setFlagDriveable only toggles bit 13 of the material half', () => {
		const cleared = setFlagDriveable(BASE, false);
		expect(cleared & FLAG_DRIVEABLE).toBe(0);
		expect((cleared | FLAG_DRIVEABLE) >>> 0).toBe(BASE >>> 0);
	});

	it('setFlagSuperfatal only toggles bit 12 of the material half', () => {
		const cleared = setFlagSuperfatal(BASE, false);
		expect(cleared & FLAG_SUPERFATAL).toBe(0);
		expect((cleared | FLAG_SUPERFATAL) >>> 0).toBe(BASE >>> 0);
	});

	it('setters preserve the reserved bits verbatim', () => {
		// Reserved = 2 (binary 10 in bits 11-10).
		const base = (0x80008000 | (0x2 << RESERVED_SHIFT)) >>> 0;
		const afterAi       = setAiSectionIndex(base, 0x1234);
		const afterSurface  = setSurfaceId(base, 0x2A);
		const afterTraffic  = setTrafficInfo(base, 0x7);
		const afterFatal    = setFlagFatal(base, true);
		const afterDrive    = setFlagDriveable(base, true);
		const afterSuperf   = setFlagSuperfatal(base, true);
		for (const x of [afterAi, afterSurface, afterTraffic, afterFatal, afterDrive, afterSuperf]) {
			expect((x & RESERVED_MASK) >>> RESERVED_SHIFT).toBe(0x2);
		}
	});

	it('setters preserve the material and group highest bits verbatim', () => {
		const base = 0x80008000 >>> 0;
		const groupHighU32 = (GROUP_HIGHEST_BIT << 16) >>> 0;
		expect(setAiSectionIndex(base, 0) & MATERIAL_HIGHEST_BIT).toBe(MATERIAL_HIGHEST_BIT);
		expect((setAiSectionIndex(base, 0) & groupHighU32) >>> 0).toBe(groupHighU32);
		expect(setSurfaceId(base, 0) & MATERIAL_HIGHEST_BIT).toBe(MATERIAL_HIGHEST_BIT);
		expect((setSurfaceId(base, 0) & groupHighU32) >>> 0).toBe(groupHighU32);
	});
});

describe('trafficInfoLabel', () => {
	it('labels 0 as "No lanes"', () => {
		expect(trafficInfoLabel(0)).toBe('No lanes');
	});

	it('labels 1 as "Unknown"', () => {
		expect(trafficInfoLabel(1)).toBe('Unknown');
	});

	it('produces a radian label for valid angles', () => {
		// 2 → 0 rad; 16 is out of range but the helper doesn't clamp
		expect(trafficInfoLabel(2)).toBe('0.000 rad');
		// 9 → ((9-2)/14) * 2π = π rad ≈ 3.142
		expect(trafficInfoLabel(9)).toBe('3.142 rad');
	});
});

// -----------------------------------------------------------------------------
// Fixture-wide transformation validator
// -----------------------------------------------------------------------------
//
// The plan's primary concern: "does material = low 16 / group = high 16 hold
// on real data?" Walk every polygon in every soup of every PSL resource in
// WORLDCOL.BIN. If any of (1) material highest bit set, (2) group highest
// bit set, (3) AI section index <= 20000, (4) encode-decode round-trip
// fails, the transformation is wrong and we should stop and try the
// alternatives in the plan.

describe('collisionTag transformation holds for every polygon in WORLDCOL.BIN', () => {
	it('decodes + encodes every polygon byte-exact', () => {
		const raw = fs.readFileSync(FIXTURE);
		const buffer = new Uint8Array(raw.byteLength);
		buffer.set(raw);
		const bundle = parseBundle(buffer.buffer);
		const ctx = resourceCtxFromBundle(bundle);
		const targets = bundle.resources.filter(
			(r) => r.resourceTypeId === POLYGON_SOUP_LIST_TYPE_ID,
		);

		let totalPolys = 0;
		let materialHighBitViolations = 0;
		let groupHighBitViolations = 0;
		let roundTripFailures = 0;
		let maxAiSection = 0;
		let aiSectionOverWikiCap = 0; // wiki's soft "~20000" bound, diagnostic only

		for (const r of targets) {
			const resourceBytes = extractResourceRaw(buffer.buffer, bundle, r);
			const model = parsePolygonSoupListData(resourceBytes, ctx.littleEndian);
			for (const soup of model.soups) {
				for (const poly of soup.polygons) {
					totalPolys++;
					const decoded = decodeCollisionTag(poly.collisionTag);
					if (!decoded.materialHighestBit) materialHighBitViolations++;
					if (!decoded.groupHighestBit) groupHighBitViolations++;
					if (decoded.aiSectionIndex > maxAiSection) maxAiSection = decoded.aiSectionIndex;
					if (decoded.aiSectionIndex > 20000) aiSectionOverWikiCap++;
					const re = encodeCollisionTag(decoded);
					if ((re >>> 0) !== (poly.collisionTag >>> 0)) roundTripFailures++;
				}
			}
		}

		console.log(
			`collisionTag fixture validator: ${totalPolys} polygons · ` +
				`${materialHighBitViolations} material-high-bit violations · ` +
				`${groupHighBitViolations} group-high-bit violations · ` +
				`${roundTripFailures} round-trip failures · ` +
				`max AI section index = ${maxAiSection} · ` +
				`${aiSectionOverWikiCap} over wiki's soft 20000 cap`,
		);

		// Hard requirements — if these fail, the transformation is wrong and
		// the plan's Alt A/B/C should be tried instead.
		expect(totalPolys).toBeGreaterThan(0);
		expect(materialHighBitViolations).toBe(0);
		expect(groupHighBitViolations).toBe(0);
		expect(roundTripFailures).toBe(0);
		// Sanity — must fit in 15 bits (this is guaranteed by the decoder,
		// but the assertion documents the invariant).
		expect(maxAiSection).toBeLessThanOrEqual(AI_SECTION_INDEX_MASK);
	});
});

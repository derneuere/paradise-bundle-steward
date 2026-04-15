// Tests for the pure collisionTag decode/encode module, plus a fixture-wide
// sanity check that validates the "material = HIGH 16, group = LOW 16"
// transformation against every polygon in example/WORLDCOL.BIN, including
// a bound-check against the real AI section count from AI.DAT so a
// regression on the half-placement can't silently slip past again.

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
import { parseAISectionsData } from './aiSections';

const FIXTURE = path.resolve(__dirname, '../../../example/WORLDCOL.BIN');
const AI_DAT = path.resolve(__dirname, '../../../example/AI.DAT');
const POLYGON_SOUP_LIST_TYPE_ID = 0x43;
const AI_SECTIONS_TYPE_ID = 0x10001;

/** "No section" sentinel — all 15 AI-section bits set. ~436k polygons in
 * vanilla WORLDCOL.BIN use this to opt out of having an AI section link. */
const NO_SECTION_SENTINEL = 0x7FFF;

// Curated values hitting every interesting bit pattern. Material lives in
// the HIGH u16 (bits 16-31), group in the LOW u16 (bits 0-15), so all
// material-side masks are shifted up by 16 when constructing u32 literals.
const ROUND_TRIP_VALUES = [
	0x80008000, // all zero except the two "highest bit" guards
	0xFFFFFFFF, // everything set
	0x800F8000, // material traffic = max, group empty
	0xA028806E, // user's screenshot value — material=0xA028 (driveable, surface 2, traffic 8), group=0x806E (AI=110)
	(0x80008000 | (FLAG_FATAL << 16)) >>> 0,                                                // fatal only
	(0x80008000 | (FLAG_DRIVEABLE << 16)) >>> 0,                                            // driveable only
	(0x80008000 | (FLAG_SUPERFATAL << 16)) >>> 0,                                           // superfatal only
	(0x80008000 | ((FLAG_FATAL | FLAG_DRIVEABLE | FLAG_SUPERFATAL) << 16)) >>> 0,           // all flags
	(0x80008000 | (0x0C00 << 16)) >>> 0,                                                    // reserved = 3
	(0x80008000 | (0x03F0 << 16)) >>> 0,                                                    // surface = 63
	0x8000FFFF,                                                                             // AI section = max
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
		// After the half swap: material = 0xA028 (HIGH u16), group = 0x806E (LOW u16)
		const decoded = decodeCollisionTag(0xA028806E);
		expect(decoded.materialHighestBit).toBe(true);
		expect(decoded.fatal).toBe(false);
		expect(decoded.driveable).toBe(true);   // 0xA028 bit 13 set
		expect(decoded.superfatal).toBe(false);
		expect(decoded.reserved).toBe(0);
		expect(decoded.surfaceId).toBe(2);      // 0xA028 bits 9-4 = 000010 = 2
		expect(decoded.trafficInfo).toBe(8);    // 0xA028 bits 3-0 = 1000 = 8 → valid angle
		expect(decoded.groupHighestBit).toBe(true);
		expect(decoded.aiSectionIndex).toBe(0x006E); // = 110
	});
});

describe('collisionTag per-field setters preserve everything else', () => {
	// Start from a raw with every interesting bit set, so we can catch any
	// setter that accidentally clobbers a neighboring field.
	const BASE = 0xFFFFFFFF;

	// Handy u32-level mirrors of the half-scoped constants. Material lives
	// in the HIGH u16, so material-side masks are shifted up by 16; group
	// lives in the LOW u16 and is used unshifted.
	const U32_MATERIAL_HIGHEST_BIT = (MATERIAL_HIGHEST_BIT << 16) >>> 0;
	const U32_GROUP_HIGHEST_BIT    = GROUP_HIGHEST_BIT >>> 0;
	const U32_FLAG_FATAL           = (FLAG_FATAL << 16) >>> 0;
	const U32_FLAG_DRIVEABLE       = (FLAG_DRIVEABLE << 16) >>> 0;
	const U32_FLAG_SUPERFATAL      = (FLAG_SUPERFATAL << 16) >>> 0;
	const U32_RESERVED_MASK        = (RESERVED_MASK << 16) >>> 0;
	const U32_SURFACE_ID_MASK      = (SURFACE_ID_MASK << 16) >>> 0;
	const U32_TRAFFIC_INFO_MASK    = (TRAFFIC_INFO_MASK << 16) >>> 0;

	it('setAiSectionIndex only touches bits 14-0 (low u16)', () => {
		const next = setAiSectionIndex(BASE, 0x1234);
		// Material half (HIGH u16) unchanged
		expect((next >>> 16) >>> 0).toBe((BASE >>> 16) >>> 0);
		// Group highest bit preserved
		expect(next & GROUP_HIGHEST_BIT).toBe(GROUP_HIGHEST_BIT);
		// AI section set
		expect(next & AI_SECTION_INDEX_MASK).toBe(0x1234);
	});

	it('setAiSectionIndex clamps out-of-range values into 15 bits', () => {
		const next = setAiSectionIndex(0x80008000, 0xFFFFF);
		expect(next & AI_SECTION_INDEX_MASK).toBe(AI_SECTION_INDEX_MASK);
		// Group highest bit still set
		expect(next & GROUP_HIGHEST_BIT).toBe(GROUP_HIGHEST_BIT);
	});

	it('setSurfaceId only touches bits 9-4 of the material half', () => {
		const next = setSurfaceId(BASE, 0x2A);
		// Other material bits (HIGH u16) unchanged
		expect(((next >>> 16) & ~SURFACE_ID_MASK) & 0xFFFF).toBe(((BASE >>> 16) & ~SURFACE_ID_MASK) & 0xFFFF);
		// Group half (LOW u16) unchanged
		expect(next & 0xFFFF).toBe(BASE & 0xFFFF);
		// Surface set
		expect(((next >>> 16) & SURFACE_ID_MASK) >>> SURFACE_ID_SHIFT).toBe(0x2A);
	});

	it('setSurfaceId clamps out-of-range values into 6 bits', () => {
		const next = setSurfaceId(0x80008000, 1000);
		expect(((next >>> 16) & SURFACE_ID_MASK) >>> SURFACE_ID_SHIFT).toBeLessThanOrEqual(0x3F);
	});

	it('setTrafficInfo only touches bits 3-0 of the material half', () => {
		const next = setTrafficInfo(BASE, 0x7);
		// Other material bits (HIGH u16) unchanged
		expect(((next >>> 16) & ~TRAFFIC_INFO_MASK) & 0xFFFF).toBe(((BASE >>> 16) & ~TRAFFIC_INFO_MASK) & 0xFFFF);
		// Group half (LOW u16) unchanged
		expect(next & 0xFFFF).toBe(BASE & 0xFFFF);
		// Traffic set
		expect((next >>> 16) & TRAFFIC_INFO_MASK).toBe(0x7);
	});

	it('setFlagFatal only toggles bit 14 of the material half', () => {
		const cleared = setFlagFatal(BASE, false);
		expect((cleared & U32_FLAG_FATAL) >>> 0).toBe(0);
		// Everything else in the u32 unchanged.
		expect(((cleared | U32_FLAG_FATAL) >>> 0)).toBe(BASE >>> 0);
		const restored = setFlagFatal(cleared, true);
		expect(restored >>> 0).toBe(BASE >>> 0);
	});

	it('setFlagDriveable only toggles bit 13 of the material half', () => {
		const cleared = setFlagDriveable(BASE, false);
		expect((cleared & U32_FLAG_DRIVEABLE) >>> 0).toBe(0);
		expect(((cleared | U32_FLAG_DRIVEABLE) >>> 0)).toBe(BASE >>> 0);
	});

	it('setFlagSuperfatal only toggles bit 12 of the material half', () => {
		const cleared = setFlagSuperfatal(BASE, false);
		expect((cleared & U32_FLAG_SUPERFATAL) >>> 0).toBe(0);
		expect(((cleared | U32_FLAG_SUPERFATAL) >>> 0)).toBe(BASE >>> 0);
	});

	it('setters preserve the reserved bits verbatim', () => {
		// Reserved = 2 (binary 10 in bits 11-10 of the material u16, i.e.
		// bits 27-26 of the u32).
		const base = (0x80008000 | ((0x2 << RESERVED_SHIFT) << 16)) >>> 0;
		const afterAi       = setAiSectionIndex(base, 0x1234);
		const afterSurface  = setSurfaceId(base, 0x2A);
		const afterTraffic  = setTrafficInfo(base, 0x7);
		const afterFatal    = setFlagFatal(base, true);
		const afterDrive    = setFlagDriveable(base, true);
		const afterSuperf   = setFlagSuperfatal(base, true);
		for (const x of [afterAi, afterSurface, afterTraffic, afterFatal, afterDrive, afterSuperf]) {
			expect(((x & U32_RESERVED_MASK) >>> 0) >>> (RESERVED_SHIFT + 16)).toBe(0x2);
		}
	});

	it('setters preserve the material and group highest bits verbatim', () => {
		const base = 0x80008000 >>> 0;
		expect((setAiSectionIndex(base, 0) & U32_MATERIAL_HIGHEST_BIT) >>> 0).toBe(U32_MATERIAL_HIGHEST_BIT);
		expect(setAiSectionIndex(base, 0) & U32_GROUP_HIGHEST_BIT).toBe(U32_GROUP_HIGHEST_BIT);
		expect((setSurfaceId(base, 0) & U32_MATERIAL_HIGHEST_BIT) >>> 0).toBe(U32_MATERIAL_HIGHEST_BIT);
		expect(setSurfaceId(base, 0) & U32_GROUP_HIGHEST_BIT).toBe(U32_GROUP_HIGHEST_BIT);
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
// Walk every polygon in every soup of every PSL resource in WORLDCOL.BIN and
// verify that under the corrected half placement (material = HIGH u16,
// group = LOW u16), every decoded AI section index either names a real
// section from AI.DAT or equals the "no section" sentinel 0x7FFF. This
// would have caught the original half-swap bug on day one — it wasn't
// caught because the previous version only bounded max by 0x7FFF.

describe('collisionTag transformation holds for every polygon in WORLDCOL.BIN', () => {
	it('decodes + encodes every polygon byte-exact', () => {
		// Ground truth: the real section count comes from AI.DAT.
		const aiRaw = fs.readFileSync(AI_DAT);
		const aiBuf = new Uint8Array(aiRaw.byteLength);
		aiBuf.set(aiRaw);
		const aiBundle = parseBundle(aiBuf.buffer);
		const aiCtx = resourceCtxFromBundle(aiBundle);
		const aiRes = aiBundle.resources.find((r) => r.resourceTypeId === AI_SECTIONS_TYPE_ID);
		expect(aiRes).toBeDefined();
		const aiModel = parseAISectionsData(
			extractResourceRaw(aiBuf.buffer, aiBundle, aiRes!),
			aiCtx.littleEndian,
		);
		const sectionCount = aiModel.sections.length;

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
		let outOfRangeSections = 0;
		let sentinelPolys = 0;
		let maxRealAiSection = 0;

		for (const r of targets) {
			const resourceBytes = extractResourceRaw(buffer.buffer, bundle, r);
			const model = parsePolygonSoupListData(resourceBytes, ctx.littleEndian);
			for (const soup of model.soups) {
				for (const poly of soup.polygons) {
					totalPolys++;
					const decoded = decodeCollisionTag(poly.collisionTag);
					if (!decoded.materialHighestBit) materialHighBitViolations++;
					if (!decoded.groupHighestBit) groupHighBitViolations++;
					const ai = decoded.aiSectionIndex;
					if (ai === NO_SECTION_SENTINEL) {
						sentinelPolys++;
					} else if (ai >= sectionCount) {
						outOfRangeSections++;
					} else if (ai > maxRealAiSection) {
						maxRealAiSection = ai;
					}
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
				`${sentinelPolys} sentinel (0x7FFF) · ` +
				`max real AI section = ${maxRealAiSection}/${sectionCount} · ` +
				`${outOfRangeSections} out-of-range`,
		);

		// Hard requirements — if ANY of these fail the decoder is broken.
		expect(totalPolys).toBeGreaterThan(0);
		expect(materialHighBitViolations).toBe(0);
		expect(groupHighBitViolations).toBe(0);
		expect(roundTripFailures).toBe(0);
		// Every AI section reference must either be a real section index or
		// the "no section" sentinel. A non-zero outOfRange count means the
		// half placement is wrong again.
		expect(outOfRangeSections).toBe(0);
	});
});

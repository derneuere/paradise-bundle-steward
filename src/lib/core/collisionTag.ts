// Decoded view of BrnWorld::CollisionTag — the u32 stored in every
// PolygonSoupPoly.collisionTag slot. Pure module: no React, no imports.
//
// Layout — empirical, NOT what the wiki paragraph says on first read:
//
//   When the parser calls readU32LE on the 4 bytes of a polygon's collision
//   tag, the GROUP tag (AI section index) lands in bits 0-15 of the u32,
//   and the MATERIAL tag (flags / surface / traffic) lands in bits 16-31.
//
//   This was verified empirically against example/WORLDCOL.BIN (920,928
//   polygons, 428 PolygonSoupList resources). The HIGH u16 clusters into a
//   handful of material-tag patterns (0x8420, 0x8480, 0xA020, 0xC420, ...)
//   — the top few are the wiki example's "wreck" (FATAL + surface 2) and
//   driveable road variants. The LOW u16 yields 8614 distinct values that
//   each map 1:1 to AI section references; e.g. section 7756 (which sits
//   at the OTN-tunnel BSI per the game data) appears as lo=0x9E4C on 47
//   polygons, and every section index 7714-7800 shows up densely.
//
//   The wiki's docs/PolygonSoupList.md "Collision tag" section uses the
//   opposite convention ("material at offset 0x0, group at 0x2, byteswapped
//   as 32-bit field") and its own worked example `84 20 95 C1` can't be
//   reconstructed from those bytes under any byte ordering — treat the
//   bit-field tables as correct but ignore the half placement and example.
//
//   Material (HIGH u16, bits 16-31):
//     bit 15         Highest bit (always set — preserved verbatim)
//     bit 14  0x4000 Flag: Fatal          (KU_COLLISION_FLAG_FATAL, legacy "wreck")
//     bit 13  0x2000 Flag: Driveable      (KU_COLLISION_FLAG_DRIVEABLE)
//     bit 12  0x1000 Flag: Superfatal     (KU_COLLISION_FLAG_SUPERFATAL)
//     bits 11-10     Reserved (wiki TODO: not unused anymore — preserved verbatim)
//     bits 9-4       Surface ID (0-63)
//     bits 3-0       Traffic info (0-15)
//
//   Group (LOW u16, bits 0-15):
//     bit 15         Highest bit (always set — preserved verbatim)
//     bits 14-0      AI section index (0-32767). 0x7FFF is a sentinel "no
//                    section" used by ~436k polygons in vanilla WORLDCOL.
//
// Round-trip contract: `encodeCollisionTag(decodeCollisionTag(raw)) === raw`
// for every raw u32. The per-field setters are surgical — they only touch
// bits inside the named field and leave every other bit (including the
// highest-bit guards and the reserved bits) byte-for-byte identical.

// =============================================================================
// u16-level bit masks (match KU_COLLISION_FLAG_* from the wiki)
// =============================================================================

/** `KU_COLLISION_FLAG_SUPERFATAL` — bit 12 of the material half. */
export const FLAG_SUPERFATAL = 0x1000;
/** `KU_COLLISION_FLAG_DRIVEABLE` — bit 13 of the material half. */
export const FLAG_DRIVEABLE = 0x2000;
/** `KU_COLLISION_FLAG_FATAL` — bit 14 of the material half. Legacy tool calls this "wreck surface". */
export const FLAG_FATAL = 0x4000;

/** Bit 15 of the material half. Always set in real fixture data. */
export const MATERIAL_HIGHEST_BIT = 0x8000;
/** Bit 15 of the group half. Always set in real fixture data. */
export const GROUP_HIGHEST_BIT = 0x8000;

/** Bits 11-10 of the material half. Reserved — preserve verbatim. */
export const RESERVED_MASK = 0x0C00;
export const RESERVED_SHIFT = 10;

/** Bits 9-4 of the material half. */
export const SURFACE_ID_MASK = 0x03F0;
export const SURFACE_ID_SHIFT = 4;
/** Max surface ID (6 bits). */
export const SURFACE_ID_MAX = 0x3F;

/** Bits 3-0 of the material half. */
export const TRAFFIC_INFO_MASK = 0x000F;
/** Max traffic info (4 bits). */
export const TRAFFIC_INFO_MAX = 0xF;

/** Bits 14-0 of the group half. */
export const AI_SECTION_INDEX_MASK = 0x7FFF;
/** Max AI section index (15 bits). */
export const AI_SECTION_INDEX_MAX = 0x7FFF;

// =============================================================================
// u32-level masks (group in bits 0-15, material in bits 16-31)
// =============================================================================

const LO = (mask: number) => mask >>> 0;          // low  u16 = bits 0-15  (group)
const HI = (mask: number) => (mask << 16) >>> 0;  // high u16 = bits 16-31 (material)

const U32_FLAG_FATAL        = HI(FLAG_FATAL);
const U32_FLAG_DRIVEABLE    = HI(FLAG_DRIVEABLE);
const U32_FLAG_SUPERFATAL   = HI(FLAG_SUPERFATAL);
const U32_SURFACE_ID_MASK   = HI(SURFACE_ID_MASK);
const U32_TRAFFIC_INFO_MASK = HI(TRAFFIC_INFO_MASK);
const U32_AI_SECTION_MASK   = LO(AI_SECTION_INDEX_MASK);

// =============================================================================
// Types
// =============================================================================

export type DecodedCollisionTag = {
	/** Material bit 15. Always true in real data — preserved verbatim. */
	materialHighestBit: boolean;
	/** Material bit 14 — `KU_COLLISION_FLAG_FATAL`. */
	fatal: boolean;
	/** Material bit 13 — `KU_COLLISION_FLAG_DRIVEABLE`. */
	driveable: boolean;
	/** Material bit 12 — `KU_COLLISION_FLAG_SUPERFATAL`. */
	superfatal: boolean;
	/** Material bits 11-10. 0-3. Reserved — preserved verbatim. */
	reserved: number;
	/** Material bits 9-4. 0-63. */
	surfaceId: number;
	/** Material bits 3-0. 0-15. */
	trafficInfo: number;

	/** Group bit 15. Always true in real data — preserved verbatim. */
	groupHighestBit: boolean;
	/** Group bits 14-0. 0-32767 — indexes into AISections.sections. */
	aiSectionIndex: number;
};

// =============================================================================
// Decode / encode
// =============================================================================

export function decodeCollisionTag(raw: number): DecodedCollisionTag {
	const r = raw >>> 0;
	const group    = r & 0xFFFF;
	const material = (r >>> 16) & 0xFFFF;
	return {
		materialHighestBit: (material & MATERIAL_HIGHEST_BIT) !== 0,
		fatal:              (material & FLAG_FATAL) !== 0,
		driveable:          (material & FLAG_DRIVEABLE) !== 0,
		superfatal:         (material & FLAG_SUPERFATAL) !== 0,
		reserved:           (material & RESERVED_MASK) >>> RESERVED_SHIFT,
		surfaceId:          (material & SURFACE_ID_MASK) >>> SURFACE_ID_SHIFT,
		trafficInfo:         material & TRAFFIC_INFO_MASK,
		groupHighestBit:    (group & GROUP_HIGHEST_BIT) !== 0,
		aiSectionIndex:      group & AI_SECTION_INDEX_MASK,
	};
}

export function encodeCollisionTag(d: DecodedCollisionTag): number {
	const material =
		(d.materialHighestBit ? MATERIAL_HIGHEST_BIT : 0) |
		(d.fatal ? FLAG_FATAL : 0) |
		(d.driveable ? FLAG_DRIVEABLE : 0) |
		(d.superfatal ? FLAG_SUPERFATAL : 0) |
		((d.reserved << RESERVED_SHIFT) & RESERVED_MASK) |
		((d.surfaceId << SURFACE_ID_SHIFT) & SURFACE_ID_MASK) |
		(d.trafficInfo & TRAFFIC_INFO_MASK);
	const group =
		(d.groupHighestBit ? GROUP_HIGHEST_BIT : 0) |
		(d.aiSectionIndex & AI_SECTION_INDEX_MASK);
	return (((material & 0xFFFF) << 16) | (group & 0xFFFF)) >>> 0;
}

// =============================================================================
// Surgical per-field setters
// =============================================================================
//
// Each setter clears exactly the bits it owns and pastes the new value back.
// Everything else — including the two "highest bit" guards and the reserved
// bits — is preserved byte-for-byte, which is what guarantees a byte-exact
// round-trip when editing one field leaves the other half untouched.

export function setAiSectionIndex(raw: number, value: number): number {
	const clamped = (value & AI_SECTION_INDEX_MASK) >>> 0;
	// Group is the LOW u16 — write the index at bit 0.
	return (((raw >>> 0) & ~U32_AI_SECTION_MASK) | clamped) >>> 0;
}

export function setSurfaceId(raw: number, value: number): number {
	const clamped = value & SURFACE_ID_MAX;
	// Material is the HIGH u16 — position the field within the u16, then
	// shift the whole thing up by 16 into bits 16-31 of the u32.
	return (((raw >>> 0) & ~U32_SURFACE_ID_MASK) | ((clamped << SURFACE_ID_SHIFT) << 16)) >>> 0;
}

export function setTrafficInfo(raw: number, value: number): number {
	const clamped = value & TRAFFIC_INFO_MAX;
	// Material traffic field sits at bits 3-0 of the material u16, i.e.
	// bits 19-16 of the u32 — just shift up by 16.
	return (((raw >>> 0) & ~U32_TRAFFIC_INFO_MASK) | (clamped << 16)) >>> 0;
}

export function setFlagFatal(raw: number, value: boolean): number {
	return (((raw >>> 0) & ~U32_FLAG_FATAL) | (value ? U32_FLAG_FATAL : 0)) >>> 0;
}

export function setFlagDriveable(raw: number, value: boolean): number {
	return (((raw >>> 0) & ~U32_FLAG_DRIVEABLE) | (value ? U32_FLAG_DRIVEABLE : 0)) >>> 0;
}

export function setFlagSuperfatal(raw: number, value: boolean): number {
	return (((raw >>> 0) & ~U32_FLAG_SUPERFATAL) | (value ? U32_FLAG_SUPERFATAL : 0)) >>> 0;
}

// =============================================================================
// Human-readable helpers
// =============================================================================

/**
 * Interpret the 4-bit traffic info field. See `BrnWorld::TrafficDirection`:
 *   0            → `E_TRAFFIC_DIRECTION_NO_LANES`  ("No lanes")
 *   1            → `E_TRAFFIC_DIRECTION_UNKNOWN`
 *   2-15         → `E_TRAFFIC_DIRECTION_VALID`, angle in radians = `(v - 2) / 14 * 2π`
 */
export function trafficInfoLabel(v: number): string {
	if (v === 0) return 'No lanes';
	if (v === 1) return 'Unknown';
	const rad = ((v - 2) / 14) * 2 * Math.PI;
	return `${rad.toFixed(3)} rad`;
}

/** Format a raw collision tag as an 8-digit uppercase hex string with `0x` prefix. */
export function formatCollisionTagHex(raw: number): string {
	return `0x${(raw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

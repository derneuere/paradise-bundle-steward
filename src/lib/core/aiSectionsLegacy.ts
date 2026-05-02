// Legacy AISections parser and writer (Burnout 5 prototype builds)
// Resource type ID: 0x10001 (same as retail)
//
// Versions covered:
//   - Version 4: Burnout 5 (2006-11-13 X360 dev build).
//   - Version 6: Burnout 5 (2007-02-22 build).
//
// Wiki: https://burnout.wiki — "AI Sections" page, "Versions" section.
//
// Binary layout (32-bit, endian per bundle platform):
//   [BrnAI::AISectionsData header]   0x10 bytes
//   [BrnAI::AISection array]         numSections * 0x30 (V4) or 0x34 (V6)
//   per-section payload, in section order:
//     [Portal headers]                numPortals * 0x20
//     [Portal BoundaryLines]          sum(BL counts) * 0x10
//     [NoGo BoundaryLines]            numNoGo * 0x10
//
// The retail (v12) format is *different shape*: it adds per-speed limits
// and a SectionResetPair table to the header, gives each section an `id`
// and `speed` enum, and stores corners via a pointer instead of inline.
// That parser/writer lives in aiSections.ts; this module is dispatched
// when the muVersion field reads as 4 or 6.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Constants
// =============================================================================

/** Versions this module knows how to parse and write. */
export const LEGACY_AI_SECTION_VERSIONS = [4, 6] as const;
export type LegacyAISectionsVersion = typeof LEGACY_AI_SECTION_VERSIONS[number];

export const CORNERS_PER_LEGACY_SECTION = 4;

const LEGACY_HEADER_SIZE = 0x10;
const PORTAL_SIZE = 0x20;
const BOUNDARY_LINE_SIZE = 0x10;
const SECTION_SIZE_V4 = 0x30;
const SECTION_SIZE_V6 = 0x34;

// =============================================================================
// Enumerations
// =============================================================================

/** BrnAI::AISection::DangerRating — same values in both V4 and V6. */
export enum LegacyDangerRating {
	E_DANGER_RATING_FREEWAY = 0,
	E_DANGER_RATING_NORMAL = 1,
	E_DANGER_RATING_DANGEROUS = 2,
}

/** Section flags. The V4 build only has bit 0x01 ("?", possibly in-air);
 *  V6 expanded the set. We expose them as distinct enums so the V6 names
 *  don't accidentally bleed into V4 readers. */
export enum LegacyAISectionFlagV4 {
	NONE = 0x00,
	UNKNOWN_BIT0 = 0x01,
}

export enum LegacyAISectionFlagV6 {
	NONE = 0x00,
	IS_IN_AIR = 0x01,
	IS_SHORTCUT = 0x02,
	IS_JUNCTION = 0x04,
}

/** BrnAI::EDistrict — V6 only. Always 0 in retail data. */
export enum LegacyEDistrict {
	E_DISTRICT_SUBURBS = 0,
	E_DISTRICT_INDUSTRIAL = 1,
	E_DISTRICT_COUNTRY = 2,
	E_DISTRICT_CITY = 3,
	E_DISTRICT_AIRPORT = 4,
}

// =============================================================================
// Types
// =============================================================================

export type LegacyVector4 = { x: number; y: number; z: number; w: number };

export type LegacyBoundaryLine = {
	verts: LegacyVector4; // (startX, startY, endX, endY) packed into xyzw
};

export type LegacyPortal = {
	// `vpu::Vector3` on the wire is 16 bytes (xyz + 4 bytes of structural
	// padding). The 4th float is preserved verbatim — it's typically zero
	// but we keep it round-trippable in case any fixture uses it.
	midPosition: LegacyVector4;
	boundaryLines: LegacyBoundaryLine[];
	linkSection: number; // u16 — index of the AISection on the other side
};

export type LegacyAISection = {
	portals: LegacyPortal[];
	noGoLines: LegacyBoundaryLine[];
	cornersX: number[]; // float32[4]
	cornersZ: number[]; // float32[4]
	dangerRating: number; // u8 — see LegacyDangerRating
	flags: number;        // u8 bitmask — see LegacyAISectionFlag{V4,V6}
	// V6 only — undefined for V4 sections.
	spanIndex?: number;   // i32 — StreetData span index (-1 = none)
	district?: number;    // u8 — see LegacyEDistrict (always 0 in retail)
};

export type LegacyAISectionsData = {
	version: LegacyAISectionsVersion;
	sections: LegacyAISection[];
};

// =============================================================================
// Detection
// =============================================================================

/**
 * Peek the muVersion field at offset 0x8 to decide whether the payload is
 * a legacy (V4/V6) AISections resource. Returns the version when matched,
 * or null when the bytes look like a different layout (e.g. retail v12).
 *
 * V12 stores muVersion at offset 0x38 — its offset 0x8 holds a float
 * (sectionMinSpeeds[0]), which would never coincidentally read as 4 or 6.
 */
export function detectLegacyVersion(raw: Uint8Array, littleEndian: boolean): LegacyAISectionsVersion | null {
	if (raw.byteLength < LEGACY_HEADER_SIZE) return null;
	const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
	const version = dv.getUint32(0x8, littleEndian);
	return (version === 4 || version === 6) ? version : null;
}

// =============================================================================
// Parsing
// =============================================================================

export function parseLegacyAISectionsData(raw: Uint8Array, littleEndian: boolean = true): LegacyAISectionsData {
	const r = new BinReader(
		raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
		littleEndian,
	);

	// ---- Header (0x10) ----
	const sectionsOffset = r.readU32(); // 0x0  mpaSections
	const numSections    = r.readU32(); // 0x4  muNumSections
	const version        = r.readU32(); // 0x8  muVersion
	/* muSizeInBytes */    r.readU32(); // 0xC  back-patched by the writer

	if (version !== 4 && version !== 6) {
		throw new Error(
			`parseLegacyAISectionsData: unsupported version ${version} ` +
			`(expected ${LEGACY_AI_SECTION_VERSIONS.join(' or ')})`,
		);
	}
	const sectionSize = version === 6 ? SECTION_SIZE_V6 : SECTION_SIZE_V4;

	// ---- Section header table ----
	type RawSectionHeader = {
		portalsOff: number;
		noGoOff: number;
		cornersX: number[];
		cornersZ: number[];
		spanIndex?: number;
		numNoGoLines: number;
		numPortals: number;
		dangerRating: number;
		district?: number;
		flags: number;
	};

	const rawHeaders: RawSectionHeader[] = [];
	r.position = sectionsOffset;
	for (let i = 0; i < numSections; i++) {
		const portalsOff = r.readU32();
		const noGoOff    = r.readU32();
		const cornersX = [r.readF32(), r.readF32(), r.readF32(), r.readF32()];
		const cornersZ = [r.readF32(), r.readF32(), r.readF32(), r.readF32()];

		if (version === 6) {
			const spanIndex    = r.readI32();
			const numNoGoLines = r.readU16();
			const numPortals   = r.readU8();
			const dangerRating = r.readU8();
			const district     = r.readU8();
			const flags        = r.readU8();
			r.readU8(); r.readU8(); // 2 bytes pad (mu8Pad)
			rawHeaders.push({ portalsOff, noGoOff, cornersX, cornersZ, spanIndex, numNoGoLines, numPortals, dangerRating, district, flags });
		} else {
			const numNoGoLines = r.readU16();
			const numPortals   = r.readU8();
			const dangerRating = r.readU8();
			const flags        = r.readU8();
			r.readU8(); r.readU8(); r.readU8(); // 3 bytes pad (mu8Pad)
			rawHeaders.push({ portalsOff, noGoOff, cornersX, cornersZ, numNoGoLines, numPortals, dangerRating, flags });
		}
	}

	// ---- Per-section payloads ----
	const sections: LegacyAISection[] = [];
	for (let i = 0; i < numSections; i++) {
		const h = rawHeaders[i];

		// Portals — read all headers first so we know each portal's BL pointer.
		const portalHeaders: { mid: LegacyVector4; blOff: number; link: number; blCount: number }[] = [];
		r.position = h.portalsOff;
		for (let p = 0; p < h.numPortals; p++) {
			const mid: LegacyVector4 = {
				x: r.readF32(),
				y: r.readF32(),
				z: r.readF32(),
				w: r.readF32(),
			};
			const blOff   = r.readU32();
			const link    = r.readU16();
			const blCount = r.readU8();
			// Trailing 9 bytes of padding (mau8Pad[5] + 4 trailing pad bytes).
			r.readU8();
			r.readU8(); r.readU8(); r.readU8(); r.readU8();
			r.readU8(); r.readU8(); r.readU8(); r.readU8();
			portalHeaders.push({ mid, blOff, link, blCount });
		}

		const portals: LegacyPortal[] = [];
		for (const ph of portalHeaders) {
			const boundaryLines: LegacyBoundaryLine[] = [];
			r.position = ph.blOff;
			for (let b = 0; b < ph.blCount; b++) {
				boundaryLines.push({ verts: { x: r.readF32(), y: r.readF32(), z: r.readF32(), w: r.readF32() } });
			}
			portals.push({ midPosition: ph.mid, boundaryLines, linkSection: ph.link });
		}

		// NoGo lines.
		const noGoLines: LegacyBoundaryLine[] = [];
		r.position = h.noGoOff;
		for (let n = 0; n < h.numNoGoLines; n++) {
			noGoLines.push({ verts: { x: r.readF32(), y: r.readF32(), z: r.readF32(), w: r.readF32() } });
		}

		const section: LegacyAISection = {
			portals,
			noGoLines,
			cornersX: h.cornersX,
			cornersZ: h.cornersZ,
			dangerRating: h.dangerRating,
			flags: h.flags,
		};
		if (version === 6) {
			section.spanIndex = h.spanIndex;
			section.district = h.district;
		}
		sections.push(section);
	}

	return { version, sections };
}

// =============================================================================
// Writing
// =============================================================================

export function writeLegacyAISectionsData(model: LegacyAISectionsData, littleEndian: boolean = true): Uint8Array {
	const version = model.version;
	if (version !== 4 && version !== 6) {
		throw new Error(
			`writeLegacyAISectionsData: unsupported version ${version} ` +
			`(expected ${LEGACY_AI_SECTION_VERSIONS.join(' or ')})`,
		);
	}
	const sectionSize = version === 6 ? SECTION_SIZE_V6 : SECTION_SIZE_V4;
	const numSections = model.sections.length;

	// Pre-compute payload size for an exact buffer allocation.
	let payloadSize = 0;
	for (const s of model.sections) {
		let portalBLs = 0;
		for (const p of s.portals) portalBLs += p.boundaryLines.length;
		payloadSize += s.portals.length * PORTAL_SIZE
		            +  portalBLs * BOUNDARY_LINE_SIZE
		            +  s.noGoLines.length * BOUNDARY_LINE_SIZE;
	}
	const totalSize = LEGACY_HEADER_SIZE + numSections * sectionSize + payloadSize;

	const w = new BinWriter(totalSize, littleEndian);

	// ---- Header ----
	const headerSectionsPos = w.offset; w.writeU32(0); // mpaSections placeholder
	w.writeU32(numSections);
	w.writeU32(version);
	const sizeFieldPos = w.offset; w.writeU32(0); // muSizeInBytes placeholder

	// ---- Section header table ----
	const sectionArrayStart = w.offset;
	w.setU32(headerSectionsPos, sectionArrayStart);

	type SectionSlot = { portalsPos: number; noGoPos: number };
	const slots: SectionSlot[] = [];
	for (let i = 0; i < numSections; i++) {
		const s = model.sections[i];
		const portalsPos = w.offset; w.writeU32(0); // mpaPortals placeholder
		const noGoPos    = w.offset; w.writeU32(0); // mpaNoGoLines placeholder

		// Corners are stored inline in the header (not via a pointer like v12).
		for (let c = 0; c < CORNERS_PER_LEGACY_SECTION; c++) w.writeF32(s.cornersX[c] ?? 0);
		for (let c = 0; c < CORNERS_PER_LEGACY_SECTION; c++) w.writeF32(s.cornersZ[c] ?? 0);

		if (version === 6) {
			w.writeI32(s.spanIndex ?? -1);
			w.writeU16(s.noGoLines.length);
			w.writeU8(s.portals.length);
			w.writeU8(s.dangerRating & 0xFF);
			w.writeU8((s.district ?? 0) & 0xFF);
			w.writeU8(s.flags & 0xFF);
			w.writeU8(0); w.writeU8(0); // mu8Pad[2]
		} else {
			w.writeU16(s.noGoLines.length);
			w.writeU8(s.portals.length);
			w.writeU8(s.dangerRating & 0xFF);
			w.writeU8(s.flags & 0xFF);
			w.writeU8(0); w.writeU8(0); w.writeU8(0); // mu8Pad[3]
		}

		slots.push({ portalsPos, noGoPos });
	}

	// ---- Per-section payloads ----
	// Layout per section: portal headers → portal boundary lines → nogo lines.
	for (let i = 0; i < numSections; i++) {
		const s = model.sections[i];
		const slot = slots[i];

		// -- Portal headers (back-patch their BL pointers as we go) --
		w.setU32(slot.portalsPos, w.offset);
		const portalBLSlots: { pos: number; lines: LegacyBoundaryLine[] }[] = [];
		for (const portal of s.portals) {
			w.writeF32(portal.midPosition.x);
			w.writeF32(portal.midPosition.y);
			w.writeF32(portal.midPosition.z);
			w.writeF32(portal.midPosition.w);
			const blPos = w.offset; w.writeU32(0); // mpaBoundaryLines placeholder
			w.writeU16(portal.linkSection);
			w.writeU8(portal.boundaryLines.length);
			// 9 trailing pad bytes (mau8Pad[5] + 4 trailing pad).
			for (let p = 0; p < 9; p++) w.writeU8(0);
			portalBLSlots.push({ pos: blPos, lines: portal.boundaryLines });
		}

		// -- Portal boundary lines (no alignment — portal stride is already 16) --
		for (const pbl of portalBLSlots) {
			w.setU32(pbl.pos, w.offset);
			for (const bl of pbl.lines) {
				w.writeF32(bl.verts.x);
				w.writeF32(bl.verts.y);
				w.writeF32(bl.verts.z);
				w.writeF32(bl.verts.w);
			}
		}

		// -- NoGo lines --
		w.setU32(slot.noGoPos, w.offset);
		for (const bl of s.noGoLines) {
			w.writeF32(bl.verts.x);
			w.writeF32(bl.verts.y);
			w.writeF32(bl.verts.z);
			w.writeF32(bl.verts.w);
		}
	}

	// ---- Back-patch muSizeInBytes ----
	w.setU32(sizeFieldPos, w.offset);

	return w.bytes;
}

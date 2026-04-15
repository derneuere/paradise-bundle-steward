// AISections (AIMapData / WorldMapData) parser and writer
// Resource type ID: 0x10001
//
// Binary layout (32-bit LE):
//   [AISectionsData header]  0x40 bytes
//   [AISection array]        numSections * 0x18
//   [per-section payloads]   portals, portal BLs, nogo lines, 4 corners each
//   [SectionResetPair array] numResetPairs * 0x8

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Constants
// =============================================================================

export const AI_SECTIONS_VERSION = 12;
export const CORNERS_PER_SECTION = 4;

// =============================================================================
// Enumerations
// =============================================================================

export enum SectionSpeed {
	E_SECTION_SPEED_VERY_SLOW = 0,
	E_SECTION_SPEED_SLOW = 1,
	E_SECTION_SPEED_NORMAL = 2,
	E_SECTION_SPEED_FAST = 3,
	E_SECTION_SPEED_VERY_FAST = 4,
}

export const SECTION_SPEED_COUNT = 5;

export enum AISectionFlag {
	SHORTCUT          = 0x01,
	NO_RESET          = 0x02,
	IN_AIR            = 0x04,
	SPLIT             = 0x08,
	JUNCTION          = 0x10,
	TERMINATOR        = 0x20,
	AI_SHORTCUT       = 0x40,
	AI_INTERSTATE_EXIT = 0x80,
}

export enum EResetSpeedType {
	E_RESET_SPEED_TYPE_CUSTOM = 0,
	E_RESET_SPEED_TYPE_NONE = 1,
	E_RESET_SPEED_TYPE_SLOW = 2,
	E_RESET_SPEED_TYPE_FAST = 3,
	E_RESET_SPEED_TYPE_SLOW_NORTH_FACE = 4,
	E_RESET_SPEED_TYPE_SLOW_SOUTH_FACE = 5,
	E_RESET_SPEED_TYPE_SLOW_EAST_FACE = 6,
	E_RESET_SPEED_TYPE_SLOW_WEST_FACE = 7,
	E_RESET_SPEED_TYPE_SLOW_REVERSE = 8,
	E_RESET_SPEED_TYPE_STOP_REVERSE = 9,
	E_RESET_SPEED_TYPE_STOP_NORTH_FACE = 10,
	E_RESET_SPEED_TYPE_STOP_SOUTH_FACE = 11,
	E_RESET_SPEED_TYPE_STOP_EAST_FACE = 12,
	E_RESET_SPEED_TYPE_STOP_WEST_FACE = 13,
	E_RESET_SPEED_TYPE_STOP_NORTH_EAST_FACE = 14,
	E_RESET_SPEED_TYPE_STOP_SOUTH_WEST_FACE = 15,
	E_RESET_SPEED_TYPE_NONE_AND_IGNORE = 16,
	E_RESET_SPEED_TYPE_WEST_AND_IGNORE = 17,
	E_RESET_SPEED_TYPE_REVERSE_AND_IGNORE = 18,
	E_RESET_SPEED_TYPE_REVERSE_AND_IGNORE_SLOW = 19,
	E_RESET_SPEED_TYPE_EAST_AND_IGNORE = 20,
}

// =============================================================================
// Types
// =============================================================================

export type Vector2 = { x: number; y: number };
export type Vector3 = { x: number; y: number; z: number };
export type Vector4 = { x: number; y: number; z: number; w: number };

export type BoundaryLine = {
	verts: Vector4; // (startX, startY, endX, endY) packed into xyzw
};

export type Portal = {
	// 3D anchor point in world space. Binary layout is still three contiguous
	// floats (positionX / positionY / positionZ at offset 0/4/8 inside the
	// portal header); the parser groups them into a Vector3 so the schema can
	// tag it with `swapYZ` and the editor can render a single swapped vec3
	// input instead of three flat float fields.
	position: Vector3;
	boundaryLines: BoundaryLine[];
	linkSection: number;   // u16 section index
};

export type AISection = {
	portals: Portal[];
	noGoLines: BoundaryLine[];
	corners: Vector2[];        // always 4 in retail data
	id: number;                // AISectionId (u32)
	spanIndex: number;         // i16
	speed: SectionSpeed;       // u8
	district: number;          // u8 — always 0 in retail
	flags: number;             // u8 bitmask (AISectionFlag)
};

export type SectionResetPair = {
	resetSpeed: EResetSpeedType;
	startSectionIndex: number; // u16
	resetSectionIndex: number; // u16
};

export type ParsedAISections = {
	version: number;
	sectionMinSpeeds: number[];  // float32[5]
	sectionMaxSpeeds: number[];  // float32[5]
	sections: AISection[];
	sectionResetPairs: SectionResetPair[];
};

// =============================================================================
// Parsing
// =============================================================================

export function parseAISectionsData(raw: Uint8Array, littleEndian: boolean = true): ParsedAISections {
	const r = new BinReader(
		raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
		littleEndian,
	);

	// ---- Header (0x40 bytes, 32-bit) ----
	const sectionsOffset   = r.readU32();  // 0x00
	const resetPairsOffset = r.readU32();  // 0x04

	const sectionMinSpeeds: number[] = [];
	for (let i = 0; i < SECTION_SPEED_COUNT; i++) sectionMinSpeeds.push(r.readF32());

	const sectionMaxSpeeds: number[] = [];
	for (let i = 0; i < SECTION_SPEED_COUNT; i++) sectionMaxSpeeds.push(r.readF32());

	const numSections          = r.readU32(); // 0x30
	const numSectionResetPairs = r.readU32(); // 0x34
	const version              = r.readU32(); // 0x38
	/* muSizeInBytes */          r.readU32(); // 0x3C

	// ---- Section headers ----
	// Each section header is 0x18 bytes with pointers to per-section data.
	type RawSectionHeader = {
		portalsOff: number;
		noGoOff: number;
		cornersOff: number;
		id: number;
		spanIndex: number;
		numNoGoLines: number;
		numPortals: number;
		speed: number;
		district: number;
		flags: number;
	};

	r.position = sectionsOffset;
	const rawHeaders: RawSectionHeader[] = [];
	for (let i = 0; i < numSections; i++) {
		rawHeaders.push({
			portalsOff:   r.readU32(),
			noGoOff:      r.readU32(),
			cornersOff:   r.readU32(),
			id:           r.readU32(),
			spanIndex:    r.readI16(),
			numNoGoLines: r.readU16(),
			numPortals:   r.readU8(),
			speed:        r.readU8(),
			district:     r.readU8(),
			flags:        r.readU8(),
		});
	}

	// ---- Per-section data ----
	const sections: AISection[] = [];
	for (let i = 0; i < numSections; i++) {
		const h = rawHeaders[i];

		// Portals
		const portals: Portal[] = [];
		r.position = h.portalsOff;

		// Read portal headers first (need boundary line offsets)
		const portalHeaders: { px: number; py: number; pz: number; blOff: number; link: number; blCount: number }[] = [];
		for (let p = 0; p < h.numPortals; p++) {
			portalHeaders.push({
				px:      r.readF32(),
				py:      r.readF32(),
				pz:      r.readF32(),
				blOff:   r.readU32(),
				link:    r.readU16(),
				blCount: r.readU8(),
			});
			r.readU8(); // padding
		}

		// Resolve portal boundary lines
		for (const ph of portalHeaders) {
			const boundaryLines: BoundaryLine[] = [];
			r.position = ph.blOff;
			for (let b = 0; b < ph.blCount; b++) {
				boundaryLines.push({ verts: { x: r.readF32(), y: r.readF32(), z: r.readF32(), w: r.readF32() } });
			}
			portals.push({
				position: { x: ph.px, y: ph.py, z: ph.pz },
				boundaryLines,
				linkSection: ph.link,
			});
		}

		// NoGo lines
		const noGoLines: BoundaryLine[] = [];
		r.position = h.noGoOff;
		for (let n = 0; n < h.numNoGoLines; n++) {
			noGoLines.push({ verts: { x: r.readF32(), y: r.readF32(), z: r.readF32(), w: r.readF32() } });
		}

		// Corners
		const corners: Vector2[] = [];
		r.position = h.cornersOff;
		for (let c = 0; c < CORNERS_PER_SECTION; c++) {
			corners.push({ x: r.readF32(), y: r.readF32() });
		}

		sections.push({
			portals,
			noGoLines,
			corners,
			id:        h.id,
			spanIndex: h.spanIndex,
			speed:     h.speed as SectionSpeed,
			district:  h.district,
			flags:     h.flags,
		});
	}

	// ---- Section Reset Pairs ----
	const sectionResetPairs: SectionResetPair[] = [];
	r.position = resetPairsOffset;
	for (let i = 0; i < numSectionResetPairs; i++) {
		sectionResetPairs.push({
			resetSpeed:        r.readU32() as EResetSpeedType,
			startSectionIndex: r.readU16(),
			resetSectionIndex: r.readU16(),
		});
	}

	return { version, sectionMinSpeeds, sectionMaxSpeeds, sections, sectionResetPairs };
}

// =============================================================================
// Writing
// =============================================================================

export function writeAISectionsData(model: ParsedAISections, littleEndian: boolean = true): Uint8Array {
	const numSections   = model.sections.length;
	const numResetPairs = model.sectionResetPairs.length;

	// Conservative size estimate:
	// header(0x40) + sections(N*0x18) + per-section payload + reset pairs
	const estimate = 0x40
		+ numSections * 0x18
		+ numSections * (32 * 0x14 + 32 * 0x10 + 200 * 0x10 + CORNERS_PER_SECTION * 8)
		+ numResetPairs * 8;

	const w = new BinWriter(estimate, littleEndian);

	// ---- Header ----
	const headerSectionsPos   = w.offset; w.writeU32(0); // mpaSections placeholder
	const headerResetPairsPos = w.offset; w.writeU32(0); // mpaSectionResetPairs placeholder

	for (let i = 0; i < SECTION_SPEED_COUNT; i++) w.writeF32(model.sectionMinSpeeds[i] ?? 0);
	for (let i = 0; i < SECTION_SPEED_COUNT; i++) w.writeF32(model.sectionMaxSpeeds[i] ?? 0);

	w.writeU32(numSections);
	w.writeU32(numResetPairs);
	w.writeU32(model.version);
	const sizeFieldPos = w.offset; w.writeU32(0); // muSizeInBytes placeholder

	// ---- Section headers ----
	const sectionArrayStart = w.offset;
	w.setU32(headerSectionsPos, sectionArrayStart);

	// Bookkeeping for back-patching per-section pointers
	const sectionSlots: { portalsPos: number; noGoPos: number; cornersPos: number }[] = [];
	for (let i = 0; i < numSections; i++) {
		const s = model.sections[i];
		const portalsPos = w.offset; w.writeU32(0); // mpaPortals placeholder
		const noGoPos    = w.offset; w.writeU32(0); // mpaNoGoLines placeholder
		const cornersPos = w.offset; w.writeU32(0); // mpaCorners placeholder
		w.writeU32(s.id);
		w.writeI16(s.spanIndex);
		w.writeU16(s.noGoLines.length);
		w.writeU8(s.portals.length);
		w.writeU8(s.speed);
		w.writeU8(s.district);
		w.writeU8(s.flags);
		sectionSlots.push({ portalsPos, noGoPos, cornersPos });
	}

	// ---- Per-section payloads ----
	// Layout per section: portals → portal boundary lines → nogo lines → corners
	for (let i = 0; i < numSections; i++) {
		const s = model.sections[i];
		const slot = sectionSlots[i];

		// -- Portals --
		w.setU32(slot.portalsPos, w.offset);
		const portalBLSlots: { pos: number; lines: BoundaryLine[] }[] = [];
		for (const portal of s.portals) {
			w.writeF32(portal.position.x);
			w.writeF32(portal.position.y);
			w.writeF32(portal.position.z);
			const blPos = w.offset; w.writeU32(0); // mpaBoundaryLines placeholder
			w.writeU16(portal.linkSection);
			w.writeU8(portal.boundaryLines.length);
			w.writeU8(0); // padding
			portalBLSlots.push({ pos: blPos, lines: portal.boundaryLines });
		}

		// -- Portal boundary lines (16-byte aligned after portal headers) --
		w.align16();
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

		// -- Corners --
		w.setU32(slot.cornersPos, w.offset);
		for (const c of s.corners) {
			w.writeF32(c.x);
			w.writeF32(c.y);
		}
	}

	// ---- Section Reset Pairs ----
	w.setU32(headerResetPairsPos, w.offset);
	for (const rp of model.sectionResetPairs) {
		w.writeU32(rp.resetSpeed);
		w.writeU16(rp.startSectionIndex);
		w.writeU16(rp.resetSectionIndex);
	}

	// ---- Back-patch muSizeInBytes ----
	w.setU32(sizeFieldPos, w.offset);

	// Trailing 16-byte alignment (not counted in muSizeInBytes)
	w.align16();

	return w.bytes;
}

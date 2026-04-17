// WheelGraphicsSpec resource (CgsGraphics::WheelGraphicsSpec) parser and writer.
// Resource type ID: 0x1000A
// Blender reference: import_bpr_models.py:1743 (read_wheelgraphicsspec)
//
// Sits inside a per-wheel bundle (WHE_*_GR.BNDL) and names the Model for the
// wheel plus an optional Model for the brake caliper. The rest of the bundle
// supplies the Model → Renderable → Material chain those two references
// resolve to.
//
// Binary layout (32-bit LE, header is 0x10 bytes):
//
//   [0x00] u32 muVersion          always 1 in observed fixtures
//   [0x04] u32 mpWheelModel       runtime pointer, zero on disk
//   [0x08] u32 mpCaliperModel     runtime pointer, zero if the wheel has no
//                                 caliper; non-zero (typically 1) if it does
//   [0x0C] u32 padding            always zero
//
// Then one import-table entry for the wheel Model, and — iff mpCaliperModel
// is non-zero — a second entry for the caliper Model. Each entry is the same
// 16-byte shape used by Model's import table (see core/model.ts):
//
//   u64 resourceId | u32 ptrOffset | u32 padding
//
// ptrOffset is the offset back into the resource of the field to patch at
// load time: 0x04 for the wheel pointer, 0x08 for the caliper pointer.
//
// Round-trip strategy: layout-preserving. Both imports are surfaced as
// structured `{ id: bigint, ptrOffset }` records since there are at most
// two, and the ids are the only user-meaningful fields in this resource.
// The ambient mpWheelModel/mpCaliperModel values are preserved verbatim so
// an edit of the ids alone keeps the resource byte-exact with the original.

import { BinReader, BinWriter } from './binTools';

export const WHEEL_GRAPHICS_SPEC_TYPE_ID = 0x1000A;
export const WHEEL_GRAPHICS_SPEC_HEADER_SIZE = 0x10;
export const WHEEL_GRAPHICS_SPEC_IMPORT_ENTRY_SIZE = 0x10;

/** Disk offsets of the two runtime pointer fields. Also the ptrOffset values
 *  the matching import entries carry. */
const WHEEL_PTR_OFFSET = 0x04;
const CALIPER_PTR_OFFSET = 0x08;

// =============================================================================
// Types
// =============================================================================

export type WheelGraphicsImport = {
	/** u64 resource id of the referenced Model. */
	id: bigint;
	/** Offset back into the WheelGraphicsSpec of the field to patch at load
	 *  time (0x04 for wheel, 0x08 for caliper). Captured verbatim so a hand-
	 *  crafted variant with unusual ptrOffsets still round-trips. */
	ptrOffset: number;
	/** Trailing u32 pad word. Always zero in observed fixtures, but captured
	 *  verbatim so non-canonical inputs still round-trip byte-exactly. */
	trailingPad: number;
};

export type ParsedWheelGraphicsSpec = {
	// ---- Editable header fields ----
	version: number;           // u32 at +0x00, always 1
	/** Runtime pointer; zero on disk. Preserved verbatim. */
	mpWheelModel: number;
	/** Runtime pointer / caliper-present flag. Preserved verbatim. A non-zero
	 *  value means a caliper entry follows in the import table. */
	mpCaliperModel: number;
	/** Trailing u32 at +0x0C of the header. Always zero in observed fixtures
	 *  but captured verbatim so non-canonical inputs still round-trip. */
	headerPadding: number;

	// ---- Editable data ----
	wheelImport: WheelGraphicsImport;
	caliperImport: WheelGraphicsImport | null;
};

// =============================================================================
// Parser
// =============================================================================

export function parseWheelGraphicsSpec(
	raw: Uint8Array,
	littleEndian: boolean = true,
): ParsedWheelGraphicsSpec {
	if (raw.byteLength < WHEEL_GRAPHICS_SPEC_HEADER_SIZE + WHEEL_GRAPHICS_SPEC_IMPORT_ENTRY_SIZE) {
		throw new Error(
			`WheelGraphicsSpec too small (${raw.byteLength} bytes, need at least ${WHEEL_GRAPHICS_SPEC_HEADER_SIZE + WHEEL_GRAPHICS_SPEC_IMPORT_ENTRY_SIZE})`,
		);
	}
	const r = new BinReader(
		raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
		littleEndian,
	);

	const version        = r.readU32();
	const mpWheelModel   = r.readU32();
	const mpCaliperModel = r.readU32();
	const headerPadding  = r.readU32();

	if (version !== 1) {
		// Wiki / Python parser only know about v1. Warn but don't fail — the
		// layout may still be identical.
		console.warn(`WheelGraphicsSpec version ${version}, expected 1`);
	}

	const wheelImport = readImportEntry(r);
	const hasCaliper = mpCaliperModel !== 0;
	let caliperImport: WheelGraphicsImport | null = null;
	if (hasCaliper) {
		if (raw.byteLength < WHEEL_GRAPHICS_SPEC_HEADER_SIZE + 2 * WHEEL_GRAPHICS_SPEC_IMPORT_ENTRY_SIZE) {
			throw new Error(
				`WheelGraphicsSpec claims caliper (mpCaliperModel=${mpCaliperModel}) but is only ${raw.byteLength} bytes`,
			);
		}
		caliperImport = readImportEntry(r);
	}

	return {
		version,
		mpWheelModel,
		mpCaliperModel,
		headerPadding,
		wheelImport,
		caliperImport,
	};
}

function readImportEntry(r: BinReader): WheelGraphicsImport {
	const id = r.readU64();
	const ptrOffset = r.readU32();
	const trailingPad = r.readU32();
	return { id, ptrOffset, trailingPad };
}

// =============================================================================
// Writer
// =============================================================================

export function writeWheelGraphicsSpec(
	spec: ParsedWheelGraphicsSpec,
	littleEndian: boolean = true,
): Uint8Array {
	const hasCaliper = spec.caliperImport !== null;
	if (hasCaliper && spec.mpCaliperModel === 0) {
		throw new Error('WheelGraphicsSpec has caliperImport but mpCaliperModel is 0');
	}
	if (!hasCaliper && spec.mpCaliperModel !== 0) {
		throw new Error(
			`WheelGraphicsSpec has no caliperImport but mpCaliperModel is 0x${spec.mpCaliperModel.toString(16)}`,
		);
	}

	const totalSize = WHEEL_GRAPHICS_SPEC_HEADER_SIZE
		+ (hasCaliper ? 2 : 1) * WHEEL_GRAPHICS_SPEC_IMPORT_ENTRY_SIZE;

	const w = new BinWriter(totalSize, littleEndian);
	w.writeU32(spec.version >>> 0);
	w.writeU32(spec.mpWheelModel >>> 0);
	w.writeU32(spec.mpCaliperModel >>> 0);
	w.writeU32(spec.headerPadding >>> 0);

	writeImportEntry(w, spec.wheelImport);
	if (spec.caliperImport) writeImportEntry(w, spec.caliperImport);

	const out = new Uint8Array(totalSize);
	out.set(w.bytes);
	return out;
}

function writeImportEntry(w: BinWriter, entry: WheelGraphicsImport): void {
	w.writeU64(entry.id);
	w.writeU32(entry.ptrOffset >>> 0);
	w.writeU32(entry.trailingPad >>> 0);
}

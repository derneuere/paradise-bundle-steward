// GraphicsStub resource (CgsGraphics::GraphicsStub) parser and writer.
// Resource type ID: 0x10015
// Blender reference: import_bpr_models.py:1645 (read_graphicsstub)
//
// The entry point of a vehicle bundle: a fixed 48-byte record that names the
// GraphicsSpec (vehicle body) and WheelGraphicsSpec (wheels) this bundle
// assembles. The game patches two pointer slots at load time from the import
// table; on disk they hold 1 / 2 — a slot index telling you which of the two
// import entries is the vehicle spec and which is the wheel spec.
//
// Binary layout (32-bit LE, header is 0x10 bytes):
//
//   [0x00] i32  mpVehicleGraphics_slot    slot index (1 or 2) of the
//                                         GraphicsSpec in the trailing
//                                         import table
//   [0x04] i32  mpWheelGraphics_slot      slot index (1 or 2) of the
//                                         WheelGraphicsSpec
//   [0x08] u64  padding                   zero in observed fixtures
//
// Then two import entries, each the same 16-byte shape used by Model and
// WheelGraphicsSpec (see core/model.ts):
//
//   u64 resourceId | u32 ptrOffset | u32 padding
//
// The two slot fields point back at 0x00 and 0x04 — the ptrOffsets of the two
// import entries line up with them. Which import is the vehicle spec is
// determined by matching entry index (1-based) against mpVehicleGraphics_slot.
//
// Round-trip strategy: layout-preserving. Fixed size (48 bytes) and fixed
// import count (always 2), so the writer is a straight serialization.
//
// No example fixture exists in the steward repo — this resource appears in
// the main VEH_*.BIN wrapper bundle, which isn't in our example set. The
// handler registers without fixtures and the dedicated unit test exercises
// synthetic payloads built to spec.

import { BinReader, BinWriter } from './binTools';

export const GRAPHICS_STUB_TYPE_ID = 0x10015;
export const GRAPHICS_STUB_HEADER_SIZE = 0x10;
export const GRAPHICS_STUB_IMPORT_ENTRY_SIZE = 0x10;
export const GRAPHICS_STUB_IMPORT_COUNT = 2;
export const GRAPHICS_STUB_TOTAL_SIZE =
	GRAPHICS_STUB_HEADER_SIZE + GRAPHICS_STUB_IMPORT_COUNT * GRAPHICS_STUB_IMPORT_ENTRY_SIZE;

// =============================================================================
// Types
// =============================================================================

export type GraphicsStubImport = {
	/** u64 resource id of the referenced spec. */
	id: bigint;
	/** Offset back into the GraphicsStub of the pointer slot to patch at
	 *  load time (0x00 for vehicle-graphics, 0x04 for wheel-graphics). */
	ptrOffset: number;
	/** Trailing u32 pad. Zero in observed fixtures, preserved verbatim. */
	trailingPad: number;
};

export type ParsedGraphicsStub = {
	/** Slot index (1-based) in the import table for the vehicle GraphicsSpec.
	 *  Always 1 or 2 in observed fixtures. Preserved verbatim. */
	mpVehicleGraphicsSlot: number;
	/** Slot index (1-based) in the import table for the WheelGraphicsSpec.
	 *  Always 1 or 2 in observed fixtures. Preserved verbatim. */
	mpWheelGraphicsSlot: number;
	/** Trailing 8-byte pad at +0x08. Zero in observed fixtures, preserved
	 *  verbatim so non-canonical inputs still round-trip byte-exactly. */
	headerPaddingLo: number;
	headerPaddingHi: number;
	/** Two import entries, in bundle order. Use mpVehicleGraphicsSlot /
	 *  mpWheelGraphicsSlot to determine which is which. */
	imports: [GraphicsStubImport, GraphicsStubImport];
};

// =============================================================================
// Parser
// =============================================================================

export function parseGraphicsStub(
	raw: Uint8Array,
	littleEndian: boolean = true,
): ParsedGraphicsStub {
	if (raw.byteLength < GRAPHICS_STUB_TOTAL_SIZE) {
		throw new Error(
			`GraphicsStub too small (${raw.byteLength} bytes, need ${GRAPHICS_STUB_TOTAL_SIZE})`,
		);
	}
	const r = new BinReader(
		raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
		littleEndian,
	);

	const mpVehicleGraphicsSlot = r.readI32();
	const mpWheelGraphicsSlot   = r.readI32();
	const headerPaddingLo       = r.readU32();
	const headerPaddingHi       = r.readU32();

	const imports: [GraphicsStubImport, GraphicsStubImport] = [
		readImportEntry(r),
		readImportEntry(r),
	];

	return {
		mpVehicleGraphicsSlot,
		mpWheelGraphicsSlot,
		headerPaddingLo,
		headerPaddingHi,
		imports,
	};
}

function readImportEntry(r: BinReader): GraphicsStubImport {
	const id = r.readU64();
	const ptrOffset = r.readU32();
	const trailingPad = r.readU32();
	return { id, ptrOffset, trailingPad };
}

// =============================================================================
// Writer
// =============================================================================

export function writeGraphicsStub(
	stub: ParsedGraphicsStub,
	littleEndian: boolean = true,
): Uint8Array {
	const w = new BinWriter(GRAPHICS_STUB_TOTAL_SIZE, littleEndian);
	w.writeI32(stub.mpVehicleGraphicsSlot | 0);
	w.writeI32(stub.mpWheelGraphicsSlot | 0);
	w.writeU32(stub.headerPaddingLo >>> 0);
	w.writeU32(stub.headerPaddingHi >>> 0);

	for (const entry of stub.imports) writeImportEntry(w, entry);

	const out = new Uint8Array(GRAPHICS_STUB_TOTAL_SIZE);
	out.set(w.bytes);
	return out;
}

function writeImportEntry(w: BinWriter, entry: GraphicsStubImport): void {
	w.writeU64(entry.id);
	w.writeU32(entry.ptrOffset >>> 0);
	w.writeU32(entry.trailingPad >>> 0);
}

// =============================================================================
// Convenience accessors
// =============================================================================

/** Resolve the GraphicsSpec id by matching the slot field against the import
 *  table. Returns null if the slot is out of range (1..2) — e.g. a stub where
 *  that spec isn't present. */
export function getVehicleGraphicsSpecId(stub: ParsedGraphicsStub): bigint | null {
	const idx = stub.mpVehicleGraphicsSlot - 1;
	if (idx < 0 || idx >= stub.imports.length) return null;
	return stub.imports[idx].id;
}

export function getWheelGraphicsSpecId(stub: ParsedGraphicsStub): bigint | null {
	const idx = stub.mpWheelGraphicsSlot - 1;
	if (idx < 0 || idx >= stub.imports.length) return null;
	return stub.imports[idx].id;
}

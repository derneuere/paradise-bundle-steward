// Round-trip and edge-case tests for the GraphicsStub parser+writer.
//
// No fixture exists in the steward repo — the resource lives in VEH_*.BIN
// top-level bundles that aren't part of the tracked example set. These tests
// build synthetic 48-byte payloads to spec and exercise the corners we've
// learned to worry about from the WheelGraphicsSpec port: verbatim
// preservation of every pad / padding field, unusual slot/ptrOffset values,
// and size / range validation.

import { describe, it, expect } from 'vitest';

import {
	parseGraphicsStub,
	writeGraphicsStub,
	getVehicleGraphicsSpecId,
	getWheelGraphicsSpecId,
	GRAPHICS_STUB_TOTAL_SIZE,
	type ParsedGraphicsStub,
} from './graphicsStub';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

function buildRaw(opts: {
	mpVehicleGraphicsSlot?: number;
	mpWheelGraphicsSlot?: number;
	headerPaddingLo?: number;
	headerPaddingHi?: number;
	entryA: { id: bigint; ptrOffset?: number; trailingPad?: number };
	entryB: { id: bigint; ptrOffset?: number; trailingPad?: number };
}): Uint8Array {
	const out = new Uint8Array(GRAPHICS_STUB_TOTAL_SIZE);
	const dv = new DataView(out.buffer);
	dv.setInt32(0x00, opts.mpVehicleGraphicsSlot ?? 1, true);
	dv.setInt32(0x04, opts.mpWheelGraphicsSlot ?? 2, true);
	dv.setUint32(0x08, opts.headerPaddingLo ?? 0, true);
	dv.setUint32(0x0C, opts.headerPaddingHi ?? 0, true);

	dv.setBigUint64(0x10, opts.entryA.id, true);
	dv.setUint32(0x18, opts.entryA.ptrOffset ?? 0, true);
	dv.setUint32(0x1C, opts.entryA.trailingPad ?? 0, true);

	dv.setBigUint64(0x20, opts.entryB.id, true);
	dv.setUint32(0x28, opts.entryB.ptrOffset ?? 4, true);
	dv.setUint32(0x2C, opts.entryB.trailingPad ?? 0, true);
	return out;
}

describe('GraphicsStub / round-trip', () => {
	it('parses a canonical stub (vehicle=slot1, wheel=slot2)', () => {
		const raw = buildRaw({
			mpVehicleGraphicsSlot: 1,
			mpWheelGraphicsSlot: 2,
			entryA: { id: 0xAAAAAAAA11111111n, ptrOffset: 0 },
			entryB: { id: 0xBBBBBBBB22222222n, ptrOffset: 4 },
		});
		const stub = parseGraphicsStub(raw);
		expect(getVehicleGraphicsSpecId(stub)).toBe(0xAAAAAAAA11111111n);
		expect(getWheelGraphicsSpecId(stub)).toBe(0xBBBBBBBB22222222n);
		expect(bytesEqual(writeGraphicsStub(stub), raw)).toBe(true);
	});

	it('parses the inverted slot ordering (vehicle=slot2, wheel=slot1)', () => {
		const raw = buildRaw({
			mpVehicleGraphicsSlot: 2,
			mpWheelGraphicsSlot: 1,
			entryA: { id: 0x1111111111111111n },
			entryB: { id: 0x2222222222222222n },
		});
		const stub = parseGraphicsStub(raw);
		expect(getVehicleGraphicsSpecId(stub)).toBe(0x2222222222222222n);
		expect(getWheelGraphicsSpecId(stub)).toBe(0x1111111111111111n);
		expect(bytesEqual(writeGraphicsStub(stub), raw)).toBe(true);
	});

	it('round-trips non-zero 8-byte header padding', () => {
		const raw = buildRaw({
			headerPaddingLo: 0xDEADBEEF,
			headerPaddingHi: 0xCAFEBABE,
			entryA: { id: 1n },
			entryB: { id: 2n },
		});
		const stub = parseGraphicsStub(raw);
		expect(stub.headerPaddingLo).toBe(0xDEADBEEF);
		expect(stub.headerPaddingHi).toBe(0xCAFEBABE);
		expect(bytesEqual(writeGraphicsStub(stub), raw)).toBe(true);
	});

	it('round-trips non-zero import-entry trailing pad', () => {
		const raw = buildRaw({
			entryA: { id: 1n, trailingPad: 0x11223344 },
			entryB: { id: 2n, trailingPad: 0x55667788 },
		});
		const stub = parseGraphicsStub(raw);
		expect(bytesEqual(writeGraphicsStub(stub), raw)).toBe(true);
	});

	it('round-trips high-half resource ids', () => {
		const raw = buildRaw({
			entryA: { id: 0xFFFFFFFFFFFFFFFFn },
			entryB: { id: 0x8000000000000001n },
		});
		const stub = parseGraphicsStub(raw);
		expect(stub.imports[0].id).toBe(0xFFFFFFFFFFFFFFFFn);
		expect(stub.imports[1].id).toBe(0x8000000000000001n);
		expect(bytesEqual(writeGraphicsStub(stub), raw)).toBe(true);
	});

	it('round-trips unusual ptrOffsets verbatim', () => {
		const raw = buildRaw({
			entryA: { id: 1n, ptrOffset: 0xCAFE },
			entryB: { id: 2n, ptrOffset: 0xBEEF },
		});
		const stub = parseGraphicsStub(raw);
		expect(bytesEqual(writeGraphicsStub(stub), raw)).toBe(true);
	});

	it('returns null for out-of-range slot indices', () => {
		const stub: ParsedGraphicsStub = {
			mpVehicleGraphicsSlot: 3, // out of range
			mpWheelGraphicsSlot: 0,   // out of range
			headerPaddingLo: 0,
			headerPaddingHi: 0,
			imports: [
				{ id: 1n, ptrOffset: 0, trailingPad: 0 },
				{ id: 2n, ptrOffset: 4, trailingPad: 0 },
			],
		};
		expect(getVehicleGraphicsSpecId(stub)).toBeNull();
		expect(getWheelGraphicsSpecId(stub)).toBeNull();
	});

	it('rejects undersized inputs', () => {
		expect(() => parseGraphicsStub(new Uint8Array(32))).toThrow(/too small/);
		expect(() => parseGraphicsStub(new Uint8Array(47))).toThrow(/too small/);
	});
});

// Round-trip and edge-case tests for the WheelGraphicsSpec parser+writer.
// The handler fixtures already cover byte-exact round-trip for the two
// committed WHE_*_GR.BNDL samples (see registry.test.ts). These tests push
// on the corners: non-canonical padding, non-zero runtime pointer slots,
// synthesized caliper-less payloads, and malformed input rejection.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from './bundle';
import { extractResourceRaw, resourceCtxFromBundle } from './registry';
import {
	parseWheelGraphicsSpec,
	writeWheelGraphicsSpec,
	WHEEL_GRAPHICS_SPEC_TYPE_ID,
	WHEEL_GRAPHICS_SPEC_HEADER_SIZE,
	WHEEL_GRAPHICS_SPEC_IMPORT_ENTRY_SIZE,
	type ParsedWheelGraphicsSpec,
} from './wheelGraphicsSpec';

const FIXTURE_A = path.resolve(__dirname, '../../../example/WHE_00218650_GR.BNDL');
const FIXTURE_B = path.resolve(__dirname, '../../../example/WHE_00318650_GR.BNDL');

function loadWheelGraphicsSpecRaw(fixturePath: string): Uint8Array {
	const file = fs.readFileSync(fixturePath);
	const buf = new Uint8Array(file.byteLength);
	buf.set(file);
	const bundle = parseBundle(buf.buffer);
	const entry = bundle.resources.find((r) => r.resourceTypeId === WHEEL_GRAPHICS_SPEC_TYPE_ID);
	if (!entry) throw new Error(`fixture ${fixturePath} missing WheelGraphicsSpec`);
	return extractResourceRaw(buf.buffer, bundle, entry, resourceCtxFromBundle(bundle));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

function hex(b: Uint8Array): string {
	return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(' ');
}

// Build a synthetic raw payload at byte level so tests can exercise layouts
// no fixture covers (non-zero runtime pointers, unusual padding, custom
// ptrOffsets). Returns a Uint8Array.
function buildRaw(opts: {
	version?: number;
	mpWheelModel?: number;
	mpCaliperModel?: number;
	headerPadding?: number;
	wheelId: bigint;
	wheelPtrOffset?: number;
	wheelTrailingPad?: number;
	caliper?: {
		id: bigint;
		ptrOffset?: number;
		trailingPad?: number;
	};
}): Uint8Array {
	const hasCaliper = !!opts.caliper;
	const totalSize = WHEEL_GRAPHICS_SPEC_HEADER_SIZE
		+ (hasCaliper ? 2 : 1) * WHEEL_GRAPHICS_SPEC_IMPORT_ENTRY_SIZE;
	const out = new Uint8Array(totalSize);
	const dv = new DataView(out.buffer);
	dv.setUint32(0x00, (opts.version ?? 1) >>> 0, true);
	dv.setUint32(0x04, (opts.mpWheelModel ?? 0) >>> 0, true);
	dv.setUint32(0x08, (opts.mpCaliperModel ?? (hasCaliper ? 1 : 0)) >>> 0, true);
	dv.setUint32(0x0C, (opts.headerPadding ?? 0) >>> 0, true);

	// Wheel import entry
	dv.setBigUint64(0x10, opts.wheelId, true);
	dv.setUint32(0x18, (opts.wheelPtrOffset ?? 4) >>> 0, true);
	dv.setUint32(0x1C, (opts.wheelTrailingPad ?? 0) >>> 0, true);

	if (opts.caliper) {
		dv.setBigUint64(0x20, opts.caliper.id, true);
		dv.setUint32(0x28, (opts.caliper.ptrOffset ?? 8) >>> 0, true);
		dv.setUint32(0x2C, (opts.caliper.trailingPad ?? 0) >>> 0, true);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Parsing the real fixtures
// ---------------------------------------------------------------------------

describe('WheelGraphicsSpec / real fixtures', () => {
	it('parses WHE_00218650 into the expected model', () => {
		const raw = loadWheelGraphicsSpecRaw(FIXTURE_A);
		expect(raw.byteLength).toBe(48);
		const spec = parseWheelGraphicsSpec(raw);
		expect(spec.version).toBe(1);
		expect(spec.mpWheelModel).toBe(0);
		expect(spec.mpCaliperModel).toBe(1);
		expect(spec.wheelImport.id).toBe(0x000000007937044Fn);
		expect(spec.wheelImport.ptrOffset).toBe(4);
		expect(spec.caliperImport).not.toBeNull();
		expect(spec.caliperImport!.id).toBe(0x0000000071B01D21n);
		expect(spec.caliperImport!.ptrOffset).toBe(8);
	});

	it('parses WHE_00318650 into the expected model', () => {
		const raw = loadWheelGraphicsSpecRaw(FIXTURE_B);
		const spec = parseWheelGraphicsSpec(raw);
		expect(spec.wheelImport.id).toBe(0x00000000E438E539n);
		expect(spec.caliperImport!.id).toBe(0x00000000DFD88CB0n);
	});

	it('round-trips both fixtures byte-exactly', () => {
		for (const p of [FIXTURE_A, FIXTURE_B]) {
			const raw = loadWheelGraphicsSpecRaw(p);
			const spec = parseWheelGraphicsSpec(raw);
			const written = writeWheelGraphicsSpec(spec);
			expect(bytesEqual(written, raw), `fixture ${path.basename(p)}: written ${hex(written)} vs raw ${hex(raw)}`).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// Synthetic edge cases
// ---------------------------------------------------------------------------

describe('WheelGraphicsSpec / synthetic edges', () => {
	it('round-trips a caliper-less payload byte-exactly', () => {
		const raw = buildRaw({ wheelId: 0xCAFEBABE12345678n, mpCaliperModel: 0 });
		expect(raw.byteLength).toBe(32);
		const spec = parseWheelGraphicsSpec(raw);
		expect(spec.caliperImport).toBeNull();
		expect(spec.mpCaliperModel).toBe(0);
		const written = writeWheelGraphicsSpec(spec);
		expect(bytesEqual(written, raw)).toBe(true);
	});

	it('preserves mpWheelModel/mpCaliperModel when they are not canonical', () => {
		// Real bundles only show 0 / 0 or 0 / 1, but the field type is u32 so
		// a writer that stomped it to a "known" value would corrupt anything
		// unusual. Make sure preservation is verbatim.
		const raw = buildRaw({
			wheelId: 0x1111111122222222n,
			mpWheelModel: 0xDEADBEEF,
			mpCaliperModel: 0xFEEDFACE,
			caliper: { id: 0x3333333344444444n },
		});
		const spec = parseWheelGraphicsSpec(raw);
		expect(spec.mpWheelModel).toBe(0xDEADBEEF);
		expect(spec.mpCaliperModel).toBe(0xFEEDFACE);
		const written = writeWheelGraphicsSpec(spec);
		expect(bytesEqual(written, raw)).toBe(true);
	});

	it('round-trips non-zero header padding byte-exactly', () => {
		// The field at +0x0C has always been zero in observed bundles, but
		// we read it and warn — we must also preserve it so a hand-crafted or
		// future-game variant doesn't silently lose the byte.
		const raw = buildRaw({
			wheelId: 0xAAAABBBBCCCCDDDDn,
			headerPadding: 0xCAFEBABE,
			caliper: { id: 0x1234567890ABCDEFn },
		});
		const spec = parseWheelGraphicsSpec(raw);
		const written = writeWheelGraphicsSpec(spec);
		expect(bytesEqual(written, raw)).toBe(true);
	});

	it('round-trips non-zero import-entry trailing pad byte-exactly', () => {
		// Same story at +0x1C (wheel entry tail) and +0x2C (caliper entry tail).
		const raw = buildRaw({
			wheelId: 0x1n,
			wheelTrailingPad: 0x11223344,
			caliper: { id: 0x2n, trailingPad: 0x55667788 },
		});
		const spec = parseWheelGraphicsSpec(raw);
		const written = writeWheelGraphicsSpec(spec);
		expect(bytesEqual(written, raw)).toBe(true);
	});

	it('round-trips high-half resource ids', () => {
		// BP truncates IDs to low 32 bits in its Python export, but internally
		// the bundle format allows the full 64-bit space. Make sure we don't.
		const raw = buildRaw({
			wheelId: 0xDEADBEEFCAFEBABEn,
			caliper: { id: 0xFFFFFFFFFFFFFFFFn },
		});
		const spec = parseWheelGraphicsSpec(raw);
		expect(spec.wheelImport.id).toBe(0xDEADBEEFCAFEBABEn);
		expect(spec.caliperImport!.id).toBe(0xFFFFFFFFFFFFFFFFn);
		const written = writeWheelGraphicsSpec(spec);
		expect(bytesEqual(written, raw)).toBe(true);
	});

	it('round-trips unusual ptrOffsets (preserves verbatim)', () => {
		// Real wheels always use ptrOffset 4 / 8, but the field is u32 and
		// we expose it on the model. A writer that hard-coded 4/8 would
		// silently corrupt anything else.
		const raw = buildRaw({
			wheelId: 0x1n,
			wheelPtrOffset: 0x40,
			caliper: { id: 0x2n, ptrOffset: 0x50 },
		});
		const spec = parseWheelGraphicsSpec(raw);
		expect(spec.wheelImport.ptrOffset).toBe(0x40);
		expect(spec.caliperImport!.ptrOffset).toBe(0x50);
		const written = writeWheelGraphicsSpec(spec);
		expect(bytesEqual(written, raw)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Mutation round-trips (parse → mutate → write → parse → stable?)
// ---------------------------------------------------------------------------

describe('WheelGraphicsSpec / mutation scenarios', () => {
	it('swapping wheel and caliper ids round-trips and is idempotent', () => {
		const raw = loadWheelGraphicsSpecRaw(FIXTURE_A);
		const spec = parseWheelGraphicsSpec(raw);
		const swapped: ParsedWheelGraphicsSpec = {
			...spec,
			wheelImport: { ...spec.wheelImport, id: spec.caliperImport!.id },
			caliperImport: { ...spec.caliperImport!, id: spec.wheelImport.id },
		};
		const w1 = writeWheelGraphicsSpec(swapped);
		const reparsed = parseWheelGraphicsSpec(w1);
		const w2 = writeWheelGraphicsSpec(reparsed);
		expect(bytesEqual(w1, w2)).toBe(true);
		expect(reparsed.wheelImport.id).toBe(0x0000000071B01D21n);
		expect(reparsed.caliperImport!.id).toBe(0x000000007937044Fn);
	});

	it('dropping the caliper shrinks 48 → 32 and round-trips', () => {
		const raw = loadWheelGraphicsSpecRaw(FIXTURE_A);
		const spec = parseWheelGraphicsSpec(raw);
		const dropped: ParsedWheelGraphicsSpec = {
			...spec,
			mpCaliperModel: 0,
			caliperImport: null,
		};
		const w1 = writeWheelGraphicsSpec(dropped);
		expect(w1.byteLength).toBe(32);
		const reparsed = parseWheelGraphicsSpec(w1);
		expect(reparsed.caliperImport).toBeNull();
		const w2 = writeWheelGraphicsSpec(reparsed);
		expect(bytesEqual(w1, w2)).toBe(true);
	});

	it('adding a caliper to a caliper-less payload grows 32 → 48 and round-trips', () => {
		const raw = buildRaw({ wheelId: 0xAn, mpCaliperModel: 0 });
		const spec = parseWheelGraphicsSpec(raw);
		expect(spec.caliperImport).toBeNull();
		const grown: ParsedWheelGraphicsSpec = {
			...spec,
			mpCaliperModel: 1,
			caliperImport: { id: 0xBn, ptrOffset: 8, trailingPad: 0 },
		};
		const w1 = writeWheelGraphicsSpec(grown);
		expect(w1.byteLength).toBe(48);
		const reparsed = parseWheelGraphicsSpec(w1);
		expect(reparsed.caliperImport?.id).toBe(0xBn);
		const w2 = writeWheelGraphicsSpec(reparsed);
		expect(bytesEqual(w1, w2)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Malformed-input rejection
// ---------------------------------------------------------------------------

describe('WheelGraphicsSpec / input validation', () => {
	it('rejects a payload smaller than header + one import entry', () => {
		expect(() => parseWheelGraphicsSpec(new Uint8Array(16))).toThrow(/too small/);
		expect(() => parseWheelGraphicsSpec(new Uint8Array(31))).toThrow(/too small/);
	});

	it('rejects a caliper-claiming payload that is only 32 bytes', () => {
		// mpCaliperModel != 0 but no second import entry present.
		const buf = new Uint8Array(32);
		const dv = new DataView(buf.buffer);
		dv.setUint32(0x00, 1, true);           // version
		dv.setUint32(0x08, 1, true);           // mpCaliperModel non-zero → expects 2nd entry
		dv.setBigUint64(0x10, 0xAn, true);     // wheel id
		dv.setUint32(0x18, 4, true);           // wheel ptrOffset
		expect(() => parseWheelGraphicsSpec(buf)).toThrow(/claims caliper/);
	});

	it('writer rejects inconsistent caliper state', () => {
		const withCaliper: ParsedWheelGraphicsSpec = {
			version: 1,
			mpWheelModel: 0,
			mpCaliperModel: 0, // ← inconsistent: 0 but caliperImport set
			headerPadding: 0,
			wheelImport: { id: 1n, ptrOffset: 4, trailingPad: 0 },
			caliperImport: { id: 2n, ptrOffset: 8, trailingPad: 0 },
		};
		expect(() => writeWheelGraphicsSpec(withCaliper)).toThrow(/mpCaliperModel is 0/);

		const noCaliper: ParsedWheelGraphicsSpec = {
			version: 1,
			mpWheelModel: 0,
			mpCaliperModel: 1, // ← inconsistent: non-zero but no caliperImport
			headerPadding: 0,
			wheelImport: { id: 1n, ptrOffset: 4, trailingPad: 0 },
			caliperImport: null,
		};
		expect(() => writeWheelGraphicsSpec(noCaliper)).toThrow(/no caliperImport/);
	});
});

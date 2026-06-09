// Coverage for parsePropGraphicsList / writePropGraphicsList (resource 0x10010).
//
// Two layers:
//  - Synthesised payloads (always run): an empty list (null pointers) and a
//    small populated list — machine-independent, pinned on every box.
//  - A gold check against the real example/TRK_UNIT9_GR.BNDL bundle, skipped
//    when that untracked binary is absent (same convention as registry.test.ts).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parsePropGraphicsList,
	writePropGraphicsList,
	type ParsedPropGraphicsList,
} from '../propGraphicsList';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const TRK9_PATH = path.resolve(REPO_ROOT, 'example/TRK_UNIT9_GR.BNDL');
const PROP_GRAPHICS_LIST = 0x10010;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

// --- Synthesised: empty list (172/427 track units ship this all-zero shape) ---

describe('PropGraphicsList empty list (null pointers)', () => {
	function emptyBytes(zone: number): Uint8Array {
		// 32-byte header only: muSizeInBytes = 0x20, both array pointers null.
		const bytes = new Uint8Array(0x20);
		const dv = new DataView(bytes.buffer);
		dv.setUint32(0x00, 0x20, true); // muSizeInBytes
		dv.setUint32(0x04, zone, true); // muZoneNumber
		// counts + pointers stay zero.
		return bytes;
	}

	it('parses zero props/parts with null pointers', () => {
		const model = parsePropGraphicsList(emptyBytes(7));
		expect(model.props.length).toBe(0);
		expect(model.parts.length).toBe(0);
		expect(model.muZoneNumber).toBe(7);
		expect(model.muSizeInBytes).toBe(0x20);
		expect(model._tail.byteLength).toBe(0);
	});

	it('round-trips byte-for-byte (re-emits null pointers, not 0x20)', () => {
		const original = emptyBytes(7);
		const rewritten = writePropGraphicsList(parsePropGraphicsList(original));
		expect(rewritten.byteLength).toBe(original.byteLength);
		expect(bytesEqual(rewritten, original)).toBe(true);
	});
});

// --- Synthesised: a small populated list with a non-zero import-table tail ---

describe('PropGraphicsList populated round-trip (synthesised)', () => {
	// 2 props + 3 parts. mpaPropGraphics = 0x20, propEnd = 0x20 + 2*0x0C = 0x38,
	// mpaPropPartGraphics = align16(0x38) = 0x40, partEnd = 0x40 + 3*0x0C = 0x64.
	// Then an align pad to 0x70 + a fake import table of 5 entries × 16 = 80 bytes.
	function buildBytes(): Uint8Array {
		const partEnd = 0x40 + 3 * 0x0c; // 0x64
		const importOffset = (partEnd + 15) & ~15; // 0x70
		const importCount = 2 + 3;
		const total = importOffset + importCount * 16; // 0x70 + 80 = 0xC0
		const bytes = new Uint8Array(total);
		const dv = new DataView(bytes.buffer);
		dv.setUint32(0x00, partEnd, true);      // muSizeInBytes = part-array end
		dv.setUint32(0x04, 55, true);           // muZoneNumber
		dv.setUint32(0x08, 2, true);            // props
		dv.setUint8(0x0c, 3);                   // parts (u8)
		dv.setUint32(0x10, 0x20, true);         // mpaPropGraphics
		dv.setUint32(0x14, 0x40, true);         // mpaPropPartGraphics
		// props
		dv.setUint32(0x20, 0xaa, true); dv.setUint32(0x24, 0, true); dv.setUint32(0x28, 0x40, true);
		dv.setUint32(0x2c, 0xbb, true); dv.setUint32(0x30, 0, true); dv.setUint32(0x34, 0x40, true);
		// parts (at 0x40)
		dv.setUint32(0x40, 0xaa, true); dv.setUint32(0x44, 0, true); dv.setUint32(0x48, 0, true);
		dv.setUint32(0x4c, 0xaa, true); dv.setUint32(0x50, 1, true); dv.setUint32(0x54, 0, true);
		dv.setUint32(0x58, 0xbb, true); dv.setUint32(0x5c, 0, true); dv.setUint32(0x60, 0, true);
		// fake import table (non-zero) so the tail capture is exercised
		for (let i = 0; i < importCount; i++) {
			dv.setUint32(importOffset + i * 16 + 0, 0x1000 + i, true); // resourceId low
			dv.setUint32(importOffset + i * 16 + 8, 0x24 + i * 4, true); // field offset
		}
		return bytes;
	}

	it('decodes the structure and captures the non-zero tail', () => {
		const model = parsePropGraphicsList(buildBytes());
		expect(model.muZoneNumber).toBe(55);
		expect(model.props.length).toBe(2);
		expect(model.parts.length).toBe(3);
		expect(model.props[0].muTypeId).toBe(0xaa);
		expect(model.props[0].mpParts).toBe(0x40);
		expect(model.parts[1].muPartId).toBe(1);
		// tail = align pad (0x64→0x70) + 5×16 import table = 12 + 80 = 92 bytes.
		expect(model._tail.byteLength).toBe(0xc0 - 0x64);
		// and it is genuinely non-zero (the inline import table).
		expect(model._tail.some((b) => b !== 0)).toBe(true);
	});

	it('round-trips byte-for-byte', () => {
		const original = buildBytes();
		const rewritten = writePropGraphicsList(parsePropGraphicsList(original));
		expect(rewritten.byteLength).toBe(original.byteLength);
		expect(bytesEqual(rewritten, original)).toBe(true);
	});

	it('survives a muZoneNumber / prop-type edit', () => {
		const model = parsePropGraphicsList(buildBytes());
		const edited: ParsedPropGraphicsList = {
			...model,
			muZoneNumber: 999,
			props: model.props.map((p, i) => (i === 0 ? { ...p, muTypeId: 0x321 } : p)),
		};
		const re = parsePropGraphicsList(writePropGraphicsList(edited));
		expect(re.muZoneNumber).toBe(999);
		expect(re.props[0].muTypeId).toBe(0x321);
		// the import-pointer fields and the tail are untouched.
		expect(re.props[0].mpParts).toBe(0x40);
		expect(bytesEqual(re._tail, model._tail)).toBe(true);
	});
});

// --- Defensive guards (the writer regenerates pads as zero; reject layouts that
//     would make that silently lossy, and reject a u8-overflowing part count) ---

describe('PropGraphicsList layout guards', () => {
	it('throws on a non-zero header pad [0x18,0x20)', () => {
		const bytes = new Uint8Array(0x20);
		new DataView(bytes.buffer).setUint32(0x00, 0x20, true); // muSizeInBytes
		bytes[0x1c] = 0xab; // poison a header-pad byte
		expect(() => parsePropGraphicsList(bytes)).toThrow(/header pad/);
	});

	it('throws on a non-zero inter-array pad between the prop and part arrays', () => {
		// 1 prop (propEnd 0x2C) + 1 part (partsStart align16(0x2C)=0x30): the gap
		// [0x2C,0x30) is regenerated as zero, so a non-zero byte there must fail.
		const importOffset = 0x30 + 1 * 0x0c; // partEnd; aligned already
		const total = importOffset + 2 * 16;  // 1 prop + 1 part imports
		const bytes = new Uint8Array(total);
		const dv = new DataView(bytes.buffer);
		dv.setUint32(0x00, importOffset, true); // muSizeInBytes
		dv.setUint32(0x08, 1, true);            // 1 prop
		dv.setUint8(0x0c, 1);                   // 1 part
		dv.setUint32(0x10, 0x20, true);         // mpaPropGraphics
		dv.setUint32(0x14, 0x30, true);         // mpaPropPartGraphics
		bytes[0x2c] = 0x99;                     // poison the inter-array gap
		expect(() => parsePropGraphicsList(bytes)).toThrow(/inter-array pad/);
	});

	it('throws rather than truncate when a model carries more than 255 parts', () => {
		const model: ParsedPropGraphicsList = {
			muZoneNumber: 1,
			muSizeInBytes: 0,
			props: [{ muTypeId: 1, mpPropModel: 0, mpParts: 0 }],
			parts: Array.from({ length: 300 }, (_, i) => ({ muTypeId: 1, muPartId: i, mpPropModel: 0 })),
			_tail: new Uint8Array(0),
		};
		expect(() => writePropGraphicsList(model)).toThrow(/exceeds the u8/);
	});
});

// --- Gold: the real TRK_UNIT9_GR.BNDL bundle (skipped when the binary is absent) ---

const hasTrk9 = fs.existsSync(TRK9_PATH);
const describeTrk9 = hasTrk9 ? describe : describe.skip;

describeTrk9('PropGraphicsList gold (example/TRK_UNIT9_GR.BNDL)', () => {
	function loadRaw(): Uint8Array {
		const file = fs.readFileSync(TRK9_PATH);
		const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
		const bundle = parseBundle(buffer as ArrayBuffer);
		const entry = bundle.resources.find((r) => r.resourceTypeId === PROP_GRAPHICS_LIST)!;
		return extractResourceRaw(buffer as ArrayBuffer, bundle, entry);
	}

	const raw = loadRaw();
	const model = parsePropGraphicsList(raw);

	it('decodes the header', () => {
		expect(model.muZoneNumber).toBe(9);
		expect(model.muSizeInBytes).toBe(784);
		expect(model.props.length).toBe(10);
		expect(model.parts.length).toBe(52);
	});

	it('decodes the first props (Model* are 0 on disk; mpParts is an internal pointer)', () => {
		expect(model.props[0].muTypeId).toBe(0x28);
		expect(model.props[0].mpPropModel).toBe(0);
		expect(model.props[0].mpParts).toBe(0xa0);
		expect(model.props[2].muTypeId).toBe(0x06);
		expect(model.props[2].mpParts).toBe(0xd0);
	});

	it('decodes the first parts (grouped by owning prop type)', () => {
		expect(model.parts[0].muTypeId).toBe(0x28);
		expect(model.parts[0].muPartId).toBe(0);
		expect(model.parts[1].muTypeId).toBe(0x28);
		expect(model.parts[1].muPartId).toBe(1);
		expect(model.parts[4].muTypeId).toBe(0x06);
		expect(model.parts[4].muPartId).toBe(0);
		expect(model.parts.every((p) => p.mpPropModel === 0)).toBe(true);
	});

	it('round-trips byte-for-byte', () => {
		const rewritten = writePropGraphicsList(model);
		expect(rewritten.byteLength).toBe(raw.byteLength);
		expect(bytesEqual(rewritten, raw)).toBe(true);
	});

	it('writer is idempotent', () => {
		const write1 = writePropGraphicsList(parsePropGraphicsList(raw));
		const write2 = writePropGraphicsList(parsePropGraphicsList(write1));
		expect(bytesEqual(write1, write2)).toBe(true);
	});
});

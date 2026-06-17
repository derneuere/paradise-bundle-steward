// Coverage for parsePropGraphicsList / writePropGraphicsList (resource 0x10010).
//
// The catalogue is now fully editable — Model references are modelled as
// per-record resource ids (mpModelId), and props/parts can be added/removed.
// The writer rebuilds the inline import table + all derived offsets, so these
// tests cover field edits AND structural mutations, byte-exact round-trip, and
// the layout guards.
//
// Layers:
//  - Synthesised payloads (always run): an empty list (null pointers) and a
//    populated list with a canonical inline import table.
//  - A gold check against the real example/TRK_UNIT9_GR.BNDL bundle, skipped
//    when that untracked binary is absent.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parsePropGraphicsList,
	writePropGraphicsList,
	propGraphicsListImportTable,
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
	});

	it('round-trips byte-for-byte (re-emits null pointers, not 0x20)', () => {
		const original = emptyBytes(7);
		const rewritten = writePropGraphicsList(parsePropGraphicsList(original));
		expect(rewritten.byteLength).toBe(original.byteLength);
		expect(bytesEqual(rewritten, original)).toBe(true);
	});
});

// --- Synthesised: a populated list with a canonical inline import table ---

// 2 props + 3 parts. propEnd = 0x20 + 2*0x0C = 0x38, partsStart = align16(0x38)
// = 0x40, partEnd = 0x40 + 3*0x0C = 0x64 (= muSizeInBytes), importOffset =
// align16(0x64) = 0x70, total = 0x70 + 5*16 = 0xC0.
const PROP0_MODEL = 0x1A2B3C4D5E6Fn; // exercises the u64 high dword
const PROP1_MODEL = 0x222n;
const PART_MODELS = [0x333n, 0x444n, 0x555n];

function buildBytes(): Uint8Array {
	const total = 0xc0;
	const bytes = new Uint8Array(total);
	const dv = new DataView(bytes.buffer);
	dv.setUint32(0x00, 0x64, true);         // muSizeInBytes = part-array end
	dv.setUint32(0x04, 55, true);           // muZoneNumber
	dv.setUint32(0x08, 2, true);            // props
	dv.setUint8(0x0c, 3);                   // parts (u8)
	dv.setUint32(0x10, 0x20, true);         // mpaPropGraphics
	dv.setUint32(0x14, 0x40, true);         // mpaPropPartGraphics
	// props (mpPropModel slots stay 0; mpParts points prop0 at part index 0)
	dv.setUint32(0x20, 0xaa, true); dv.setUint32(0x28, 0x40, true); // prop0: type, mpParts
	dv.setUint32(0x2c, 0xbb, true); dv.setUint32(0x34, 0, true);    // prop1: type, mpParts=0 (no parts)
	// parts (at 0x40): {type, partId, mpPropModel=0}
	dv.setUint32(0x40, 0xaa, true); dv.setUint32(0x44, 0, true);
	dv.setUint32(0x4c, 0xaa, true); dv.setUint32(0x50, 1, true);
	dv.setUint32(0x58, 0xbb, true); dv.setUint32(0x5c, 0, true);
	// import table at 0x70 — props then parts, each {u64 id, u32 fieldOffset, u32 0}
	const entries: [bigint, number][] = [
		[PROP0_MODEL, 0x24], // prop0 mpPropModel field = 0x20 + 0*0x0C + 4
		[PROP1_MODEL, 0x30], // prop1 mpPropModel field = 0x20 + 1*0x0C + 4
		[PART_MODELS[0], 0x48], // part0 mpPropModel field = 0x40 + 0*0x0C + 8
		[PART_MODELS[1], 0x54], // part1
		[PART_MODELS[2], 0x60], // part2
	];
	entries.forEach(([id, off], i) => {
		const p = 0x70 + i * 16;
		dv.setUint32(p + 0, Number(id & 0xffffffffn), true);
		dv.setUint32(p + 4, Number(id >> 32n), true);
		dv.setUint32(p + 8, off, true);
	});
	return bytes;
}

describe('PropGraphicsList populated round-trip (synthesised)', () => {
	it('decodes the structure, Model ids, and part index', () => {
		const model = parsePropGraphicsList(buildBytes());
		expect(model.muZoneNumber).toBe(55);
		expect(model.props.length).toBe(2);
		expect(model.parts.length).toBe(3);
		expect(model.props[0].muTypeId).toBe(0xaa);
		expect(model.props[0].mpModelId).toBe(PROP0_MODEL);
		expect(model.props[0].firstPartIndex).toBe(0);
		expect(model.props[1].mpModelId).toBe(PROP1_MODEL);
		expect(model.props[1].firstPartIndex).toBeNull();
		expect(model.parts[1].muPartId).toBe(1);
		expect(model.parts.map((p) => p.mpModelId)).toEqual(PART_MODELS);
	});

	it('round-trips byte-for-byte', () => {
		const original = buildBytes();
		const rewritten = writePropGraphicsList(parsePropGraphicsList(original));
		expect(rewritten.byteLength).toBe(original.byteLength);
		expect(bytesEqual(rewritten, original)).toBe(true);
	});

	it('survives a muZoneNumber / prop-type / Model-id edit', () => {
		const model = parsePropGraphicsList(buildBytes());
		const edited: ParsedPropGraphicsList = {
			...model,
			muZoneNumber: 999,
			props: model.props.map((p, i) => (i === 0 ? { ...p, muTypeId: 0x321, mpModelId: 0x99n } : p)),
		};
		const re = parsePropGraphicsList(writePropGraphicsList(edited));
		expect(re.muZoneNumber).toBe(999);
		expect(re.props[0].muTypeId).toBe(0x321);
		expect(re.props[0].mpModelId).toBe(0x99n);
		// The part index and the other prop are untouched.
		expect(re.props[0].firstPartIndex).toBe(0);
		expect(re.props[1].mpModelId).toBe(PROP1_MODEL);
	});

	it('grows by one PropGraphics + one import entry when a prop is added', () => {
		const original = buildBytes();
		const model = parsePropGraphicsList(original);
		const added: ParsedPropGraphicsList = {
			...model,
			props: [...model.props, { muTypeId: 0x77, mpModelId: 0xABCDn, firstPartIndex: null }],
		};
		const written = writePropGraphicsList(added);
		// One more prop record (0x0C) shifts everything; adding a prop crosses an
		// align16 boundary here (3 props → partsStart 0x50), and one import entry
		// (16 bytes) is appended.
		const re = parsePropGraphicsList(written);
		expect(re.props.length).toBe(3);
		expect(re.props[2].muTypeId).toBe(0x77);
		expect(re.props[2].mpModelId).toBe(0xABCDn);
		// Existing entries survive the relocation: prop0 still owns part index 0,
		// and every part Model id is intact.
		expect(re.props[0].mpModelId).toBe(PROP0_MODEL);
		expect(re.props[0].firstPartIndex).toBe(0);
		expect(re.parts.map((p) => p.mpModelId)).toEqual(PART_MODELS);
		// The import-table hook reports the rebuilt table (props+parts = 6 entries)
		// at the relocated offset: 3 props → propEnd 0x44, partsStart 0x50, partEnd
		// 0x74 (= muSizeInBytes), importOffset = align16(0x74) = 0x80.
		const table = propGraphicsListImportTable(written);
		expect(table.count).toBe(6);
		expect(table.offset).toBe(0x80);
	});

	it('shrinks when a prop is removed', () => {
		const model = parsePropGraphicsList(buildBytes());
		// Remove the partless prop1 so no part orphaning is involved.
		const removed: ParsedPropGraphicsList = { ...model, props: [model.props[0]] };
		const re = parsePropGraphicsList(writePropGraphicsList(removed));
		expect(re.props.length).toBe(1);
		expect(re.props[0].mpModelId).toBe(PROP0_MODEL);
		expect(re.parts.map((p) => p.mpModelId)).toEqual(PART_MODELS);
		expect(propGraphicsListImportTable(writePropGraphicsList(removed)).count).toBe(4);
	});
});

// --- Defensive guards (the writer regenerates pads as zero / derives the
//     length, so reject layouts that would make that silently lossy) ---

describe('PropGraphicsList layout guards', () => {
	it('throws on a non-zero header pad [0x18,0x20)', () => {
		const bytes = new Uint8Array(0x20);
		new DataView(bytes.buffer).setUint32(0x00, 0x20, true); // muSizeInBytes
		bytes[0x1c] = 0xab; // poison a header-pad byte
		expect(() => parsePropGraphicsList(bytes)).toThrow(/header pad/);
	});

	it('throws when muSizeInBytes disagrees with the derived structural end', () => {
		const bytes = buildBytes();
		new DataView(bytes.buffer).setUint32(0x00, 0x999, true); // wrong muSizeInBytes
		expect(() => parsePropGraphicsList(bytes)).toThrow(/structural end/);
	});

	it('throws when the payload length disagrees with the derived layout', () => {
		const short = buildBytes().slice(0, 0xbf); // drop the last byte
		expect(() => parsePropGraphicsList(short)).toThrow(/expected 0x/);
	});

	it('throws rather than truncate when a model carries more than 255 parts', () => {
		const model: ParsedPropGraphicsList = {
			muZoneNumber: 1,
			props: [{ muTypeId: 1, mpModelId: 0n, firstPartIndex: 0 }],
			parts: Array.from({ length: 300 }, (_, i) => ({ muTypeId: 1, muPartId: i, mpModelId: 0n })),
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
		expect(model.props.length).toBe(10);
		expect(model.parts.length).toBe(52);
	});

	it('decodes the first props (Model ids from the import table; mpParts → part index)', () => {
		expect(model.props[0].muTypeId).toBe(0x28);
		expect(model.props[0].mpModelId).toBe(0x12f7700an); // verified Model id for type 0x28
		expect(model.props[0].firstPartIndex).toBe(0);       // mpParts 0xA0 = partsStart + 0
		expect(model.props[2].muTypeId).toBe(0x06);
		expect(model.props[2].firstPartIndex).toBe(4);       // mpParts 0xD0 = 0xA0 + 4*0x0C
	});

	it('decodes the first parts (grouped by owning prop type)', () => {
		expect(model.parts[0].muTypeId).toBe(0x28);
		expect(model.parts[0].muPartId).toBe(0);
		expect(model.parts[1].muTypeId).toBe(0x28);
		expect(model.parts[1].muPartId).toBe(1);
		expect(model.parts[4].muTypeId).toBe(0x06);
		expect(model.parts[4].muPartId).toBe(0);
		expect(model.parts.every((p) => typeof p.mpModelId === 'bigint')).toBe(true);
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

	it('import-table hook matches the real envelope (props + parts)', () => {
		const table = propGraphicsListImportTable(raw);
		expect(table.count).toBe(model.props.length + model.parts.length); // 62
	});
});

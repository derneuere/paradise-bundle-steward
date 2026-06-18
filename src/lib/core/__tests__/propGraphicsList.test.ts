// Coverage for parsePropGraphicsList / writePropGraphicsList (resource 0x10010).
//
// The catalogue is fully editable: props AND their nested parts can be added,
// removed, and re-pointed; Model references are modelled as per-record resource
// ids and the writer rebuilds the inline import table. Parts are nested under
// their owning prop (grouped by muTypeId on disk). These tests cover the model
// shape, byte-exact round-trip, add/remove of props + parts, partless-prop
// garbage preservation, the layout guards, and the real TRK9 gold fixture.

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

const align16 = (x: number) => (x + 15) & ~15;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

function totalParts(m: ParsedPropGraphicsList): number {
	return m.props.reduce((n, p) => n + p.parts.length, 0);
}

// ---------------------------------------------------------------------------
// Raw-bytes builder — lays out a canonical PGL payload (header → props → pad →
// parts → pad → import table) so the parser/writer can be exercised on exact
// byte shapes. The import table is props-then-parts in array order, matching
// the writer, so a well-formed build round-trips byte-exact.
// ---------------------------------------------------------------------------

type PropSpec = { typeId: number; model: bigint; mpParts: number };
type PartSpec = { typeId: number; partId: number; model: bigint };

function buildRaw(zone: number, props: PropSpec[], parts: PartSpec[]): Uint8Array {
	const nProps = props.length;
	const nParts = parts.length;
	const propEnd = 0x20 + nProps * 0x0c;
	const partsStart = align16(propEnd);
	const structuralEnd = nParts > 0 ? partsStart + nParts * 0x0c : nProps > 0 ? align16(propEnd) : 0x20;
	const importOffset = align16(structuralEnd);
	const total = importOffset + (nProps + nParts) * 16;

	const bytes = new Uint8Array(total);
	const dv = new DataView(bytes.buffer);
	const setU64 = (off: number, v: bigint) => {
		dv.setUint32(off, Number(v & 0xffffffffn), true);
		dv.setUint32(off + 4, Number(v >> 32n), true);
	};

	dv.setUint32(0x00, structuralEnd, true);
	dv.setUint32(0x04, zone, true);
	dv.setUint32(0x08, nProps, true);
	dv.setUint32(0x0c, nParts, true); // muNumberOfPropPartModels is a full u32 on disk
	dv.setUint32(0x10, nProps > 0 ? 0x20 : 0, true);
	dv.setUint32(0x14, nParts > 0 ? partsStart : 0, true);

	props.forEach((p, i) => {
		const o = 0x20 + i * 0x0c;
		dv.setUint32(o, p.typeId, true);
		dv.setUint32(o + 4, 0, true);          // mpPropModel — 0 on disk
		dv.setUint32(o + 8, p.mpParts, true);
	});
	parts.forEach((p, j) => {
		const o = partsStart + j * 0x0c;
		dv.setUint32(o, p.typeId, true);
		dv.setUint32(o + 4, p.partId, true);
		dv.setUint32(o + 8, 0, true);          // mpPropModel — 0 on disk
	});

	// Import table: props first (field offset of each mpPropModel), then parts.
	let e = importOffset;
	props.forEach((p, i) => {
		setU64(e, p.model);
		dv.setUint32(e + 8, 0x20 + i * 0x0c + 0x04, true);
		e += 16;
	});
	parts.forEach((p, j) => {
		setU64(e, p.model);
		dv.setUint32(e + 8, partsStart + j * 0x0c + 0x08, true);
		e += 16;
	});
	return bytes;
}

// ---------------------------------------------------------------------------
// Empty list (172/427 track units)
// ---------------------------------------------------------------------------

describe('PropGraphicsList — empty list', () => {
	it('parses zero props with null pointers and round-trips byte-for-byte', () => {
		const raw = buildRaw(7, [], []);
		expect(raw.byteLength).toBe(0x20);
		const model = parsePropGraphicsList(raw);
		expect(model.props.length).toBe(0);
		expect(model.muZoneNumber).toBe(7);
		expect(bytesEqual(writePropGraphicsList(model), raw)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Props only (no parts) — incl. the unaligned-prop-count align pad
// ---------------------------------------------------------------------------

describe('PropGraphicsList — props only (no parts)', () => {
	it('nests no parts and preserves each prop Model id', () => {
		const raw = buildRaw(9, [
			{ typeId: 0x10, model: 0x111n, mpParts: 0 },
			{ typeId: 0x20, model: 0x222n, mpParts: 0 },
		], []);
		const model = parsePropGraphicsList(raw);
		expect(model.props.map((p) => p.parts.length)).toEqual([0, 0]);
		expect(model.props.map((p) => p.mpModelId)).toEqual([0x111n, 0x222n]);
		expect(bytesEqual(writePropGraphicsList(model), raw)).toBe(true);
	});

	it('round-trips a prop count whose array end is NOT 16-aligned (1 prop → pad to 0x30)', () => {
		// 1 prop: propEnd 0x2C, structuralEnd align16 → 0x30. Regression for the
		// writer dropping the props→structuralEnd align pad when there are no parts.
		const raw = buildRaw(3, [{ typeId: 5, model: 0xAAn, mpParts: 0 }], []);
		expect(raw.byteLength).toBe(0x30 + 1 * 16);
		const model = parsePropGraphicsList(raw);
		expect(bytesEqual(writePropGraphicsList(model), raw)).toBe(true);
	});

	it('preserves a partless prop\'s leftover (garbage) mpParts pointer verbatim', () => {
		// Two props, no parts. Second prop carries a non-zero "garbage" mpParts the
		// runtime never dereferences; it must round-trip byte-exact.
		const raw = buildRaw(1, [
			{ typeId: 0x10, model: 0x1n, mpParts: 0 },
			{ typeId: 0x20, model: 0x2n, mpParts: 0x999 },
		], []);
		const model = parsePropGraphicsList(raw);
		expect(model.props[1]._mpPartsRaw).toBe(0x999);
		expect(bytesEqual(writePropGraphicsList(model), raw)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Populated with nested parts (synth) — the core of the new model
// ---------------------------------------------------------------------------

// 3 props: prop0 (0xAA) owns 2 parts, prop1 (0xCC) is partless w/ garbage mpParts,
// prop2 (0xBB) owns 1 part. propEnd 0x44, partsStart 0x50.
const SYNTH_PROPS: PropSpec[] = [
	{ typeId: 0xAA, model: 0x1A2B3C4D5E6Fn, mpParts: 0x50 },
	{ typeId: 0xCC, model: 0xCCCn, mpParts: 0x50 }, // partless, garbage pointer
	{ typeId: 0xBB, model: 0xBBBn, mpParts: 0x68 },
];
const SYNTH_PARTS: PartSpec[] = [
	{ typeId: 0xAA, partId: 0, model: 0xA00n },
	{ typeId: 0xAA, partId: 1, model: 0xA11n },
	{ typeId: 0xBB, partId: 0, model: 0xB00n },
];

describe('PropGraphicsList — nested parts (synth)', () => {
	const raw = buildRaw(42, SYNTH_PROPS, SYNTH_PARTS);
	const model = parsePropGraphicsList(raw);

	it('groups parts under their owning prop by type id', () => {
		expect(model.props.map((p) => p.parts.length)).toEqual([2, 0, 1]);
		expect(model.props[0].parts.map((p) => p.muPartId)).toEqual([0, 1]);
		expect(model.props[0].parts.map((p) => p.mpModelId)).toEqual([0xA00n, 0xA11n]);
		expect(model.props[2].parts[0].mpModelId).toBe(0xB00n);
	});

	it('preserves the partless middle prop\'s garbage pointer', () => {
		expect(model.props[1].parts.length).toBe(0);
		expect(model.props[1]._mpPartsRaw).toBe(0x50);
	});

	it('round-trips byte-for-byte and is idempotent', () => {
		const w1 = writePropGraphicsList(model);
		expect(bytesEqual(w1, raw)).toBe(true);
		const w2 = writePropGraphicsList(parsePropGraphicsList(w1));
		expect(bytesEqual(w2, w1)).toBe(true);
	});

	it('reports the rebuilt import table (props + parts) via the hook', () => {
		const table = propGraphicsListImportTable(writePropGraphicsList(model));
		expect(table.count).toBe(3 + 3);
		expect(table.offset).toBe(align16(SYNTH_PROPS.length * 0 + 0x50 + 3 * 0x0c)); // align16(structuralEnd 0x74) = 0x80
		expect(table.offset).toBe(0x80);
	});
});

// ---------------------------------------------------------------------------
// Field edits survive round-trip
// ---------------------------------------------------------------------------

describe('PropGraphicsList — field edits', () => {
	const base = () => parsePropGraphicsList(buildRaw(42, SYNTH_PROPS, SYNTH_PARTS));

	it('edits a prop Model id', () => {
		const m = base();
		m.props[0] = { ...m.props[0], mpModelId: 0xFEEDn };
		const re = parsePropGraphicsList(writePropGraphicsList(m));
		expect(re.props[0].mpModelId).toBe(0xFEEDn);
		expect(re.props[0].parts.length).toBe(2); // parts untouched
	});

	it('edits a part muPartId + Model id', () => {
		const m = base();
		m.props[0] = { ...m.props[0], parts: m.props[0].parts.slice() };
		m.props[0].parts[1] = { muPartId: 0x55, mpModelId: 0x9999n };
		const re = parsePropGraphicsList(writePropGraphicsList(m));
		expect(re.props[0].parts[1].muPartId).toBe(0x55);
		expect(re.props[0].parts[1].mpModelId).toBe(0x9999n);
	});

	it('edits a prop type and its part run follows the new type', () => {
		const m = base();
		m.props[0] = { ...m.props[0], muTypeId: 0x7F };
		const re = parsePropGraphicsList(writePropGraphicsList(m));
		expect(re.props[0].muTypeId).toBe(0x7F);
		expect(re.props[0].parts.length).toBe(2); // re-grouped under the new type
		expect(re.props[0].parts.map((p) => p.mpModelId)).toEqual([0xA00n, 0xA11n]);
	});
});

// ---------------------------------------------------------------------------
// Add / remove parts (the requested feature)
// ---------------------------------------------------------------------------

describe('PropGraphicsList — add / remove parts', () => {
	const base = () => parsePropGraphicsList(buildRaw(42, SYNTH_PROPS, SYNTH_PARTS));

	it('appends a part to a prop that already owns parts', () => {
		const m = base();
		m.props[0] = { ...m.props[0], parts: [...m.props[0].parts, { muPartId: 2, mpModelId: 0xA22n }] };
		const re = parsePropGraphicsList(writePropGraphicsList(m));
		expect(totalParts(re)).toBe(4);
		expect(re.props[0].parts.map((p) => p.muPartId)).toEqual([0, 1, 2]);
		expect(re.props[0].parts[2].mpModelId).toBe(0xA22n);
		// Other props' parts intact.
		expect(re.props[2].parts[0].mpModelId).toBe(0xB00n);
	});

	it('gives a previously-partless prop its first part (mpParts becomes derived)', () => {
		const m = base();
		m.props[1] = { ...m.props[1], parts: [{ muPartId: 0, mpModelId: 0xC00n }] };
		const re = parsePropGraphicsList(writePropGraphicsList(m));
		expect(totalParts(re)).toBe(4);
		expect(re.props[1].parts.length).toBe(1);
		expect(re.props[1].parts[0].mpModelId).toBe(0xC00n);
		// The other runs still resolve to the right props.
		expect(re.props[0].parts.length).toBe(2);
		expect(re.props[2].parts.length).toBe(1);
	});

	it('removes a part from a prop', () => {
		const m = base();
		m.props[0] = { ...m.props[0], parts: m.props[0].parts.slice(0, 1) };
		const re = parsePropGraphicsList(writePropGraphicsList(m));
		expect(totalParts(re)).toBe(2);
		expect(re.props[0].parts.map((p) => p.muPartId)).toEqual([0]);
		expect(re.props[2].parts[0].mpModelId).toBe(0xB00n); // unaffected
	});

	it('removes every part from a prop (it becomes partless)', () => {
		const m = base();
		m.props[2] = { ...m.props[2], parts: [] };
		const re = parsePropGraphicsList(writePropGraphicsList(m));
		expect(totalParts(re)).toBe(2);
		expect(re.props[2].parts.length).toBe(0);
	});

	it('reflects an added part in the import-table hook count', () => {
		const m = base();
		m.props[2] = { ...m.props[2], parts: [...m.props[2].parts, { muPartId: 1, mpModelId: 0xB11n }] };
		const written = writePropGraphicsList(m);
		expect(propGraphicsListImportTable(written).count).toBe(3 + 4); // 3 props + 4 parts
		expect(parsePropGraphicsList(written).props[2].parts.length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Add / remove props
// ---------------------------------------------------------------------------

describe('PropGraphicsList — add / remove props', () => {
	const base = () => parsePropGraphicsList(buildRaw(42, SYNTH_PROPS, SYNTH_PARTS));

	it('appends a new partless prop', () => {
		const m = base();
		m.props = [...m.props, { muTypeId: 0x77, mpModelId: 0xABCDn, parts: [], _mpPartsRaw: 0 }];
		const re = parsePropGraphicsList(writePropGraphicsList(m));
		expect(re.props.length).toBe(4);
		expect(re.props[3].muTypeId).toBe(0x77);
		expect(re.props[3].mpModelId).toBe(0xABCDn);
		expect(re.props[3].parts.length).toBe(0);
		// Existing parts survive the part-array relocation.
		expect(re.props[0].parts.map((p) => p.mpModelId)).toEqual([0xA00n, 0xA11n]);
	});

	it('removes the last prop', () => {
		const m = base();
		m.props = m.props.slice(0, -1); // drops prop2 (and its part)
		const re = parsePropGraphicsList(writePropGraphicsList(m));
		expect(re.props.length).toBe(2);
		expect(totalParts(re)).toBe(2); // only prop0's 2 parts remain
		expect(re.props[0].parts.length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Layout guards (fail loud on shapes the model can't represent)
// ---------------------------------------------------------------------------

describe('PropGraphicsList — guards', () => {
	it('throws when a type id\'s parts are not contiguous', () => {
		const raw = buildRaw(1, [
			{ typeId: 0xAA, model: 0x1n, mpParts: 0x30 },
			{ typeId: 0xBB, model: 0x2n, mpParts: 0x3c },
		], [
			{ typeId: 0xAA, partId: 0, model: 0xA0n },
			{ typeId: 0xBB, partId: 0, model: 0xB0n },
			{ typeId: 0xAA, partId: 1, model: 0xA1n }, // 0xAA reappears
		]);
		expect(() => parsePropGraphicsList(raw)).toThrow(/not contiguous/);
	});

	it('throws when two props share a type id that owns parts', () => {
		const raw = buildRaw(1, [
			{ typeId: 0xAA, model: 0x1n, mpParts: 0x30 },
			{ typeId: 0xAA, model: 0x2n, mpParts: 0x30 },
		], [
			{ typeId: 0xAA, partId: 0, model: 0xA0n },
		]);
		expect(() => parsePropGraphicsList(raw)).toThrow(/share type/);
	});

	it('throws when a part run has no owning prop', () => {
		const raw = buildRaw(1, [
			{ typeId: 0xAA, model: 0x1n, mpParts: 0 },
		], [
			{ typeId: 0xBB, partId: 0, model: 0xB0n }, // no prop of type 0xBB
		]);
		expect(() => parsePropGraphicsList(raw)).toThrow(/no owning prop/);
	});

	it('throws when part runs are not in prop order (would round-trip to different bytes)', () => {
		// props [0xBB, 0xAA] but on-disk part runs [0xAA-run, 0xBB-run]: contiguous,
		// single-owner, no orphans — but the run order disagrees with the prop order,
		// which the writer (flatten-in-prop-order) can't reproduce byte-exactly.
		const raw = buildRaw(1, [
			{ typeId: 0xBB, model: 0x2n, mpParts: 0 },
			{ typeId: 0xAA, model: 0x1n, mpParts: 0 },
		], [
			{ typeId: 0xAA, partId: 0, model: 0xA0n },
			{ typeId: 0xBB, partId: 0, model: 0xB0n },
		]);
		expect(() => parsePropGraphicsList(raw)).toThrow(/not in prop order/);
	});

	it('throws on a non-zero header pad', () => {
		const raw = buildRaw(1, [{ typeId: 1, model: 0n, mpParts: 0 }], []);
		raw[0x1c] = 0xab;
		expect(() => parsePropGraphicsList(raw)).toThrow(/header pad/);
	});

	it('throws when muSizeInBytes disagrees with the derived structural end', () => {
		const raw = buildRaw(42, SYNTH_PROPS, SYNTH_PARTS);
		new DataView(raw.buffer).setUint32(0x00, 0x999, true);
		expect(() => parsePropGraphicsList(raw)).toThrow(/structural end/);
	});

	it('throws when the payload length disagrees with the derived layout', () => {
		const raw = buildRaw(42, SYNTH_PROPS, SYNTH_PARTS).slice(0, -1);
		expect(() => parsePropGraphicsList(raw)).toThrow(/expected 0x/);
	});

	it('throws on write when two props share a type and one owns parts (can\'t round-trip)', () => {
		const model: ParsedPropGraphicsList = {
			muZoneNumber: 1,
			props: [
				{ muTypeId: 0xAA, mpModelId: 0n, _mpPartsRaw: 0, parts: [] },
				{ muTypeId: 0xAA, mpModelId: 0n, _mpPartsRaw: 0, parts: [{ muPartId: 0, mpModelId: 0n }] },
			],
		};
		expect(() => writePropGraphicsList(model)).toThrow(/more than one prop and owns parts/);
	});

	it('allows duplicate prop types when NEITHER owns parts (partless dups are fine)', () => {
		const model: ParsedPropGraphicsList = {
			muZoneNumber: 1,
			props: [
				{ muTypeId: 0xAA, mpModelId: 0x1n, _mpPartsRaw: 0, parts: [] },
				{ muTypeId: 0xAA, mpModelId: 0x2n, _mpPartsRaw: 0, parts: [] },
			],
		};
		const re = parsePropGraphicsList(writePropGraphicsList(model));
		expect(re.props.map((p) => p.mpModelId)).toEqual([0x1n, 0x2n]);
	});

	it('round-trips a model with more than 255 parts (muNumberOfPropPartModels is a u32, not a u8)', () => {
		// The part-count field is a full u32 on disk — so a model with
		// >255 parts must round-trip, not throw a u8-overflow.
		const model: ParsedPropGraphicsList = {
			muZoneNumber: 1,
			props: [{
				muTypeId: 1, mpModelId: 0n, _mpPartsRaw: 0,
				parts: Array.from({ length: 300 }, (_, i) => ({ muPartId: i, mpModelId: BigInt(i) })),
			}],
		};
		const re = parsePropGraphicsList(writePropGraphicsList(model));
		expect(re.props[0].parts.length).toBe(300);
		expect(re.props[0].parts[299].muPartId).toBe(299);
		expect(re.props[0].parts[299].mpModelId).toBe(299n);
	});
});

// ---------------------------------------------------------------------------
// Gold: the real TRK_UNIT9_GR.BNDL bundle (skipped when the binary is absent)
// ---------------------------------------------------------------------------

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

	it('decodes the header + counts', () => {
		expect(model.muZoneNumber).toBe(9);
		expect(model.props.length).toBe(10);
		expect(totalParts(model)).toBe(52);
	});

	it('nests the first prop\'s parts (type 0x28, Model 0x12F7700A, parts 0,1,…)', () => {
		expect(model.props[0].muTypeId).toBe(0x28);
		expect(model.props[0].mpModelId).toBe(0x12f7700an);
		expect(model.props[0].parts.length).toBeGreaterThanOrEqual(2);
		expect(model.props[0].parts[0].muPartId).toBe(0);
		expect(model.props[0].parts[1].muPartId).toBe(1);
		expect(model.props[0].parts.every((p) => typeof p.mpModelId === 'bigint')).toBe(true);
	});

	it('nests the type-0x06 prop\'s parts', () => {
		const prop = model.props.find((p) => p.muTypeId === 0x06)!;
		expect(prop).toBeTruthy();
		expect(prop.parts.length).toBeGreaterThanOrEqual(1);
		expect(prop.parts[0].muPartId).toBe(0);
	});

	it('round-trips byte-for-byte and is idempotent', () => {
		const w1 = writePropGraphicsList(model);
		expect(bytesEqual(w1, raw)).toBe(true);
		const w2 = writePropGraphicsList(parsePropGraphicsList(w1));
		expect(bytesEqual(w2, w1)).toBe(true);
	});

	it('import-table hook matches the real envelope (props + parts = 62)', () => {
		expect(propGraphicsListImportTable(raw).count).toBe(model.props.length + totalParts(model));
	});
});

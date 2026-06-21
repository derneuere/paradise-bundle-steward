// Coverage for parseIceList / writeIceList (resource type 0x1000C).
//
// The ICE List is an early-development type superseded by the ICE Take
// Dictionary; there is almost certainly no example fixture for it, so every
// case here is built from a SYNTHETIC buffer: a 16-byte header (muNumMovies,
// mpEntries, muPadding) followed by N 8-byte CgsID entries. The synthetic
// builder is the source of truth for the on-disk layout the parser/writer must
// reproduce.

import { describe, it, expect } from 'vitest';

import {
	parseIceList,
	writeIceList,
	describeIceList,
	type ParsedIceList,
} from '../iceList';

const HEADER_SIZE = 0x10;
const ENTRY_STRIDE = 0x8;

// Build a raw ICE List buffer the same way the disk format lays it out:
// header (muNumMovies, mpEntries-as-offset, muPadding) then the CgsID array.
function buildIceListBytes(entries: bigint[], muPadding: bigint, littleEndian = true): Uint8Array {
	const bytes = new Uint8Array(HEADER_SIZE + entries.length * ENTRY_STRIDE);
	const dv = new DataView(bytes.buffer);
	dv.setUint32(0x0, entries.length, littleEndian);
	// mpEntries is a file offset: the array follows the header (16) when present,
	// else null (0) — matching what the writer recomputes.
	dv.setUint32(0x4, entries.length > 0 ? HEADER_SIZE : 0, littleEndian);
	dv.setBigUint64(0x8, muPadding, littleEndian);
	for (let i = 0; i < entries.length; i++) {
		dv.setBigUint64(HEADER_SIZE + i * ENTRY_STRIDE, entries[i], littleEndian);
	}
	return bytes;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

describe('IceList parse', () => {
	it('decodes the header and the CgsID entry array', () => {
		const entries = [0x1122334455667788n, 0x00000000DEADBEEFn, 0xFFFFFFFFFFFFFFFFn];
		const bytes = buildIceListBytes(entries, 0xCAFEF00DBAADD00Dn);
		const model = parseIceList(bytes);

		expect(model.entries).toEqual(entries);
		expect(model.muPadding).toBe(0xCAFEF00DBAADD00Dn);
	});

	it('reads the count from muNumMovies, not the mpEntries offset', () => {
		// muNumMovies drives the entry loop; mpEntries is a load-fixup pointer the
		// parser must NOT use as a count.
		const entries = [0x0102030405060708n, 0x1112131415161718n];
		const bytes = buildIceListBytes(entries, 0n);
		const model = parseIceList(bytes);
		expect(model.entries.length).toBe(2);
	});
});

describe('IceList round-trip', () => {
	it('writes back byte-for-byte for a populated list', () => {
		const entries = [0x1122334455667788n, 0x00000000DEADBEEFn, 0xABCDEF0123456789n];
		const original = buildIceListBytes(entries, 0x0011223344556677n);
		const rewritten = writeIceList(parseIceList(original));
		expect(rewritten.byteLength).toBe(original.byteLength);
		expect(bytesEqual(rewritten, original)).toBe(true);
	});

	it('preserves a non-zero muPadding verbatim', () => {
		// muPadding is re-emitted as-is, not assumed to be zero.
		const original = buildIceListBytes([0x1n, 0x2n], 0x7766554433221100n);
		const re = parseIceList(writeIceList(parseIceList(original)));
		expect(re.muPadding).toBe(0x7766554433221100n);
	});

	it('writer is idempotent', () => {
		const entries = [0xAAAAAAAAAAAAAAAAn, 0xBBBBBBBBBBBBBBBBn];
		const bytes = buildIceListBytes(entries, 0x1234567890ABCDEFn);
		const write1 = writeIceList(parseIceList(bytes));
		const write2 = writeIceList(parseIceList(write1));
		expect(bytesEqual(write1, write2)).toBe(true);
	});

	it('recomputes mpEntries to the layout offset (16) regardless of the model', () => {
		// The model carries no mpEntries — the writer must compute it. A populated
		// list always writes 16 at offset 0x4.
		const model: ParsedIceList = { muPadding: 0n, entries: [0x42n] };
		const out = writeIceList(model);
		const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
		expect(dv.getUint32(0x4, true)).toBe(16);
	});
});

describe('IceList structural edits', () => {
	it('survives adding an entry (count + new id round-trip)', () => {
		const entries = [0x1111111111111111n, 0x2222222222222222n];
		const model = parseIceList(buildIceListBytes(entries, 0n));

		const added: ParsedIceList = {
			...model,
			entries: [...model.entries, 0x3333333333333333n],
		};
		const re = parseIceList(writeIceList(added));

		expect(re.entries.length).toBe(3);
		expect(re.entries[2]).toBe(0x3333333333333333n);
		// muNumMovies is derived from the array length on write — the parser
		// reads back exactly the appended count.
		const dv = new DataView(writeIceList(added).buffer);
		expect(dv.getUint32(0x0, true)).toBe(3);
	});

	it('survives removing an entry (count shrinks, buffer shrinks)', () => {
		const entries = [0x1111111111111111n, 0x2222222222222222n, 0x3333333333333333n];
		const original = buildIceListBytes(entries, 0n);
		const model = parseIceList(original);

		const removed: ParsedIceList = {
			...model,
			entries: model.entries.slice(0, -1),
		};
		const out = writeIceList(removed);
		const re = parseIceList(out);

		expect(re.entries.length).toBe(2);
		expect(re.entries).toEqual([0x1111111111111111n, 0x2222222222222222n]);
		// One fewer 8-byte entry than the original buffer.
		expect(out.byteLength).toBe(original.byteLength - 8);
	});
});

describe('IceList empty list edge case', () => {
	it('parses an empty list (zero entries, null mpEntries)', () => {
		const original = buildIceListBytes([], 0n);
		const model = parseIceList(original);
		expect(model.entries.length).toBe(0);
		expect(model.muPadding).toBe(0n);
		// Header-only buffer.
		expect(original.byteLength).toBe(HEADER_SIZE);
	});

	it('round-trips an empty list and re-emits the null mpEntries (0, not 16)', () => {
		const original = buildIceListBytes([], 0xDEADBEEFCAFEBABEn);
		const out = writeIceList(parseIceList(original));
		expect(out.byteLength).toBe(original.byteLength);
		expect(bytesEqual(out, original)).toBe(true);
		// mpEntries is the null pointer for an empty list.
		const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
		expect(dv.getUint32(0x4, true)).toBe(0);
	});

	it('preserves muPadding on an empty list', () => {
		const re = parseIceList(writeIceList(parseIceList(buildIceListBytes([], 0xFEEDFACEDEADC0DEn))));
		expect(re.muPadding).toBe(0xFEEDFACEDEADC0DEn);
	});
});

describe('describeIceList', () => {
	it('summarises the movie-id count with correct pluralisation', () => {
		expect(describeIceList({ muPadding: 0n, entries: [] })).toBe('0 movie ids');
		expect(describeIceList({ muPadding: 0n, entries: [0x1n] })).toBe('1 movie id');
		expect(describeIceList({ muPadding: 0n, entries: [0x1n, 0x2n] })).toBe('2 movie ids');
	});
});

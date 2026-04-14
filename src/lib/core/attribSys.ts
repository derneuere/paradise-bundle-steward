// AttribSys vault parser and writer.
//
// Parses the vault structure (Vers, DepN, StrN, DatN, ExpN, PtrN chunks)
// generically. Bin attribute data is preserved as raw bytes — typed
// attribute editing can be layered on top later.

import { BinReader, BinWriter } from './binTools';
import { parseVehicleBinData, writeVehicleBinData, type ParsedAttribute } from './vehicleAttribs';

// ---- FourCC constants (match LE u32 values from platform-endian read) ----

const VERS = 0x56657273;
const DEPN = 0x4465704E;
const STRN = 0x5374724E;
const DATN = 0x4461744E;
const EXPN = 0x4578704E;
const PTRN = 0x5074724E;
const STRE = 0x53747245;

// ---- Helpers ----

/** Read a null-terminated C string using the BinReader. */
function readCStr(r: BinReader, end: number): string | null {
	const bytes: number[] = [];
	while (r.position < end) {
		const b = r.readU8();
		if (b === 0) return new TextDecoder().decode(new Uint8Array(bytes));
		bytes.push(b);
	}
	return bytes.length > 0 ? new TextDecoder().decode(new Uint8Array(bytes)) : null;
}

// ---- Types ----

export type AttribEntry = {
	key: bigint;
	data: number;       // u32 pointer — always 0 in resource
	type: number;       // u16
	nodeFlags: number;  // u8
	entryFlags: number; // u8
};

export type CollectionLoadData = {
	key: bigint;
	classKey: bigint;
	parent: bigint;
	tableReserve: number;  // allocated entry slots
	tableKeyShift: number;
	numEntries: number;    // used entry slots
	numTypes: number;      // u16 — actual type count
	typesLen: number;      // u16 — allocated type slots
	layout: number;        // u32 pointer — always 0 in resource
	typeHashes: bigint[];
	entries: AttribEntry[];
};

export type ExportEntry = {
	id: bigint;
	type: bigint;
	dataBytes: number;
	dataOffset: number;  // relative to vlt start
};

export type PtrRef = {
	fixupOffset: number; // u32
	ptrType: number;     // i16
	index: number;       // i16
	data: bigint;        // u64
};

export type ParsedAttribSys = {
	versionHash: bigint;
	dependencies: {
		hashes: bigint[];
		names: string[];
	};
	strNData: bigint;
	collections: CollectionLoadData[];
	exports: ExportEntry[];
	pointerFixups: PtrRef[];
	strings: string[];         // parsed from bin StrE (display only)
	// Typed attribute data (when all classKeys are recognized):
	strERaw: number[];         // raw StrE chunk bytes for exact reproduction
	attributes: ParsedAttribute[];
	// Raw bin fallback (when classKeys are unknown):
	binRaw?: number[];
};

// ---- Parser ----

export function parseAttribSys(raw: Uint8Array, le: boolean): ParsedAttribSys {
	const r = new BinReader(
		raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
		le,
	);

	// CgsResource::AttribSysVaultResource header (16 bytes)
	const vltPos = r.readU32();
	const vltSize = r.readU32();
	const binPos = r.readU32();
	const binSize = r.readU32();

	let versionHash: bigint = 0n;
	const depHashes: bigint[] = [];
	const depNames: string[] = [];
	let strNData: bigint = 0n;
	const collections: CollectionLoadData[] = [];
	const exports: ExportEntry[] = [];
	const pointerFixups: PtrRef[] = [];

	// ---- Parse VLT chunks (sequential, FourCC-tagged) ----
	r.position = vltPos;
	const vltEnd = vltPos + vltSize;

	while (r.position < vltEnd) {
		const chunkStart = r.position;
		const fourcc = r.readU32();
		const chunkSize = r.readU32();
		if (chunkSize === 0) break;

		switch (fourcc) {
			case VERS:
				versionHash = r.readU64();
				break;

			case DEPN: {
				const count = Number(r.readU64());
				for (let i = 0; i < count; i++) depHashes.push(r.readU64());
				// Offsets: one u32 per dependency (relative to string table start)
				const offsets: number[] = [];
				for (let i = 0; i < count; i++) offsets.push(r.readU32());
				// Read strings using offsets
				const strTableStart = r.position;
				for (let i = 0; i < count; i++) {
					r.position = strTableStart + offsets[i];
					const s = readCStr(r, chunkStart + chunkSize);
					depNames.push(s ?? '');
				}
				break;
			}

			case STRN:
				strNData = r.readU64();
				break;

			case DATN:
				// Collection data lives here but is accessed via ExpN pointers.
				break;

			case EXPN: {
				const count = Number(r.readU64());
				for (let i = 0; i < count; i++) {
					const id = r.readU64();
					const type = r.readU64();
					const dataBytes = r.readU32();
					const dataOffset = r.readU32();

					exports.push({ id, type, dataBytes, dataOffset });

					// Seek into DatN to read this collection
					const savedPos = r.position;
					r.position = vltPos + dataOffset;

					const key = r.readU64();
					const classKey = r.readU64();
					const parent = r.readU64();
					const tableReserve = r.readU32();
					const tableKeyShift = r.readU32();
					const numEntries = r.readU32();
					const numTypes = r.readU16();
					const typesLen = r.readU16();
					const layout = r.readU32();
					r.readU32(); // padding

					const typeHashes: bigint[] = [];
					for (let j = 0; j < numTypes; j++) typeHashes.push(r.readU64());
					for (let j = 0; j < typesLen - numTypes; j++) r.readU64(); // padding

					const entries: AttribEntry[] = [];
					for (let j = 0; j < tableReserve; j++) {
						entries.push({
							key: r.readU64(),
							data: r.readU32(),
							type: r.readU16(),
							nodeFlags: r.readU8(),
							entryFlags: r.readU8(),
						});
					}

					collections.push({
						key, classKey, parent, tableReserve, tableKeyShift,
						numEntries, numTypes, typesLen, layout, typeHashes, entries,
					});

					r.position = savedPos;
				}
				break;
			}

			case PTRN: {
				const bodySize = chunkSize - 8;
				const count = Math.floor(bodySize / 16);
				for (let i = 0; i < count; i++) {
					pointerFixups.push({
						fixupOffset: r.readU32(),
						ptrType: r.readI16(),
						index: r.readI16(),
						data: r.readU64(),
					});
				}
				break;
			}
		}

		r.position = chunkStart + chunkSize;
	}

	// ---- Parse BIN ----
	r.position = binPos;
	const binRaw: number[] = [];
	for (let i = 0; i < binSize; i++) binRaw.push(r.readU8());

	// Parse strings from StrE chunk within bin
	const strings: string[] = [];
	const binView = new DataView(new Uint8Array(binRaw).buffer);
	const streFourcc = binView.getUint32(0, le);
	if (streFourcc === STRE) {
		const streSize = binView.getUint32(4, le);
		let pos = 8;
		while (pos < streSize) {
			const bytes: number[] = [];
			while (pos < streSize) {
				const b = binRaw[pos++];
				if (b === 0) break;
				bytes.push(b);
			}
			if (bytes.length > 0) {
				strings.push(new TextDecoder().decode(new Uint8Array(bytes)));
			}
		}
	}

	// Attempt typed attribute parsing
	const classHashes = collections.map(c => c.classKey);
	const typed = parseVehicleBinData(binRaw, le, classHashes);

	if (typed) {
		return {
			versionHash,
			dependencies: { hashes: depHashes, names: depNames },
			strNData,
			collections,
			exports,
			pointerFixups,
			strings,
			strERaw: typed.strERaw,
			attributes: typed.attributes,
		};
	}

	// Fallback: unknown classKeys, store raw bin
	const fallbackStreSize = streFourcc === STRE ? binView.getUint32(4, le) : 0;
	return {
		versionHash,
		dependencies: { hashes: depHashes, names: depNames },
		strNData,
		collections,
		exports,
		pointerFixups,
		strings,
		strERaw: Array.from(binRaw.slice(0, fallbackStreSize || 0)),
		attributes: [],
		binRaw,
	};
}

// ---- Writer ----

export function writeAttribSys(model: ParsedAttribSys, le: boolean): Uint8Array {
	const w = new BinWriter(4096, le);

	// ---- Resource header (16 bytes, back-patched) ----
	const HEADER_SIZE = 16;
	w.writeU32(HEADER_SIZE);  // vltPos — always 16
	w.writeU32(0);            // vltSize placeholder  (offset 4)
	w.writeU32(0);            // binPos placeholder   (offset 8)
	w.writeU32(0);            // binSize placeholder  (offset 12)

	const vltStart = w.offset; // 16

	// ---- Vers ----
	const versStart = w.offset;
	w.writeU32(VERS);
	w.writeU32(0);
	w.writeU64(model.versionHash);
	w.align16();
	w.setU32(versStart + 4, w.offset - versStart);

	// ---- DepN ----
	const depStart = w.offset;
	w.writeU32(DEPN);
	w.writeU32(0);
	const deps = model.dependencies;
	w.writeU64(BigInt(deps.names.length));
	for (const h of deps.hashes) w.writeU64(h);
	// String offsets (cumulative byte lengths including null terminators)
	const encodedNames = deps.names.map(n => new TextEncoder().encode(n));
	let strOff = 0;
	for (let i = 0; i < deps.names.length; i++) {
		w.writeU32(strOff);
		strOff += encodedNames[i].length + 1;
	}
	// Strings (null-terminated)
	for (const enc of encodedNames) {
		w.writeBytes(enc);
		w.writeU8(0);
	}
	w.align16();
	w.setU32(depStart + 4, w.offset - depStart);

	// ---- StrN ----
	const strNStart = w.offset;
	w.writeU32(STRN);
	w.writeU32(0);
	w.writeU64(model.strNData);
	w.align16();
	w.setU32(strNStart + 4, w.offset - strNStart);

	// ---- DatN (collections) ----
	const datNStart = w.offset;
	w.writeU32(DATN);
	w.writeU32(0);
	const collOffsets: number[] = [];
	for (const coll of model.collections) {
		collOffsets.push(w.offset - vltStart);
		w.writeU64(coll.key);
		w.writeU64(coll.classKey);
		w.writeU64(coll.parent);
		w.writeU32(coll.tableReserve);
		w.writeU32(coll.tableKeyShift);
		w.writeU32(coll.numEntries);
		w.writeU16(coll.numTypes);
		w.writeU16(coll.typesLen);
		w.writeU32(coll.layout);
		w.writeU32(0); // padding
		for (const h of coll.typeHashes) w.writeU64(h);
		for (let j = 0; j < coll.typesLen - coll.numTypes; j++) w.writeU64(0n);
		for (const e of coll.entries) {
			w.writeU64(e.key);
			w.writeU32(e.data);
			w.writeU16(e.type);
			w.writeU8(e.nodeFlags);
			w.writeU8(e.entryFlags);
		}
	}
	w.align16();
	w.setU32(datNStart + 4, w.offset - datNStart);

	// ---- ExpN ----
	const expNStart = w.offset;
	w.writeU32(EXPN);
	w.writeU32(0);
	w.writeU64(BigInt(model.exports.length));
	for (let i = 0; i < model.exports.length; i++) {
		const exp = model.exports[i];
		const coll = model.collections[i];
		w.writeU64(exp.id);
		w.writeU64(exp.type);
		// Recalculate dataBytes from collection layout
		const collBytes = 48 + coll.typesLen * 8 + coll.tableReserve * 16;
		w.writeU32(collBytes);
		w.writeU32(collOffsets[i]);
	}
	w.align16();
	w.setU32(expNStart + 4, w.offset - expNStart);

	// ---- PtrN ----
	const ptrNStart = w.offset;
	w.writeU32(PTRN);
	w.writeU32(0);
	for (const p of model.pointerFixups) {
		w.writeU32(p.fixupOffset);
		w.writeI16(p.ptrType);
		w.writeI16(p.index);
		w.writeU64(p.data);
	}
	w.align16();
	w.setU32(ptrNStart + 4, w.offset - ptrNStart);

	const vltSize = w.offset - vltStart;
	const binStart = w.offset;

	// ---- BIN ----
	if (model.binRaw) {
		// Fallback: raw copy
		w.writeBytes(new Uint8Array(model.binRaw));
	} else {
		// Typed: reconstruct from strERaw + attributes
		const binData = writeVehicleBinData(model.strERaw, model.attributes, le);
		w.writeBytes(new Uint8Array(binData));
	}

	const binSize = w.offset - binStart;

	// ---- Back-patch header ----
	w.setU32(4, vltSize);
	w.setU32(8, binStart);
	w.setU32(12, binSize);

	return w.bytes;
}

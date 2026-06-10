// Csis parser and writer (resource type 0xA023, CsisDef::SystemDesc).
//
// CSIS (Customizable Subscription-based Interfacing System) is the glue layer
// between AEMS audio banks: each Csis resource declares the named functions /
// classes / global variables one audio module exposes, and AEMS banks (0xA022)
// subscribe to them via CrcAndKey references — the bank's InterfaceReference
// ID stores (this resource's system crc, the entry's crc) plus the entry name.
// All ten retail Csis resources live in SOUND/AEMS/CSIS.BUNDLE, one per audio
// module (BoostCsis, SkidsCsis, GearWhineCsis, …).
//
// On-disk layout (32-bit PC, little-endian; all retail fixtures validated):
//   0x00 u32  mu32DataSize    — BinaryFile envelope: payload size (align16)
//   0x04 u32  mu32DataOffset  — always 0x10
//   0x08 u8[8]                — uninitialised heap garbage (UTF-16 path
//                               fragments in retail) — preserved verbatim
//   ---- payload base B = 0x10; every pointer below is B-relative ----
//   B+0x00 char[4] 'MOIR'
//   B+0x04 u8 ver=0, verCsisxMajor=3, verCsisxMinor=1, verCsisxPatch=0
//   B+0x08 u8 platform (0 = PLATFORM_WIN in retail), u8 resolved (0 on disk)
//   B+0x0A u16 numFunctions, B+0x0C u16 numClasses, B+0x0E u16 numGlobalVariables
//   B+0x10 u16 crc — (Σ all entry crcs) & 0x7FFF; derived on write, asserted
//          on parse (validated on all 10 retail resources incl. 3 multi-entry)
//   B+0x12 u8[2] pad = 0
//   B+0x14/0x18/0x1C u32 pFunctionDesc/pClassDesc/pGlobalVariableDesc — 0 on
//          disk (runtime pointer fixups; the desc arrays sit at fixed offsets)
//   B+0x20 CListDNode linkNode = {0, 0}
//   B+0x28 FunctionDesc[numFunctions] — 0xC each: u32 clients (0 on disk),
//          u32 pStringId, u32 u (CrcAndKey union: crc lo16, key hi16 = 0)
//   then   ClassDesc[numClasses] — SAME 0xC shape. The wiki types ClassDesc
//          as FunctionDesc but claims length 0x10 for 32-bit; real PC bytes
//          use the plain 0xC FunctionDesc stride (InAirCsis pins it).
//   then   GlobalVariableDesc[numGlobalVariables] — 0x10 each: clients,
//          curVal (Parameter union, raw bits), pStringId, u. NO retail
//          resource carries one, so this shape is wiki-only, fixture-unvalidated.
//   then   NUL-terminated entry names, contiguous, in entry order
//          (functions, classes, globals)
//   then   uninitialised garbage to align16 — preserved verbatim
//
// Round-trip strategy: counts, pStringIds, the system crc, and both envelope
// sizes are recomputed from the entry arrays on write; the parser asserts the
// stored values match that derivation (throwing instead of mis-parsing), so
// the writer's recomputation is provably byte-exact. The entry crc itself is
// NOT derivable from the name (no standard CRC-16 nor soundHash reproduces
// it), so it stays a stored field the editor must keep in sync with banks.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Enumerations
// =============================================================================

// CsisDef::Platform — note this is a DIFFERENT table from AemsDef's platform
// enum (PS3 is 7 here, 10 there).
export const CSIS_PLATFORMS = [
	{ value: 0, label: 'PC (Win32)' },
	{ value: 1, label: 'Mac' },
	{ value: 2, label: 'PlayStation 2' },
	{ value: 3, label: 'Xbox' },
	{ value: 4, label: 'GameCube' },
	{ value: 5, label: 'Xbox 360' },
	{ value: 6, label: 'PSP' },
	{ value: 7, label: 'PlayStation 3' },
	{ value: 8, label: 'Wii' },
	{ value: 9, label: 'PC (Win64)' },
] as const;

// =============================================================================
// Types
// =============================================================================

export type CsisEntry = {
	/** Entry name, e.g. 'GearWhineClass' — what AEMS bank references are matched against. */
	name: string;
	/**
	 * 15-bit checksum of this entry. AEMS banks store it as the high u16 of
	 * their InterfaceReference CrcAndKey, so renaming an entry without
	 * updating the subscribing banks (or vice versa) breaks the link.
	 * Derivation unknown — not reproducible via CRC-16 variants or soundHash.
	 */
	crc: number; // u16
	/** High u16 of the CrcAndKey union — 0 on disk; runtime fills the key. */
	_key: number; // u16
	/** CListDStack subscriber-list head — 0 on disk (runtime pointer). */
	_clients: number; // u32
};

export type CsisGlobalVariable = CsisEntry & {
	/** CsisDef::Parameter union (intVal / floatVal) — raw u32 bits. */
	curVal: number;
};

export type ParsedCsis = {
	/** CsisDef::Platform — 0 (PC) in every retail resource. */
	platform: number; // u8
	/** 0 on disk; the runtime sets it once pointers are fixed up. */
	resolved: number; // u8
	functions: CsisEntry[];
	classes: CsisEntry[];
	/** Empty in every retail resource — the on-disk shape is wiki-only. */
	globalVariables: CsisGlobalVariable[];
	/** 8 uninitialised bytes in the BinaryFile envelope — preserved verbatim. */
	_envelopePad: Uint8Array;
	/** Uninitialised garbage padding the payload to 16 bytes — verbatim. */
	_tailGarbage: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

const ENVELOPE_SIZE = 0x10;
const SYSTEM_DESC_SIZE = 0x28;
const FUNCTION_DESC_SIZE = 0xc;
const GLOBAL_DESC_SIZE = 0x10;

const align16 = (n: number) => (n + 15) & ~15;

function fail(msg: string): never {
	throw new Error(`Csis: ${msg}`);
}

/** SystemDesc.crc — sum of every entry crc folded to 15 bits. */
export function csisSystemCrc(model: Pick<ParsedCsis, 'functions' | 'classes' | 'globalVariables'>): number {
	let sum = 0;
	for (const e of [...model.functions, ...model.classes, ...model.globalVariables]) sum += e.crc;
	return sum & 0x7fff;
}

export function makeEmptyCsisEntry(): CsisEntry {
	return { name: '', crc: 0, _key: 0, _clients: 0 };
}

// =============================================================================
// Reader
// =============================================================================

export function parseCsis(raw: Uint8Array, littleEndian = true): ParsedCsis {
	// Copy up front — extractResourceRaw may hand back a Buffer view, and the
	// verbatim pad fields below must not alias the caller's bytes.
	const bytes = new Uint8Array(raw);
	const r = new BinReader(bytes.buffer, littleEndian);

	if (bytes.byteLength < ENVELOPE_SIZE + SYSTEM_DESC_SIZE) {
		fail(`resource is ${bytes.byteLength} bytes, smaller than envelope + SystemDesc`);
	}

	// --- BinaryFile envelope ---
	const dataSize = r.readU32();
	const dataOffset = r.readU32();
	if (dataOffset !== ENVELOPE_SIZE) fail(`mu32DataOffset 0x${dataOffset.toString(16)}, expected 0x10`);
	if (dataSize + ENVELOPE_SIZE !== bytes.byteLength) {
		fail(`mu32DataSize 0x${dataSize.toString(16)} + 0x10 != resource size 0x${bytes.byteLength.toString(16)}`);
	}
	const _envelopePad = bytes.slice(8, ENVELOPE_SIZE);

	// --- SystemDesc ---
	const B = ENVELOPE_SIZE;
	r.position = B;
	const magic = r.readFixedString(4);
	if (magic !== 'MOIR') fail(`id '${magic}', expected 'MOIR'`);
	const ver = r.readU8();
	const verMajor = r.readU8();
	const verMinor = r.readU8();
	const verPatch = r.readU8();
	if (ver !== 0 || verMajor !== 3 || verMinor !== 1 || verPatch !== 0) {
		fail(`csisx version ${ver}/${verMajor}.${verMinor}.${verPatch}, expected 0/3.1.0`);
	}
	const platform = r.readU8();
	const resolved = r.readU8();
	const numFunctions = r.readU16();
	const numClasses = r.readU16();
	const numGlobalVariables = r.readU16();
	const crc = r.readU16();
	const pad12 = r.readU16();
	if (pad12 !== 0) fail(`header pad at +0x12 is 0x${pad12.toString(16)}, expected 0`);
	for (const [name, value] of [
		['pFunctionDesc', r.readU32()],
		['pClassDesc', r.readU32()],
		['pGlobalVariableDesc', r.readU32()],
		['linkNode.pnext', r.readU32()],
		['linkNode.pprev', r.readU32()],
	] as const) {
		if (value !== 0) fail(`${name} is 0x${value.toString(16)}, expected 0 (fixed up at runtime)`);
	}

	// --- Desc arrays (functions, classes, globals — back to back) ---
	const descStart = SYSTEM_DESC_SIZE;
	let stringCursor = descStart
		+ (numFunctions + numClasses) * FUNCTION_DESC_SIZE
		+ numGlobalVariables * GLOBAL_DESC_SIZE;

	const readString = (pStringId: number, what: string): string => {
		if (pStringId !== stringCursor) {
			fail(`${what} pStringId 0x${pStringId.toString(16)}, expected 0x${stringCursor.toString(16)} (strings are contiguous in entry order)`);
		}
		let end = B + pStringId;
		while (end < bytes.byteLength && bytes[end] !== 0) end++;
		if (end >= bytes.byteLength) fail(`unterminated ${what} string at 0x${pStringId.toString(16)}`);
		let s = '';
		for (let j = B + pStringId; j < end; j++) s += String.fromCharCode(bytes[j]);
		stringCursor = end - B + 1;
		return s;
	};

	type RawDesc = { clients: number; pStringId: number; u: number; curVal?: number };
	const rawDescs: RawDesc[] = [];
	r.position = B + descStart;
	for (let i = 0; i < numFunctions + numClasses; i++) {
		rawDescs.push({ clients: r.readU32(), pStringId: r.readU32(), u: r.readU32() });
	}
	for (let i = 0; i < numGlobalVariables; i++) {
		const clients = r.readU32();
		const curVal = r.readU32();
		const pStringId = r.readU32();
		const u = r.readU32();
		rawDescs.push({ clients, pStringId, u, curVal });
	}

	const toEntry = (d: RawDesc, what: string): CsisEntry => ({
		name: readString(d.pStringId, what),
		crc: d.u & 0xffff,
		_key: d.u >>> 16,
		_clients: d.clients,
	});

	const functions: CsisEntry[] = [];
	const classes: CsisEntry[] = [];
	const globalVariables: CsisGlobalVariable[] = [];
	for (let i = 0; i < numFunctions; i++) functions.push(toEntry(rawDescs[i], `function[${i}]`));
	for (let i = 0; i < numClasses; i++) classes.push(toEntry(rawDescs[numFunctions + i], `class[${i}]`));
	for (let i = 0; i < numGlobalVariables; i++) {
		const d = rawDescs[numFunctions + numClasses + i];
		globalVariables.push({ ...toEntry(d, `global[${i}]`), curVal: d.curVal! });
	}

	// --- System crc must reproduce from the entries, or the writer's
	// derivation would not be byte-exact. ---
	const derived = csisSystemCrc({ functions, classes, globalVariables });
	if (crc !== derived) {
		fail(`stored crc 0x${crc.toString(16)} != (Σ entry crcs) & 0x7FFF = 0x${derived.toString(16)}`);
	}

	// --- Garbage tail to the 16-byte-aligned payload end — verbatim ---
	if (dataSize !== align16(stringCursor)) {
		fail(`mu32DataSize 0x${dataSize.toString(16)} != align16(content end 0x${stringCursor.toString(16)})`);
	}
	const _tailGarbage = bytes.slice(B + stringCursor, bytes.byteLength);

	return { platform, resolved, functions, classes, globalVariables, _envelopePad, _tailGarbage };
}

// =============================================================================
// Writer
// =============================================================================

export function writeCsis(model: ParsedCsis, littleEndian = true): Uint8Array {
	if (model._envelopePad.byteLength !== 8) {
		fail(`_envelopePad must be exactly 8 bytes, got ${model._envelopePad.byteLength}`);
	}
	const all = [...model.functions, ...model.classes, ...model.globalVariables];
	for (const e of all) {
		for (let i = 0; i < e.name.length; i++) {
			const c = e.name.charCodeAt(i);
			if (c === 0 || c > 0xff) fail(`entry name "${e.name}" has a byte-unrepresentable character`);
		}
	}

	// --- Layout pass: every offset/size/crc is derived, nothing stored. ---
	const descStart = SYSTEM_DESC_SIZE;
	let cursor = descStart
		+ (model.functions.length + model.classes.length) * FUNCTION_DESC_SIZE
		+ model.globalVariables.length * GLOBAL_DESC_SIZE;
	const stringOffsets: number[] = [];
	for (const e of all) {
		stringOffsets.push(cursor);
		cursor += e.name.length + 1;
	}
	const contentEnd = cursor;
	const dataSize = align16(contentEnd);

	const w = new BinWriter(ENVELOPE_SIZE + dataSize, littleEndian);
	w.writeU32(dataSize);
	w.writeU32(ENVELOPE_SIZE);
	w.writeBytes(model._envelopePad);

	// Not writeFixedString — that reserves the last byte for a NUL terminator.
	for (const c of 'MOIR') w.writeU8(c.charCodeAt(0));
	w.writeU8(0); // ver
	w.writeU8(3); // verCsisxMajor
	w.writeU8(1); // verCsisxMinor
	w.writeU8(0); // verCsisxPatch
	w.writeU8(model.platform);
	w.writeU8(model.resolved);
	w.writeU16(model.functions.length);
	w.writeU16(model.classes.length);
	w.writeU16(model.globalVariables.length);
	w.writeU16(csisSystemCrc(model));
	w.writeU16(0); // pad
	w.writeU32(0); // pFunctionDesc
	w.writeU32(0); // pClassDesc
	w.writeU32(0); // pGlobalVariableDesc
	w.writeU32(0); // linkNode.pnext
	w.writeU32(0); // linkNode.pprev
	if (w.offset !== ENVELOPE_SIZE + SYSTEM_DESC_SIZE) {
		fail(`writer SystemDesc ended at 0x${w.offset.toString(16)}, expected 0x${(ENVELOPE_SIZE + SYSTEM_DESC_SIZE).toString(16)}`);
	}

	// --- Desc arrays ---
	let stringIndex = 0;
	const writeU = (e: CsisEntry) => w.writeU32(((e._key & 0xffff) << 16 | (e.crc & 0xffff)) >>> 0);
	for (const e of [...model.functions, ...model.classes]) {
		w.writeU32(e._clients);
		w.writeU32(stringOffsets[stringIndex++]);
		writeU(e);
	}
	for (const g of model.globalVariables) {
		w.writeU32(g._clients);
		w.writeU32(g.curVal);
		w.writeU32(stringOffsets[stringIndex++]);
		writeU(g);
	}

	// --- Strings (latin1, NUL-terminated, entry order) ---
	for (const e of all) {
		for (let i = 0; i < e.name.length; i++) w.writeU8(e.name.charCodeAt(i));
		w.writeU8(0);
	}
	if (w.offset !== ENVELOPE_SIZE + contentEnd) {
		fail(`writer strings ended at 0x${w.offset.toString(16)}, expected 0x${(ENVELOPE_SIZE + contentEnd).toString(16)}`);
	}

	// --- Garbage tail: verbatim when the layout is unchanged; zero-filled
	// where an edit changed the pad length (the bytes are uninitialised
	// junk, so synthesising zeros is as faithful as anything). ---
	const needed = dataSize - contentEnd;
	for (let i = 0; i < needed; i++) {
		w.writeU8(i < model._tailGarbage.byteLength ? model._tailGarbage[i] : 0);
	}
	return w.bytes;
}

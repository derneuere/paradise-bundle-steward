// AemsBank parser and writer (resource type 0xA022, AemsDef::ModuleBank).
//
// AEMS (Audio Event Management System) banks carry the event-driven vehicle
// sounds — boost, in-air, skids, scrapes, gear whine, horns, surface and
// traffic effects. A bank is a COMPILED artifact: its module region contains
// x86 glue code plus static data the engine patches at load time, and its SFX
// region is an SND10 sample bank holding the actual audio. Banks link to the
// CSIS subscription system (0xA023) through tail-end InterfaceReferences:
// each names a Csis class and stores its CrcAndKey (the Csis resource's
// system crc + the class entry's crc), which is how e.g. SKIDS.BUNDLE binds
// to SkidsCsis's 'Skids' class.
//
// On-disk layout (32-bit PC, little-endian; all 23 retail banks validated):
//   0x00 u32  mu32DataSize    — BinaryFile envelope: payload size (align16)
//   0x04 u32  mu32DataOffset  — always 0x10
//   0x08 u8[8]                — uninitialised heap garbage, preserved verbatim
//   ---- payload base B = 0x10; every offset below is B-relative ----
//   B+0x00 char[4] 'ABKC', u8 ver=1, veraimex 1.2.2
//   B+0x08 u8 platform (0 = PC), u8 targetType (3 = SND10)
//   B+0x0A u16 nummodules — the wiki claims "always 1", but retail INAIR has 2
//   B+0x0C u32 debugcrc = 0, B+0x10 u32 uniqueid = 0
//   B+0x14 u32 totalsize     — align4(interface-ID blob end); derived
//   B+0x18 u32 residentsize  — always == sfxbankoffset (everything before the
//          SFX bank stays resident in memory); derived
//   B+0x1C u32 moduleoffset = 0x5C (modules start right after this header)
//   B+0x20 u32 sfxbankoffset, B+0x24 u32 sfxbanksizepadded (multiple of 4)
//   B+0x28/0x2C u32 midibankoffset/midibanksizepadded — 0 in every retail bank
//   B+0x30/0x34/0x38 u32 funcfixupoffset / staticdatafixupoffset /
//          interfaceOffset — the three tail tables, packed back to back
//          immediately after the SFX bank; derived
//   B+0x3C u32 modulebankhandle = 0
//   B+0x40 u32 pSnd10SampleBankHeader = 0xFFFFFFFF (runtime pointer sentinel)
//   B+0x44 u32 midibhandle = 0xFFFFFFFF
//   B+0x48/0x4C u32 streamfilepath/streamfileoffset = 0
//   B+0x50 CListDNode ln = {0,0}, B+0x58 u32 ptweakheader = 0
//   B+0x5C module data — modules, compiled x86 glue code, static data.
//          Opaque: preserved verbatim (_moduleData).
//   then   SND10 SFX sample bank ('S10A' header; numSamples at +0x8 is stored
//          BIG-endian even in this little-endian resource). Opaque (_sfxBank).
//   then   FUNCFIXUPHEADER:       u32 count + u32[count] code-patch offsets
//   then   STATICDATAFIXUPHEADER: u32 count + u32[count] data-patch offsets
//   then   InterfaceFixupHeader:  u32 count + count × 0xC InterfaceReference
//          { u32 handleOffset (Csis::ClassHandle slot in module data),
//            u32 IDOffset, u8 type (1 = class), u8[3] uninit pad — the bytes
//            'AKH' in every retail bank }
//   then   per-reference ID blobs, in reference order: u32 CrcAndKey
//          (lo16 = target Csis SystemDesc crc, hi16 = target entry crc)
//          followed by the NUL-terminated entry name
//   then   zero pad to align4 (= totalsize), zero pad to align16 (= dataSize)
//
// Round-trip strategy (structural slice, like aptData): the two big interior
// regions are verbatim blobs; every offset/size and the three tail tables are
// decoded and recomputed on write. The parser asserts the rigid layout
// (section adjacency, zero/sentinel constants, contiguous ID blobs) and
// throws on violation so the writer's derivation is provably byte-exact.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Enumerations
// =============================================================================

// AemsDef platform — NOT the CsisDef table (PS3 is 10 here, 7 there).
export const AEMS_PLATFORMS = [
	{ value: 0, label: 'PC (Win)' },
	{ value: 1, label: 'Mac' },
	{ value: 2, label: 'PlayStation 2' },
	{ value: 3, label: 'Xbox' },
	{ value: 4, label: 'GameCube' },
	{ value: 5, label: 'Xbox 360' },
	{ value: 10, label: 'PlayStation 3' },
] as const;

export const AEMS_TARGET_TYPES = [
	{ value: 0, label: 'Original' },
	{ value: 1, label: 'Uncompressed proxy' },
	{ value: 2, label: 'SND9' },
	{ value: 3, label: 'SND10' },
] as const;

export const AEMS_INTERFACE_TYPES = [
	{ value: 0, label: 'Global variable' },
	{ value: 1, label: 'Class' },
	{ value: 2, label: 'Function' },
] as const;

// =============================================================================
// Types
// =============================================================================

export type AemsInterfaceReference = {
	/** B-relative offset of the Csis::ClassHandle inside the module data that
	 *  the loader patches once the named Csis entry resolves. */
	handleOffset: number; // u32
	/** AemsDef::InterfaceType — 1 (class) in every retail bank. */
	type: number; // u8
	/** Low u16 of the ID CrcAndKey — the target Csis resource's system crc. */
	idCrc: number;
	/** High u16 — the target entry's own crc inside that Csis resource. */
	idKey: number;
	/** Name of the Csis entry this bank subscribes to, e.g. 'GearWhineClass'. */
	idName: string;
	/** 3 uninitialised pad bytes — 'AKH' (0x41,0x4B,0x48) in every retail bank. */
	_pad: number[];
};

export type ParsedAemsBank = {
	/** AEMS_PLATFORMS — 0 (PC) in every retail bank. */
	platform: number; // u8
	/** AEMS_TARGET_TYPES — 3 (SND10) in every retail bank. */
	targetType: number; // u8
	/** Module count. 1 in 22 retail banks; INAIR.BUNDLE has 2. */
	numModules: number; // u16
	/** Modules + compiled x86 glue code + static data, [0x5C, sfxbankoffset).
	 *  Opaque and position-dependent — preserved verbatim. */
	_moduleData: Uint8Array;
	/** SND10 sample bank (the audio). Opaque — preserved verbatim. */
	_sfxBank: Uint8Array;
	/** Code-patch offsets the loader fixes up inside the glue code. */
	funcFixups: number[];
	/** Static-data-patch offsets, same mechanism. */
	staticDataFixups: number[];
	/** Csis subscriptions — see AemsInterfaceReference. */
	interfaceRefs: AemsInterfaceReference[];
	/** 8 uninitialised bytes in the BinaryFile envelope — preserved verbatim. */
	_envelopePad: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

const ENVELOPE_SIZE = 0x10;
const MODULE_BANK_HEADER_SIZE = 0x5c;
const INTERFACE_REFERENCE_SIZE = 0xc;

const align4 = (n: number) => (n + 3) & ~3;
const align16 = (n: number) => (n + 15) & ~15;

function fail(msg: string): never {
	throw new Error(`AemsBank: ${msg}`);
}

/**
 * Decoded SND10 sample-bank header from the verbatim blob, for display.
 * numSamples is stored big-endian inside this otherwise little-endian
 * resource (sweep-verified: 1–53 samples across retail, BE-read).
 */
export function aemsSfxBankInfo(model: ParsedAemsBank): { id: string; version: number; serialNumber: number; numSamples: number } | null {
	const b = model._sfxBank;
	if (b.byteLength < 12) return null;
	const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
	return {
		id: String.fromCharCode(b[0], b[1], b[2], b[3]),
		version: b[4],
		serialNumber: v.getUint16(6, true),
		numSamples: v.getUint32(8, false),
	};
}

// =============================================================================
// Reader
// =============================================================================

export function parseAemsBank(raw: Uint8Array, littleEndian = true): ParsedAemsBank {
	// Copy up front — extractResourceRaw may hand back a Buffer view, and the
	// verbatim blob fields below must not alias the caller's bytes.
	const bytes = new Uint8Array(raw);
	const r = new BinReader(bytes.buffer, littleEndian);

	if (bytes.byteLength < ENVELOPE_SIZE + MODULE_BANK_HEADER_SIZE) {
		fail(`resource is ${bytes.byteLength} bytes, smaller than envelope + ModuleBank header`);
	}

	// --- BinaryFile envelope ---
	const dataSize = r.readU32();
	const dataOffset = r.readU32();
	if (dataOffset !== ENVELOPE_SIZE) fail(`mu32DataOffset 0x${dataOffset.toString(16)}, expected 0x10`);
	if (dataSize + ENVELOPE_SIZE !== bytes.byteLength) {
		fail(`mu32DataSize 0x${dataSize.toString(16)} + 0x10 != resource size 0x${bytes.byteLength.toString(16)}`);
	}
	const _envelopePad = bytes.slice(8, ENVELOPE_SIZE);

	// --- ModuleBank header ---
	const B = ENVELOPE_SIZE;
	r.position = B;
	const magic = r.readFixedString(4);
	if (magic !== 'ABKC') fail(`id '${magic}', expected 'ABKC'`);
	const ver = r.readU8();
	const verMajor = r.readU8();
	const verMinor = r.readU8();
	const verPatch = r.readU8();
	if (ver !== 1 || verMajor !== 1 || verMinor !== 2 || verPatch !== 2) {
		fail(`aimex version ${ver}/${verMajor}.${verMinor}.${verPatch}, expected 1/1.2.2`);
	}
	const platform = r.readU8();
	const targetType = r.readU8();
	const numModules = r.readU16();
	const totals = {
		debugcrc: r.readU32(),
		uniqueid: r.readU32(),
		totalsize: r.readU32(),
		residentsize: r.readU32(),
		moduleoffset: r.readU32(),
		sfxbankoffset: r.readU32(),
		sfxbanksizepadded: r.readU32(),
		midibankoffset: r.readU32(),
		midibanksizepadded: r.readU32(),
		funcfixupoffset: r.readU32(),
		staticdatafixupoffset: r.readU32(),
		interfaceOffset: r.readU32(),
		modulebankhandle: r.readU32(),
		pSnd10SampleBankHeader: r.readU32(),
		midibhandle: r.readU32(),
		streamfilepath: r.readU32(),
		streamfileoffset: r.readU32(),
		lnNext: r.readU32(),
		lnPrev: r.readU32(),
		ptweakheader: r.readU32(),
	};
	// The layout is rigid; bail loudly on violations rather than silently
	// producing a model that won't round-trip.
	for (const [name, expected] of [
		['debugcrc', 0], ['uniqueid', 0], ['moduleoffset', MODULE_BANK_HEADER_SIZE],
		['midibankoffset', 0], ['midibanksizepadded', 0], ['modulebankhandle', 0],
		['pSnd10SampleBankHeader', 0xffffffff], ['midibhandle', 0xffffffff],
		['streamfilepath', 0], ['streamfileoffset', 0], ['lnNext', 0], ['lnPrev', 0],
		['ptweakheader', 0],
	] as const) {
		if (totals[name] !== expected) {
			fail(`${name} is 0x${totals[name].toString(16)}, expected 0x${expected.toString(16)}`);
		}
	}
	if (totals.residentsize !== totals.sfxbankoffset) {
		fail(`residentsize 0x${totals.residentsize.toString(16)} != sfxbankoffset 0x${totals.sfxbankoffset.toString(16)}`);
	}
	if (totals.sfxbankoffset < MODULE_BANK_HEADER_SIZE || totals.sfxbankoffset + totals.sfxbanksizepadded > dataSize) {
		fail(`SFX bank [0x${totals.sfxbankoffset.toString(16)}, +0x${totals.sfxbanksizepadded.toString(16)}) overruns the 0x${dataSize.toString(16)}-byte payload`);
	}
	if (totals.sfxbanksizepadded % 4 !== 0) {
		fail(`sfxbanksizepadded 0x${totals.sfxbanksizepadded.toString(16)} is not a multiple of 4`);
	}
	if (totals.funcfixupoffset !== totals.sfxbankoffset + totals.sfxbanksizepadded) {
		fail(`funcfixupoffset 0x${totals.funcfixupoffset.toString(16)} != SFX bank end 0x${(totals.sfxbankoffset + totals.sfxbanksizepadded).toString(16)}`);
	}

	// --- Verbatim interior blobs ---
	const _moduleData = bytes.slice(B + MODULE_BANK_HEADER_SIZE, B + totals.sfxbankoffset);
	const _sfxBank = bytes.slice(B + totals.sfxbankoffset, B + totals.funcfixupoffset);

	// --- Fixup tables (packed back to back after the SFX bank) ---
	const readFixupTable = (at: number, what: string): number[] => {
		r.position = B + at;
		const count = r.readU32();
		if (at + 4 + count * 4 > dataSize) fail(`${what} table at 0x${at.toString(16)} with ${count} entries overruns the payload`);
		const out: number[] = [];
		for (let i = 0; i < count; i++) out.push(r.readU32());
		return out;
	};
	const funcFixups = readFixupTable(totals.funcfixupoffset, 'func fixup');
	if (totals.staticdatafixupoffset !== totals.funcfixupoffset + 4 + funcFixups.length * 4) {
		fail(`staticdatafixupoffset 0x${totals.staticdatafixupoffset.toString(16)} not adjacent to func fixup table`);
	}
	const staticDataFixups = readFixupTable(totals.staticdatafixupoffset, 'static data fixup');
	if (totals.interfaceOffset !== totals.staticdatafixupoffset + 4 + staticDataFixups.length * 4) {
		fail(`interfaceOffset 0x${totals.interfaceOffset.toString(16)} not adjacent to static data fixup table`);
	}

	// --- Interface references + their ID blobs ---
	r.position = B + totals.interfaceOffset;
	const numRefs = r.readU32();
	let idCursor = totals.interfaceOffset + 4 + numRefs * INTERFACE_REFERENCE_SIZE;
	const interfaceRefs: AemsInterfaceReference[] = [];
	for (let i = 0; i < numRefs; i++) {
		r.position = B + totals.interfaceOffset + 4 + i * INTERFACE_REFERENCE_SIZE;
		const handleOffset = r.readU32();
		const idOffset = r.readU32();
		const type = r.readU8();
		const _pad = [r.readU8(), r.readU8(), r.readU8()];
		if (idOffset !== idCursor) {
			fail(`interfaceRefs[${i}] IDOffset 0x${idOffset.toString(16)}, expected 0x${idCursor.toString(16)} (ID blobs are contiguous in reference order)`);
		}
		r.position = B + idOffset;
		const crcAndKey = r.readU32();
		let end = B + idOffset + 4;
		while (end < bytes.byteLength && bytes[end] !== 0) end++;
		if (end >= bytes.byteLength) fail(`unterminated interface ID string at 0x${idOffset.toString(16)}`);
		let idName = '';
		for (let j = B + idOffset + 4; j < end; j++) idName += String.fromCharCode(bytes[j]);
		interfaceRefs.push({
			handleOffset,
			type,
			idCrc: crcAndKey & 0xffff,
			idKey: crcAndKey >>> 16,
			idName,
			_pad,
		});
		idCursor = end - B + 1;
	}

	// --- Tail sizes: totalsize aligns the ID blobs to 4, the envelope size
	// aligns the whole payload to 16, and everything in between is zero. ---
	if (totals.totalsize !== align4(idCursor)) {
		fail(`totalsize 0x${totals.totalsize.toString(16)} != align4(ID blob end 0x${idCursor.toString(16)})`);
	}
	if (dataSize !== align16(totals.totalsize)) {
		fail(`mu32DataSize 0x${dataSize.toString(16)} != align16(totalsize 0x${totals.totalsize.toString(16)})`);
	}
	for (let i = B + idCursor; i < bytes.byteLength; i++) {
		if (bytes[i] !== 0) fail(`nonzero tail pad byte 0x${bytes[i].toString(16)} at payload offset 0x${(i - B).toString(16)}`);
	}

	return {
		platform,
		targetType,
		numModules,
		_moduleData,
		_sfxBank,
		funcFixups,
		staticDataFixups,
		interfaceRefs,
		_envelopePad,
	};
}

// =============================================================================
// Writer
// =============================================================================

export function writeAemsBank(model: ParsedAemsBank, littleEndian = true): Uint8Array {
	if (model._envelopePad.byteLength !== 8) {
		fail(`_envelopePad must be exactly 8 bytes, got ${model._envelopePad.byteLength}`);
	}
	if (model._sfxBank.byteLength % 4 !== 0) {
		fail(`_sfxBank length 0x${model._sfxBank.byteLength.toString(16)} must be a multiple of 4 (sfxbanksizepadded)`);
	}
	for (const ref of model.interfaceRefs) {
		if (ref._pad.length !== 3) fail(`interface reference '${ref.idName}' _pad must be 3 bytes`);
		for (let i = 0; i < ref.idName.length; i++) {
			const c = ref.idName.charCodeAt(i);
			if (c === 0 || c > 0xff) fail(`interface ID name "${ref.idName}" has a byte-unrepresentable character`);
		}
	}

	// --- Layout pass: every offset/size is derived, nothing stored. ---
	const sfxbankoffset = MODULE_BANK_HEADER_SIZE + model._moduleData.byteLength;
	const funcfixupoffset = sfxbankoffset + model._sfxBank.byteLength;
	const staticdatafixupoffset = funcfixupoffset + 4 + model.funcFixups.length * 4;
	const interfaceOffset = staticdatafixupoffset + 4 + model.staticDataFixups.length * 4;
	let idCursor = interfaceOffset + 4 + model.interfaceRefs.length * INTERFACE_REFERENCE_SIZE;
	const idOffsets: number[] = [];
	for (const ref of model.interfaceRefs) {
		idOffsets.push(idCursor);
		idCursor += 4 + ref.idName.length + 1;
	}
	const totalsize = align4(idCursor);
	const dataSize = align16(totalsize);

	const w = new BinWriter(ENVELOPE_SIZE + dataSize, littleEndian);
	w.writeU32(dataSize);
	w.writeU32(ENVELOPE_SIZE);
	w.writeBytes(model._envelopePad);

	// Not writeFixedString — that reserves the last byte for a NUL terminator.
	for (const c of 'ABKC') w.writeU8(c.charCodeAt(0));
	w.writeU8(1); // ver
	w.writeU8(1); // veraimexmajor
	w.writeU8(2); // veraimexminor
	w.writeU8(2); // veraimexpatch
	w.writeU8(model.platform);
	w.writeU8(model.targetType);
	w.writeU16(model.numModules);
	w.writeU32(0); // debugcrc
	w.writeU32(0); // uniqueid
	w.writeU32(totalsize);
	w.writeU32(sfxbankoffset); // residentsize — always the pre-SFX portion
	w.writeU32(MODULE_BANK_HEADER_SIZE); // moduleoffset
	w.writeU32(sfxbankoffset);
	w.writeU32(model._sfxBank.byteLength); // sfxbanksizepadded
	w.writeU32(0); // midibankoffset
	w.writeU32(0); // midibanksizepadded
	w.writeU32(funcfixupoffset);
	w.writeU32(staticdatafixupoffset);
	w.writeU32(interfaceOffset);
	w.writeU32(0); // modulebankhandle
	w.writeU32(0xffffffff); // pSnd10SampleBankHeader (runtime sentinel)
	w.writeU32(0xffffffff); // midibhandle
	w.writeU32(0); // streamfilepath
	w.writeU32(0); // streamfileoffset
	w.writeU32(0); // ln.pnext
	w.writeU32(0); // ln.pprev
	w.writeU32(0); // ptweakheader
	if (w.offset !== ENVELOPE_SIZE + MODULE_BANK_HEADER_SIZE) {
		fail(`writer header ended at 0x${w.offset.toString(16)}, expected 0x${(ENVELOPE_SIZE + MODULE_BANK_HEADER_SIZE).toString(16)}`);
	}

	// --- Verbatim interiors ---
	w.writeBytes(model._moduleData);
	w.writeBytes(model._sfxBank);

	// --- Fixup tables ---
	w.writeU32(model.funcFixups.length);
	for (const f of model.funcFixups) w.writeU32(f);
	w.writeU32(model.staticDataFixups.length);
	for (const f of model.staticDataFixups) w.writeU32(f);

	// --- Interface references + ID blobs ---
	w.writeU32(model.interfaceRefs.length);
	for (let i = 0; i < model.interfaceRefs.length; i++) {
		const ref = model.interfaceRefs[i];
		w.writeU32(ref.handleOffset);
		w.writeU32(idOffsets[i]);
		w.writeU8(ref.type);
		for (const p of ref._pad) w.writeU8(p);
	}
	for (const ref of model.interfaceRefs) {
		w.writeU32(((ref.idKey & 0xffff) << 16 | (ref.idCrc & 0xffff)) >>> 0);
		for (let i = 0; i < ref.idName.length; i++) w.writeU8(ref.idName.charCodeAt(i));
		w.writeU8(0);
	}
	if (w.offset !== ENVELOPE_SIZE + idCursor) {
		fail(`writer ID blobs ended at 0x${w.offset.toString(16)}, expected 0x${(ENVELOPE_SIZE + idCursor).toString(16)}`);
	}
	w.writeZeroes(ENVELOPE_SIZE + dataSize - w.offset);
	return w.bytes;
}

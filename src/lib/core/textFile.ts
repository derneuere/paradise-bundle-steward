// TextFile resource (resource type 0x3).
//
// Per burnout.wiki/wiki/TextFile: a development-only resource used in the
// original Bundle (BND1) container to store debug XML data — the
// `BundleImports` resource that lists the imports of a sibling bundle.
// Not used in retail Burnout Paradise. The wiki notes that the XML is often
// malformed (mismatched tags) in early builds; we do not validate the
// content, only the wrapper bytes.
//
// Layout (empirically confirmed on `example/older builds/PVS.BNDL`,
// X360 BND1 V5 prototype):
//   +0x00  uint32 LE  mLength  — string length, EXCLUDING the trailing
//                                null terminator. Always little-endian on
//                                disk regardless of the bundle's platform —
//                                the dev tool that wrote BND1 bundles ran
//                                on PC and never byte-swapped, since this
//                                type is dev-only and the X360 runtime
//                                never reads mLength back.
//   +0x04  char[]     mText    — the string itself, mLength bytes
//   +next  byte       NUL      — null terminator (always present)
//   +next  byte[]     pad      — zero-or-more bytes of trailing pad
//                                aligning the uncompressed slot to 16 bytes
//
// Round-trip: we capture the trailing pad (including the NUL) verbatim so
// the byte-for-byte slot layout matches the source exactly.

import { BinReader, BinWriter } from './binTools';

export type ParsedTextFile = {
	text: string;
	// Verbatim trailing bytes AFTER the text content. Includes the null
	// terminator and any alignment pad. Preserved so byte-exact round-trip
	// works whatever pad scheme the source file used.
	_trailingBytes: Uint8Array;
};

export function parseTextFileData(raw: Uint8Array, _littleEndian = true): ParsedTextFile {
	// mLength is always LE on disk — see comment above.
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), true);
	const length = r.readU32();
	if (length < 0 || length + 4 > raw.byteLength) {
		throw new Error(`TextFile: length ${length} doesn't fit in ${raw.byteLength}-byte payload`);
	}
	const textBytes = new Uint8Array(raw.buffer, raw.byteOffset + 4, length);
	const text = new TextDecoder('utf-8', { fatal: false }).decode(textBytes);
	const tailStart = 4 + length;
	const trailingBytes = raw.slice(tailStart, raw.byteLength);
	return { text, _trailingBytes: trailingBytes };
}

export function writeTextFileData(model: ParsedTextFile, _littleEndian = true): Uint8Array {
	const enc = new TextEncoder();
	const textBytes = enc.encode(model.text);
	const padLen = model._trailingBytes.byteLength;
	const totalSize = 4 + textBytes.byteLength + padLen;
	// mLength is always LE on disk — see comment above.
	const w = new BinWriter(totalSize, true);
	w.writeU32(textBytes.byteLength);
	w.writeBytes(textBytes);
	if (padLen > 0) w.writeBytes(model._trailingBytes);
	return w.bytes;
}

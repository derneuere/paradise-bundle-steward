// Platform headers that wrap BrnGui::ProfileManager::ProfileStoredData.
//
//  - RGMH (PC / PC Remastered): Microsoft "Rich Game Media" header. No
//    protection; carries a thumbnail and four WCHAR[1024] metadata strings.
//  - MC02 (Xbox 360): EA "Memory Card v2" header, big-endian, CRC-protected.
//    Edits require the three checksums to be recomputed (see crc32mc02.ts).
//  - none (PS3 / PS4 / Switch): the file IS the ProfileStoredData body.
//
// The header keeps its original bytes verbatim (`raw`); field edits patch that
// buffer in place so unrelated header bytes (thumbnail, padding) survive a
// round-trip untouched.

import { readU32, readU64, readGuid, writeGuid, readWideString, writeWideString } from './binio';
import { mc02Checksum } from './crc32mc02';
import type { HeaderKind } from './variants';

// RGMH field offsets (always little-endian; it is a Windows structure).
const RGMH = {
	gameName: { offset: 0x28, bytes: 0x800 },
	saveName: { offset: 0x828, bytes: 0x800 },
	levelName: { offset: 0x1028, bytes: 0x800 },
	comments: { offset: 0x1828, bytes: 0x800 },
	guid: 0x18,
} as const;

export type RgmhStringField = 'gameName' | 'saveName' | 'levelName' | 'comments';

export type RgmhHeader = {
	kind: 'rgmh';
	raw: Uint8Array; // [0, profileStart): RGMH header + thumbnail
	version: number;
	headerSize: number;
	thumbnailOffset: bigint;
	thumbnailSize: number;
	guid: string;
	gameName: string;
	saveName: string;
	levelName: string;
	comments: string;
};

export type Mc02Header = {
	kind: 'mc02';
	raw: Uint8Array; // [0, profileStart): 0x1C header (+ any user-header region)
	fileSize: number;
	userHeaderSize: number;
	userBodySize: number;
	userHeaderSignature: number;
	userBodySignature: number;
	fileHeaderSignature: number;
};

export type NoneHeader = { kind: 'none' };

export type ProfileHeader = RgmhHeader | Mc02Header | NoneHeader;

export type ParsedHeader = {
	header: ProfileHeader;
	bodyStart: number;
	bodyLength: number;
};

function magic4(bytes: Uint8Array): string {
	return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
}

// Independent copy — Node's Buffer.slice aliases its source, which would let a
// header edit mutate the caller's input buffer.
const copyOf = (u8: Uint8Array, start: number, end: number): Uint8Array =>
	new Uint8Array(u8.subarray(start, end));

export function detectHeaderKind(bytes: Uint8Array): HeaderKind {
	if (bytes.length < 4) return 'none';
	const m = magic4(bytes);
	if (m === 'RGMH') return 'rgmh';
	if (m === 'MC02') return 'mc02';
	return 'none';
}

export function parseHeader(bytes: Uint8Array): ParsedHeader {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const kind = detectHeaderKind(bytes);

	if (kind === 'rgmh') {
		const headerSize = readU32(view, 0x8, 'le');
		const thumbnailOffset = readU64(view, 0xc, 'le');
		const thumbnailSize = readU32(view, 0x14, 'le');
		const profileStart = headerSize + Number(thumbnailOffset) + thumbnailSize;
		const raw = copyOf(bytes, 0, profileStart);
		const str = (f: keyof typeof RGMH & RgmhStringField) =>
			readWideString(bytes, RGMH[f].offset, RGMH[f].bytes);
		return {
			header: {
				kind: 'rgmh', raw,
				version: readU32(view, 0x4, 'le'),
				headerSize, thumbnailOffset, thumbnailSize,
				guid: readGuid(bytes, RGMH.guid),
				gameName: str('gameName'), saveName: str('saveName'),
				levelName: str('levelName'), comments: str('comments'),
			},
			bodyStart: profileStart,
			bodyLength: bytes.length - profileStart,
		};
	}

	if (kind === 'mc02') {
		// MC02 header is big-endian on disk.
		const fileSize = readU32(view, 0x4, 'be');
		const userHeaderSize = readU32(view, 0x8, 'be');
		const userBodySize = readU32(view, 0xc, 'be');
		const profileStart = 0x1c + userHeaderSize;
		return {
			header: {
				kind: 'mc02', raw: copyOf(bytes, 0, profileStart),
				fileSize, userHeaderSize, userBodySize,
				userHeaderSignature: readU32(view, 0x10, 'be'),
				userBodySignature: readU32(view, 0x14, 'be'),
				fileHeaderSignature: readU32(view, 0x18, 'be'),
			},
			bodyStart: profileStart,
			bodyLength: userBodySize,
		};
	}

	return { header: { kind: 'none' }, bodyStart: 0, bodyLength: bytes.length };
}

export function setRgmhString(h: RgmhHeader, field: RgmhStringField, value: string): void {
	writeWideString(h.raw, RGMH[field].offset, RGMH[field].bytes, value);
	h[field] = value;
}

export function setRgmhGuid(h: RgmhHeader, guid: string): void {
	writeGuid(h.raw, RGMH.guid, guid);
	h.guid = guid;
}

/** Serialise header + body to the full file bytes (recomputing MC02 CRCs). */
export function writeFile(header: ProfileHeader, body: Uint8Array): Uint8Array {
	if (header.kind === 'none') return body.slice();

	if (header.kind === 'rgmh') {
		const out = new Uint8Array(header.raw.length + body.length);
		out.set(header.raw, 0);
		out.set(body, header.raw.length);
		return out;
	}

	// mc02 — recompute the three checksums over the new body.
	const raw = header.raw.slice();
	const out = new Uint8Array(raw.length + body.length);
	out.set(raw, 0);
	out.set(body, raw.length);
	const view = new DataView(out.buffer);

	const userHeader = out.subarray(0x1c, 0x1c + header.userHeaderSize);
	const sig0 = mc02Checksum(userHeader);
	const sig1 = mc02Checksum(body);
	view.setUint32(0x10, sig0, false);
	view.setUint32(0x14, sig1, false);
	const sig2 = mc02Checksum(out.subarray(0, 0x18));
	view.setUint32(0x18, sig2, false);

	header.userHeaderSignature = sig0;
	header.userBodySignature = sig1;
	header.fileHeaderSignature = sig2;
	return out;
}

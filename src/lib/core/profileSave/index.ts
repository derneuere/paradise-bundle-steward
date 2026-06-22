// Burnout Paradise save-profile codec (Profile.BurnoutParadiseSave).
//
// A save file = optional platform header (RGMH / MC02 / none) + a fixed-size
// ProfileStoredData body. The body is a sequence of FixedSizeOpaqueBuffer
// chunks (Progression, Live Revenge, Options, DLC profiles, …). We split the
// body into those chunks (each byte-exact) and decode the ones we model.
//
// Editing is patch-in-place: a `ProfileChunk.raw` is mutated at a field's known
// offset, so any byte we don't touch survives load → save unchanged. The
// round-trip stress test asserts this against a real fixture.

import { parseHeader, writeFile, setRgmhString, setRgmhGuid, type ProfileHeader, type RgmhStringField } from './header';
import { detectVariant, type ProfileVariant, type ChunkDef } from './variants';
import { progressionSpec, PROGRESSION_REGISTRY } from './progression';
import { decodeStruct, writeFieldByPath, writeBit, type StructSpec, type StructRegistry, type Path, type LeafValue } from './struct';
import type { Endian } from './binio';

export * from './variants';
export type { ProfileHeader, RgmhStringField } from './header';
export type { StructSpec, Field, Path, LeafValue } from './struct';

export type ProfileChunk = ChunkDef & {
	/** Current bytes for this chunk (a mutable copy; edits patch it in place). */
	raw: Uint8Array;
	/** Decode spec, present only for chunks we model for this variant. */
	spec: StructSpec | null;
};

export type ProfileSave = {
	variant: ProfileVariant;
	header: ProfileHeader;
	endian: Endian;
	chunks: ProfileChunk[];
	/** The decode registry that the chunk specs resolve against. */
	registry: StructRegistry;
	/** Original file size, for display / sanity checks. */
	fileSize: number;
};

export class UnknownProfileError extends Error {}

// Force an independent byte copy. Node's Buffer.slice/subarray ALIAS the source
// buffer, so without this an edit to a chunk would mutate the caller's input;
// constructing a Uint8Array from a view always copies.
const copyOf = (u8: Uint8Array, start: number, end: number): Uint8Array =>
	new Uint8Array(u8.subarray(start, end));

export function parseProfileSave(input: Uint8Array | ArrayBuffer): ProfileSave {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	const { header, bodyStart, bodyLength } = parseHeader(bytes);
	const variant = detectVariant(header.kind, bodyLength);
	if (!variant) {
		throw new UnknownProfileError(
			`Not a recognised Burnout Paradise profile (header=${header.kind}, body=0x${bodyLength.toString(16)}).`,
		);
	}
	const body = copyOf(bytes, bodyStart, bodyStart + bodyLength);

	const chunks: ProfileChunk[] = variant.chunks.map((c) => ({
		...c,
		raw: copyOf(body, c.offset, c.offset + c.size),
		spec: c.key === 'progression' ? progressionSpec(variant.id) : null,
	}));

	return { variant, header, endian: variant.endian, chunks, registry: PROGRESSION_REGISTRY, fileSize: bytes.length };
}

export function writeProfileSave(save: ProfileSave): Uint8Array {
	const body = new Uint8Array(save.variant.bodyLength);
	for (const chunk of save.chunks) body.set(chunk.raw, chunk.offset);
	return writeFile(save.header, body);
}

export function getChunk(save: ProfileSave, key: string): ProfileChunk | undefined {
	return save.chunks.find((c) => c.key === key);
}

/** Decode a chunk to a display object, or null if the chunk isn't modelled. */
export function decodeChunk(save: ProfileSave, chunk: ProfileChunk): Record<string, unknown> | null {
	if (!chunk.spec) return null;
	return decodeStruct(chunk.spec, chunk.raw, 0, save.endian, save.registry);
}

/** Patch one scalar field inside a chunk (mutates chunk.raw). */
export function editChunkField(save: ProfileSave, chunk: ProfileChunk, path: Path, value: LeafValue): void {
	if (!chunk.spec) throw new Error(`chunk ${chunk.key} is not modelled`);
	writeFieldByPath(chunk.spec, chunk.raw, 0, path, value, save.endian, save.registry);
}

/** Flip a single bit inside a bitset field of a chunk. */
export function editChunkBit(save: ProfileSave, chunk: ProfileChunk, path: Path, bit: number, on: boolean): void {
	if (!chunk.spec) throw new Error(`chunk ${chunk.key} is not modelled`);
	writeBit(chunk.spec, chunk.raw, 0, path, bit, on, save.registry);
}

/** Edit an RGMH header metadata string (game/save/level/comments). */
export function editHeaderString(save: ProfileSave, field: RgmhStringField, value: string): void {
	if (save.header.kind !== 'rgmh') throw new Error('header has no editable strings');
	setRgmhString(save.header, field, value);
}

export function editHeaderGuid(save: ProfileSave, guid: string): void {
	if (save.header.kind !== 'rgmh') throw new Error('header has no GUID');
	setRgmhGuid(save.header, guid);
}

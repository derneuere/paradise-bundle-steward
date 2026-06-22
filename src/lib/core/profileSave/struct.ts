// Declarative struct engine for the save profile. A `StructSpec` mirrors a
// fixed-size C++ struct from the wiki; the engine decodes a byte range into a
// plain JS object for display and patches a single field (addressed by path)
// back into the bytes for editing. Untouched bytes are never rewritten, so a
// load → save with no edits is byte-identical, regardless of how much of the
// struct is actually modelled (padding and not-yet-modelled fields just pass
// through).

import {
	type Endian,
	readU8, readI8, readU16, readI16, readU32, readI32, readF32, readU64,
	writeU8, writeI8, writeU16, writeI16, writeU32, writeI32, writeF32, writeU64,
	readAscii, writeAscii,
} from './binio';

// A TypeSpec describes how to read/write one value. Fields and array elements
// share it; a Field is just a TypeSpec plus a name/offset and UI metadata.
export type ScalarKind = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32';

export type TypeSpec =
	| { kind: ScalarKind }
	| { kind: 'u64' | 'cgsid' } // 64-bit; cgsid renders as hex
	| { kind: 'bool' }
	| { kind: 'enum'; storage: ScalarKind; values: Record<number, string> }
	| { kind: 'flags'; storage: ScalarKind; bits: Record<number, string> }
	| { kind: 'ascii'; len: number }
	| { kind: 'vector3' } // 4×f32 (x,y,z + preserved w), 0x10 bytes
	| { kind: 'datetime'; size: number } // bool mbIsLocal @0 + u64 time @8
	| { kind: 'bytes'; len: number } // opaque blob, surfaced as hex only
	| { kind: 'bitset'; bits: number } // BitArray<N>: N bits, ceil(N/8) bytes
	| { kind: 'cgsidset'; capacity: number } // u32 count + u32 pad + capacity×u64
	| { kind: 'cgsidarray'; capacity: number } // same on-disk shape as cgsidset
	| { kind: 'struct'; ref: string }
	| { kind: 'array'; count: number; stride: number; element: TypeSpec };

export type Field = TypeSpec & {
	name: string;
	offset: number;
	label?: string;
	group?: string;
	note?: string;
};

export type StructSpec = {
	name: string;
	size: number;
	fields: Field[];
};

export type StructRegistry = Record<string, StructSpec>;

export type Path = (string | number)[];

// --- size + validation -----------------------------------------------------

export function typeSize(t: TypeSpec, reg: StructRegistry): number {
	switch (t.kind) {
		case 'i8': case 'u8': case 'bool': return 1;
		case 'i16': case 'u16': return 2;
		case 'i32': case 'u32': case 'f32': return 4;
		case 'u64': case 'cgsid': return 8;
		case 'enum': case 'flags': return typeSize({ kind: t.storage }, reg);
		case 'ascii': return t.len;
		case 'vector3': return 0x10;
		case 'datetime': return t.size;
		case 'bytes': return t.len;
		// CgsBitArray<N> is backed by 64-bit words, so it rounds up to 8 bytes
		// (e.g. BitArray<35u> occupies 0x8, BitArray<300000u> occupies 0x9280).
		case 'bitset': return Math.ceil(t.bits / 64) * 8;
		case 'cgsidset': case 'cgsidarray': return 8 + t.capacity * 8;
		case 'struct': return reg[t.ref].size;
		case 'array': return t.count * t.stride;
	}
}

/** Returns a list of layout problems (overruns / size mismatch), empty if OK. */
export function validateStruct(spec: StructSpec, reg: StructRegistry): string[] {
	const issues: string[] = [];
	for (const f of spec.fields) {
		const end = f.offset + typeSize(f, reg);
		if (end > spec.size) {
			issues.push(`${spec.name}.${f.name} ends at 0x${end.toString(16)} > size 0x${spec.size.toString(16)}`);
		}
	}
	return issues;
}

// --- decode (bytes → display object) ---------------------------------------

export function decodeType(t: TypeSpec, view: DataView, bytes: Uint8Array, base: number, e: Endian, reg: StructRegistry): unknown {
	switch (t.kind) {
		case 'u8': return readU8(view, base);
		case 'i8': return readI8(view, base);
		case 'u16': return readU16(view, base, e);
		case 'i16': return readI16(view, base, e);
		case 'u32': return readU32(view, base, e);
		case 'i32': return readI32(view, base, e);
		case 'f32': return readF32(view, base, e);
		case 'u64': case 'cgsid': return readU64(view, base, e);
		case 'bool': return readU8(view, base) !== 0;
		case 'enum': return decodeType({ kind: t.storage }, view, bytes, base, e, reg);
		case 'flags': return decodeType({ kind: t.storage }, view, bytes, base, e, reg);
		case 'ascii': return readAscii(bytes, base, t.len);
		case 'vector3':
			return { x: readF32(view, base, e), y: readF32(view, base + 4, e), z: readF32(view, base + 8, e) };
		case 'datetime':
			// mbIsLocal @0; the 64-bit time is the trailing 8 bytes (the field is
			// 0xC on Win/FILETIME platforms and 0x10 on the time_t platforms).
			return { mbIsLocal: readU8(view, base) !== 0, mSystemTime: readU64(view, base + t.size - 8, e) };
		case 'bytes':
			return bytes.subarray(base, base + t.len);
		case 'bitset': {
			const set: number[] = [];
			for (let i = 0; i < t.bits; i++) {
				if ((bytes[base + (i >> 3)] >> (i & 7)) & 1) set.push(i);
			}
			return set;
		}
		case 'cgsidset': case 'cgsidarray': {
			const count = readU32(view, base, e);
			const ids: bigint[] = [];
			for (let i = 0; i < t.capacity; i++) ids.push(readU64(view, base + 8 + i * 8, e));
			return { count, ids };
		}
		case 'struct': {
			const spec = reg[t.ref];
			const obj: Record<string, unknown> = {};
			for (const f of spec.fields) obj[f.name] = decodeType(f, view, bytes, base + f.offset, e, reg);
			return obj;
		}
		case 'array': {
			const arr: unknown[] = [];
			for (let i = 0; i < t.count; i++) arr.push(decodeType(t.element, view, bytes, base + i * t.stride, e, reg));
			return arr;
		}
	}
}

export function decodeStruct(spec: StructSpec, bytes: Uint8Array, base: number, e: Endian, reg: StructRegistry): Record<string, unknown> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return decodeType({ kind: 'struct', ref: spec.name }, view, bytes, base, e, { ...reg, [spec.name]: spec }) as Record<string, unknown>;
}

// --- locate (path → leaf type + absolute offset) ---------------------------

type Located = { type: TypeSpec; offset: number };

function locate(t: TypeSpec, base: number, path: Path, reg: StructRegistry): Located {
	if (path.length === 0) return { type: t, offset: base };
	const head = path[0];
	const rest = path.slice(1);
	switch (t.kind) {
		case 'struct': {
			const f = reg[t.ref].fields.find((x) => x.name === head);
			if (!f) throw new Error(`no field ${String(head)} in ${t.ref}`);
			return locate(f, base + f.offset, rest, reg);
		}
		case 'array':
			return locate(t.element, base + (head as number) * t.stride, rest, reg);
		case 'vector3': {
			const comp = { x: 0, y: 1, z: 2, w: 3 }[head as 'x' | 'y' | 'z' | 'w'];
			return { type: { kind: 'f32' }, offset: base + comp * 4 };
		}
		case 'datetime':
			if (head === 'mbIsLocal') return { type: { kind: 'bool' }, offset: base };
			return { type: { kind: 'u64' }, offset: base + t.size - 8 };
		case 'cgsidset': case 'cgsidarray':
			if (head === 'count') return { type: { kind: 'u32' }, offset: base };
			// path: ['ids', index]
			return { type: { kind: 'cgsid' }, offset: base + 8 + (rest[0] as number) * 8 };
		default:
			throw new Error(`cannot descend into ${t.kind} with path ${JSON.stringify(path)}`);
	}
}

// --- write a single field, addressed by path -------------------------------

export type LeafValue = number | bigint | boolean | string;

export function writeFieldByPath(spec: StructSpec, bytes: Uint8Array, base: number, path: Path, value: LeafValue, e: Endian, reg: StructRegistry): void {
	const full = { ...reg, [spec.name]: spec };
	const { type, offset } = locate({ kind: 'struct', ref: spec.name }, base, path, full);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	switch (type.kind) {
		case 'u8': writeU8(view, offset, value as number); break;
		case 'i8': writeI8(view, offset, value as number); break;
		case 'u16': writeU16(view, offset, value as number, e); break;
		case 'i16': writeI16(view, offset, value as number, e); break;
		case 'u32': writeU32(view, offset, value as number, e); break;
		case 'i32': writeI32(view, offset, value as number, e); break;
		case 'f32': writeF32(view, offset, value as number, e); break;
		case 'u64': case 'cgsid': writeU64(view, offset, value as bigint, e); break;
		case 'bool': writeU8(view, offset, value ? 1 : 0); break;
		case 'enum': case 'flags': {
			const w = { ...type, kind: type.storage } as TypeSpec;
			writeFieldByPath({ name: '_', size: 0, fields: [{ ...w, name: 'v', offset: 0 }] }, bytes, offset, ['v'], value, e, reg);
			break;
		}
		case 'ascii': writeAscii(bytes, offset, type.len, value as string); break;
		default:
			throw new Error(`unsupported leaf write for ${type.kind}`);
	}
}

/** Flip a single bit inside a `bitset` field. Path = [...to bitset field]. */
export function writeBit(spec: StructSpec, bytes: Uint8Array, base: number, path: Path, bit: number, on: boolean, reg: StructRegistry): void {
	const full = { ...reg, [spec.name]: spec };
	const { offset } = locate({ kind: 'struct', ref: spec.name }, base, path, full);
	const byte = offset + (bit >> 3);
	const mask = 1 << (bit & 7);
	if (on) bytes[byte] |= mask; else bytes[byte] &= ~mask & 0xff;
}

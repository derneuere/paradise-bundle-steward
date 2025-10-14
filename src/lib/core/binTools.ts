// =============================================================================
// Low-level Binary Utilities (kept for writer and pointer-chasing parse)
// =============================================================================

export class BinReader {
	private view: DataView;
	private offset = 0;
	private little: boolean;

	constructor(buf: ArrayBufferLike, littleEndian: boolean) {
		this.view = new DataView(buf as ArrayBuffer);
		this.little = littleEndian;
	}

	get position(): number { return this.offset; }
	set position(pos: number) { this.offset = pos >>> 0; }

	readU8(): number { const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
	readI8(): number { const v = this.view.getInt8(this.offset); this.offset += 1; return v; }
	readU16(): number { const v = this.view.getUint16(this.offset, this.little); this.offset += 2; return v; }
	readI16(): number { const v = this.view.getInt16(this.offset, this.little); this.offset += 2; return v; }
	readU32(): number { const v = this.view.getUint32(this.offset, this.little); this.offset += 4; return v >>> 0; }
	readI32(): number { const v = this.view.getInt32(this.offset, this.little); this.offset += 4; return v | 0; }
	readF32(): number { const v = this.view.getFloat32(this.offset, this.little); this.offset += 4; return v; }
	readF64(): number { const v = this.view.getFloat64(this.offset, this.little); this.offset += 8; return v; }
	readU64(): bigint {
		const low = BigInt(this.view.getUint32(this.offset + (this.little ? 0 : 4), this.little));
		const high = BigInt(this.view.getUint32(this.offset + (this.little ? 4 : 0), this.little));
		this.offset += 8;
		return (high << 32n) | (low & 0xFFFFFFFFn);
	}
    // this should be typed better with typed-binary
    readArray<T>(schema: any, count: number): T[] {
        const arr: T[] = [];
        for (let i = 0; i < count; i++) {
            arr.push(schema.read(this));
        }
        return arr;
    }
    readFixedString(length: number): string {
        const str = new TextDecoder().decode(this.view.buffer.slice(this.offset, this.offset + length));
        this.offset += length;
        return str;
    }
}

export class BinWriter {
	private buf: Uint8Array;
	private view: DataView;
	private little: boolean;
	private _offset = 0;

	constructor(initialSize: number, littleEndian: boolean) {
		this.buf = new Uint8Array(Math.max(1024, initialSize >>> 0));
		this.view = new DataView(this.buf.buffer);
		this.little = littleEndian;
	}

	get offset(): number { return this._offset; }
	get bytes(): Uint8Array { return this.buf.subarray(0, this._offset); }

	private ensure(extra: number) {
		const need = this._offset + extra;
		if (need <= this.buf.length) return;
		let size = this.buf.length;
		while (size < need) size <<= 1;
		const next = new Uint8Array(size);
		next.set(this.buf);
		this.buf = next;
		this.view = new DataView(this.buf.buffer);
	}

	setU32(at: number, value: number) { this.view.setUint32(at >>> 0, value >>> 0, this.little); }

	writeU8(v: number) { this.ensure(1); this.view.setUint8(this._offset, v & 0xFF); this._offset += 1; }
	writeI8(v: number) { this.ensure(1); this.view.setInt8(this._offset, v | 0); this._offset += 1; }
	writeU16(v: number) { this.ensure(2); this.view.setUint16(this._offset, v >>> 0, this.little); this._offset += 2; }
	writeI16(v: number) { this.ensure(2); this.view.setInt16(this._offset, v | 0, this.little); this._offset += 2; }
	writeU32(v: number) { this.ensure(4); this.view.setUint32(this._offset, v >>> 0, this.little); this._offset += 4; }
	writeI32(v: number) { this.ensure(4); this.view.setInt32(this._offset, v | 0, this.little); this._offset += 4; }
	writeF32(v: number) { this.ensure(4); this.view.setFloat32(this._offset, v, this.little); this._offset += 4; }
	writeF64(v: number) { this.ensure(8); this.view.setFloat64(this._offset, v, this.little); this._offset += 8; }
	writeU64(v: bigint) {
		const low = Number(v & 0xFFFFFFFFn) >>> 0;
		const high = Number((v >> 32n) & 0xFFFFFFFFn) >>> 0;
		if (this.little) { this.writeU32(low); this.writeU32(high); }
		else { this.writeU32(high); this.writeU32(low); }
	}
	writeBytes(arr: Uint8Array) { this.ensure(arr.length); this.buf.set(arr, this._offset); this._offset += arr.length; }
	writeZeroes(n: number) { this.ensure(n); this.buf.fill(0, this._offset, this._offset + n); this._offset += n; }
	writeFixedString(str: string, length: number) {
		const bytes = new Uint8Array(length);
		const encoded = new TextEncoder().encode(str);
		const toCopy = Math.min(encoded.length, length - 1);
		bytes.set(encoded.subarray(0, toCopy));
		// null-terminated by default due to zeroed buffer
		this.writeBytes(bytes);
	}
	align16() {
		const mod = this._offset % 16;
		if (mod !== 0) this.writeZeroes(16 - mod);
	}
}
// Per-material shader constants stored inside a Material (0x1) resource.
//
// A Material doesn't just pick a Shader and textures: it carries its own values
// for the shader's tunable constants, which override the defaults baked into
// the Shader resource. On vehicles these are what make paint, chrome, plastic
// and glass differ while sharing a handful of shaders: g_fresnelRanges (how
// much environment reflection at normal vs grazing incidence), g_reflectConstants,
// g_specularConstants, materialDiffuse. Paint, for instance, overrides the
// PaintGloss default reflection range of 0.5–1.0 down to 0.2–0.9.
//
// Layout (32-bit PC, little-endian; pointers are offsets from the resource
// start, 0 = absent): the words at +0x14 and +0x18 each point at a constant
// block (on retail vehicles the first is always empty and the second holds the
// pixel-shader values):
//   u32 count
//   u32 sizesOffset    → u32[count]  size of each constant in float4s
//   u32 dataOffset     → u32[count]  offset of each constant's float data
//   u32 hashesOffset   → u32[count]  constant name hash (the same hash the
//                                    Shader resource stores beside each name)
//   u32 (handles, filled at load time)
// The parser is read-only and defensive: any offset outside the resource ends
// that block rather than throwing.

export type MaterialShaderConstant = {
	/** Name hash, matching ParsedShaderConstant.hash of the material's shader. */
	hash: number;
	/** 4 floats per register. */
	values: number[];
};

const BLOCK_POINTER_OFFSETS = [0x14, 0x18];
const MAX_CONSTANTS = 64;
const MAX_REGISTERS = 16;

export function parseMaterialShaderConstants(raw: Uint8Array): MaterialShaderConstant[] {
	const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
	const len = raw.byteLength;
	const u32 = (o: number) => (o >= 0 && o + 4 <= len ? dv.getUint32(o, true) : null);
	const out: MaterialShaderConstant[] = [];
	for (const at of BLOCK_POINTER_OFFSETS) {
		const block = u32(at);
		if (!block) continue;
		const count = u32(block);
		const sizes = u32(block + 4);
		const data = u32(block + 8);
		const hashes = u32(block + 12);
		if (count == null || sizes == null || data == null || hashes == null || count > MAX_CONSTANTS) continue;
		for (let i = 0; i < count; i++) {
			const size = u32(sizes + 4 * i);
			const ptr = u32(data + 4 * i);
			const hash = u32(hashes + 4 * i);
			if (size == null || ptr == null || hash == null || size < 1 || size > MAX_REGISTERS) break;
			if (ptr + size * 16 > len) break;
			const values: number[] = [];
			for (let k = 0; k < size * 4; k++) values.push(dv.getFloat32(ptr + 4 * k, true));
			out.push({ hash, values });
		}
	}
	return out;
}

/** The hash the game stores for a constant name: CRC-32 (reflected, poly
 *  0xEDB88320, initial ~0) without the final inversion. */
export function constantNameHash(name: string): number {
	let c = ~0;
	for (let i = 0; i < name.length; i++) {
		c ^= name.charCodeAt(i) & 0xff;
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
	}
	return c >>> 0;
}

/** A material's value for a constant, by name, without the Shader resource. */
export function materialConstant(constants: readonly MaterialShaderConstant[], name: string): number[] | null {
	const hash = constantNameHash(name);
	return constants.find((c) => c.hash >>> 0 === hash)?.values ?? null;
}

/** Resolve hashed constants to RDEF names via the shader's own (name, hash) table. */
export function materialConstantsByName(
	constants: readonly MaterialShaderConstant[],
	shaderConstants: readonly { name: string; hash: number }[],
): Record<string, number[]> {
	const nameByHash = new Map(shaderConstants.map((c) => [c.hash >>> 0, c.name]));
	const out: Record<string, number[]> = {};
	for (const c of constants) {
		const name = nameByHash.get(c.hash >>> 0);
		if (name) out[name] = c.values;
	}
	return out;
}

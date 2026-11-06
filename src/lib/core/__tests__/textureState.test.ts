// TextureState (0xE): the sampler fields as the PC build stores them.

import { describe, expect, it } from 'vitest';
// The registry first: textureState's handler reads its enum at load.
import '@/lib/core/bundle';
import { parseTextureState } from '@/lib/core/textureState';

// A retail vehicle TextureState (80 bytes), words verbatim.
const RETAIL = '1 1 1 1 1 1 ff7fffff 7f7fffff 1 bf666666 ffffffff 7bcd00 1 0 0 0 2659a59 0 38 0';

function blob(words: string): Uint8Array {
	const w = words.split(' ').map((x) => parseInt(x, 16));
	const out = new Uint8Array(w.length * 4);
	const dv = new DataView(out.buffer);
	w.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true));
	return out;
}

describe('parseTextureState', () => {
	it('reads the LOD range, anisotropy and mip bias at 0x18..0x24', () => {
		const ts = parseTextureState(blob(RETAIL), new Map([[0x38, 0x1234n]]));
		expect(ts.addressU).toBe(1); // wrap
		expect(ts.addressV).toBe(1);
		expect(ts.minLod).toBe(-3.4028234663852886e38);
		expect(ts.maxLod).toBe(3.4028234663852886e38);
		expect(ts.maxAnisotropy).toBe(1);
		expect(ts.mipLodBias).toBeCloseTo(-0.9, 6);
		expect(ts.borderColor).toBe(0xffffffff);
		expect(ts.textureId).toBe(0x1234n);
	});

	it('rejects a truncated state', () => {
		expect(() => parseTextureState(new Uint8Array(0x20), new Map())).toThrow(/too small/);
	});
});

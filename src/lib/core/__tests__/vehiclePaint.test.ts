import { describe, it, expect } from 'vitest';
import {
	defaultCarPaint, paintShading, paintSlots, paletteEntryPaint, pearlOf, writePaint, RETAIL_DEFAULT_PAINT,
} from '../vehiclePaint';
import type { ParsedDxbc } from '../dxbc';
import type { PlayerCarColor, PlayerCarColours } from '../playerCarColors';

const colour = (red: number, green: number, blue: number): PlayerCarColor => ({
	red, green, blue, alpha: 1, hexValue: '', rgbValue: '', isNeon: red > 1 || red < 0,
});

const COLOURS = {
	totalColors: 3,
	palettes: [
		{ type: 0, typeName: 'Gloss', numColours: 2, paintColours: [colour(0.5, 0.1, 0), colour(0, 0, 1)], pearlColours: [colour(0.4, 0, 0), colour(0, 0, 0.5)] },
		{ type: 1, typeName: 'Metallic', numColours: 1, paintColours: [colour(1.7, -0.2, 0.3)], pearlColours: [] },
	],
} as PlayerCarColours;

describe('paletteEntryPaint', () => {
	it('returns the paint and pearl floats as stored', () => {
		expect(paletteEntryPaint(COLOURS, 0, 1)).toEqual({ r: 0, g: 0, b: 1, pearl: { r: 0, g: 0, b: 0.5 } });
	});

	it('keeps out-of-range (neon) values instead of clamping them', () => {
		expect(paletteEntryPaint(COLOURS, 1, 0)).toEqual({ r: 1.7, g: -0.2, b: 0.3, pearl: undefined });
	});

	it('is null for an entry that does not exist', () => {
		expect(paletteEntryPaint(COLOURS, 0, 2)).toBeNull();
		expect(paletteEntryPaint(COLOURS, 4, 0)).toBeNull();
	});
});

describe('defaultCarPaint', () => {
	it('is palette 0 / colour 0, the game fallback for an unpicked car', () => {
		expect(defaultCarPaint(COLOURS)).toEqual({ r: 0.5, g: 0.1, b: 0, pearl: { r: 0.4, g: 0, b: 0 } });
	});

	it('is the retail first Gloss colour without a palette', () => {
		expect(defaultCarPaint(null)).toBe(RETAIL_DEFAULT_PAINT);
		expect(defaultCarPaint({ palettes: [], totalColors: 0 })).toBe(RETAIL_DEFAULT_PAINT);
		expect(RETAIL_DEFAULT_PAINT.r).toBeCloseTo(0.784314, 6);
		expect(RETAIL_DEFAULT_PAINT.pearl!.r).toBeCloseTo(0.588235, 6);
	});
});

describe('pearlOf', () => {
	it('falls back to the paint itself (no view-angle shift)', () => {
		expect(pearlOf({ r: 1, g: 2, b: 3 })).toEqual({ r: 1, g: 2, b: 3 });
		expect(pearlOf({ r: 1, g: 2, b: 3, pearl: { r: 4, g: 5, b: 6 } })).toEqual({ r: 4, g: 5, b: 6 });
	});
});

describe('paintShading', () => {
	it('names how each paint-reading vehicle shader applies the paint', () => {
		expect(paintShading('Vehicle_Opaque_PaintGloss_Textured')).toBe('pearl');
		expect(paintShading('Vehicle_Opaque_PaintGloss_Textured_Traffic')).toBe('masked');
		expect(paintShading('Vehicle_Opaque_Decal_Textured_EnvMapped')).toBe('masked');
		expect(paintShading('Vehicle_Opaque_Decal_Textured_EnvMapped_PoliceLights')).toBe('masked');
		expect(paintShading('Vehicle_Opaque_NormalMap_SpecMap_Skin')).toBe('masked');
		expect(paintShading('Vehicle_Opaque_BodypartsSkin_EnvMapped')).toBe('solid');
	});

	it('is null for shaders that do not read it', () => {
		expect(paintShading('Vehicle_Opaque_PaintGloss_Textured_NormalMapped')).toBeNull();
		expect(paintShading('Vehicle_Greyscale_Window_Textured')).toBeNull();
		expect(paintShading('')).toBeNull();
		expect(paintShading(null)).toBeNull();
		expect(paintShading('constructor')).toBeNull();
	});
});

const program = (vars: { name: string; startOffset: number }[]) =>
	({ reflection: { constantBuffers: [{ name: '$Globals', variables: vars.map((v) => ({ ...v, size: 12 })) }] } }) as unknown as ParsedDxbc;

describe('paintSlots', () => {
	it('finds both constants across the programs', () => {
		const vs = program([{ name: 'world', startOffset: 44 * 16 }]);
		const ps = program([{ name: 'g_paintColour', startOffset: 177 * 16 }, { name: 'g_pearlescentColour', startOffset: 178 * 16 }]);
		expect(paintSlots([vs, ps])).toEqual({ paint: 177, pearl: 178 });
	});

	it('reports a paint-only shader', () => {
		expect(paintSlots([undefined, program([{ name: 'g_paintColour', startOffset: 229 * 16 }])])).toEqual({ paint: 229, pearl: null });
	});

	it('is null when neither is read', () => {
		expect(paintSlots([program([{ name: 'world', startOffset: 0 }]), undefined])).toBeNull();
	});
});

describe('writePaint', () => {
	const cb = () => Array.from({ length: 4 }, () => {
		const v = { x: 9, y: 9, z: 9, w: 9, set(x: number, y: number, z: number, w: number) { Object.assign(v, { x, y, z, w }); } };
		return v;
	});

	it('writes the raw paint and pearl with w = 1', () => {
		const slots = cb();
		writePaint(slots, { paint: 1, pearl: 2 }, { r: 1.5, g: 0.2, b: -0.1, pearl: { r: 0.3, g: 0.4, b: 0.5 } });
		expect([slots[1].x, slots[1].y, slots[1].z, slots[1].w]).toEqual([1.5, 0.2, -0.1, 1]);
		expect([slots[2].x, slots[2].y, slots[2].z, slots[2].w]).toEqual([0.3, 0.4, 0.5, 1]);
		expect(slots[0].x).toBe(9);
	});

	it('writes the paint as the pearl when the paint has none', () => {
		const slots = cb();
		writePaint(slots, { paint: null, pearl: 3 }, { r: 0.1, g: 0.2, b: 0.3 });
		expect([slots[3].x, slots[3].y, slots[3].z]).toEqual([0.1, 0.2, 0.3]);
	});

	it('ignores slots past the buffer', () => {
		expect(() => writePaint(cb(), { paint: 10, pearl: null }, RETAIL_DEFAULT_PAINT)).not.toThrow();
	});
});

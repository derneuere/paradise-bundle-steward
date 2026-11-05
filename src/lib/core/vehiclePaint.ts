// How the game paints a car for its vehicle shaders.
//
// A car's colour is a (palette, colour) pair into PlayerCarColours. Every
// frame the game copies that entry's paint and pearl Vector4s, unchanged, into
// two shader constants, g_paintColour and g_pearlescentColour. Unpicked
// (-1) indices fall back to palette 0 / colour 0, so a car is never drawn
// without a paint. The values are the raw floats of the resource: no clamp
// (out-of-range "neon" entries reach the shader as they are) and no colour
// space conversion; the shaders mix them with raw texels.
//
// What the shaders do with them (the retail SHADERS.BNDL):
// - PaintGloss_Textured: the paint shifts with the view angle,
//   paint' = mix(pearl, paint, min(|N - V|^2, 1)) with N the surface normal and
//   V the unit vector to the eye. Face-on (N.V = 1) shows the pearl colour,
//   from 60 degrees off (N.V <= 0.5) the paint colour. The albedo is then
//   mix(paint', diffuse.rgb, diffuse.a): the diffuse alpha masks the livery,
//   alpha 0 = paint.
// - PaintGloss_Textured_Traffic, Decal_Textured_EnvMapped (+_PoliceLights),
//   NormalMap_SpecMap_Skin: mix(paint, diffuse.rgb, diffuse.a), no pearl.
// - BodypartsSkin_EnvMapped: no diffuse map at all; the albedo is the paint.
// Other vehicle shaders (PaintGloss_Textured_NormalMapped included) don't
// read the paint.

import type { ParsedDxbc } from './dxbc';
import type { PlayerCarColours } from './playerCarColors';

export type Rgb = { r: number; g: number; b: number };
/** A car paint: the paint colour plus, from a palette, its pearl colour. */
export type CarPaint = Rgb & { pearl?: Rgb };

// Palette 0 / colour 0 of the retail PlayerCarColours (Gloss, a red): what
// the game draws a car with when no colour was chosen.
export const RETAIL_DEFAULT_PAINT: CarPaint = {
	r: 200 / 255, g: 0, b: 0,
	pearl: { r: 150 / 255, g: 0, b: 0 },
};

/** One palette entry as the game uploads it, or null when it doesn't exist. */
export function paletteEntryPaint(colours: PlayerCarColours, palette: number, colour: number): CarPaint | null {
	const p = colours.palettes[palette];
	const c = p?.paintColours[colour];
	if (!c) return null;
	const q = p.pearlColours[colour];
	return { r: c.red, g: c.green, b: c.blue, pearl: q ? { r: q.red, g: q.green, b: q.blue } : undefined };
}

/** The paint of a car with no colour chosen. */
export function defaultCarPaint(colours: PlayerCarColours | null): CarPaint {
	return (colours && paletteEntryPaint(colours, 0, 0)) ?? RETAIL_DEFAULT_PAINT;
}

/** The pearl colour; a paint without one (not from a palette) shows no shift. */
export const pearlOf = (p: CarPaint): Rgb => p.pearl ?? p;

export type PaintShading = 'pearl' | 'masked' | 'solid';

const SHADING = new Map<string, PaintShading>([
	['Vehicle_Opaque_PaintGloss_Textured', 'pearl'],
	['Vehicle_Opaque_PaintGloss_Textured_Traffic', 'masked'],
	['Vehicle_Opaque_Decal_Textured_EnvMapped', 'masked'],
	['Vehicle_Opaque_Decal_Textured_EnvMapped_PoliceLights', 'masked'],
	['Vehicle_Opaque_NormalMap_SpecMap_Skin', 'masked'],
	['Vehicle_Opaque_BodypartsSkin_EnvMapped', 'solid'],
]);

/** How a vehicle shader applies the paint, or null if it doesn't. */
export function paintShading(shaderName: string | null | undefined): PaintShading | null {
	return (shaderName && SHADING.get(shaderName)) || null;
}

export type PaintSlots = { paint: number | null; pearl: number | null };

/** cb0 slots of g_paintColour / g_pearlescentColour in either program, or null. */
export function paintSlots(programs: readonly (ParsedDxbc | undefined)[]): PaintSlots | null {
	const out: PaintSlots = { paint: null, pearl: null };
	for (const p of programs) {
		for (const cb of p?.reflection.constantBuffers ?? []) {
			for (const v of cb.variables) {
				const slot = Math.floor(v.startOffset / 16);
				if (v.name === 'g_paintColour') out.paint ??= slot;
				else if (v.name === 'g_pearlescentColour') out.pearl ??= slot;
			}
		}
	}
	return out.paint == null && out.pearl == null ? null : out;
}

type Vec4Slot = { set(x: number, y: number, z: number, w: number): unknown };

/** Write a paint into its cb0 slots, as the game uploads it. */
export function writePaint(cb: readonly Vec4Slot[], slots: PaintSlots, paint: CarPaint): void {
	const pearl = pearlOf(paint);
	if (slots.paint != null) cb[slots.paint]?.set(paint.r, paint.g, paint.b, 1);
	if (slots.pearl != null) cb[slots.pearl]?.set(pearl.r, pearl.g, pearl.b, 1);
}

// How a car's windows draw, given their glass state. The game keeps one
// "render damage" bit per pane slot (body-part type - 16) and sets it the
// moment the pane cracks, not only when it smashes: every window mesh whose
// mesh flags carry a set bit stops being drawn. A cracked pane is redrawn
// with its shattered-glass model from the GraphicsSpec, through the same
// glass shader with three fracture constants set for that pane; a smashed
// pane draws nothing and stays a hole.
//
// The fracture constants (the glass shaders' g_glassFractureStrength,
// g_glassFractureUVOffsets and g_glassFractureFresnelRanges):
//   strength  = { (1 - s) / s, 1 / s, 0, 0 }   (all 0 when s = 0)
//   uvOffsets = the pane's row of a fixed table, by its GraphicsSpec index
//   uvScale   = { w, w * e, w, w * e }
// with s the pane's crack amount (0..1, only ever grows), w the pane width
// |corner2 - corner1| and e = |corner1 - corner0| / w. The vertex shader
// maps the second UV set to two crack-texture lookups, uv1.xyxy * uvScale +
// uvOffsets; the pixel shader takes the max of both and remaps it by
// saturate((crack - (1 - s)) / s), so a light crack shows only the
// brightest lines of the texture and a full one all of them. Every car is
// reset to "no fracture" (s = 0, e = 1, scale 0, offsets 0) before its
// panes are drawn, so intact glass never shows cracks.

import type { Vec4 } from '../deformationSpec';
import { GlassState } from './events';
import type { SimState } from './state';

export type FractureConstants = { strength: Vec4; uvOffsets: Vec4; uvScale: Vec4 };

// Two crack-texture offsets per entry (xy, zw), so the panes of one car
// don't crack alike. Indexed by the shattered-glass entry's position in the
// GraphicsSpec table; entries past the eighth reuse the last row.
export const GLASS_FRACTURE_UV_OFFSETS: readonly Vec4[] = [
	[-0.0, 0.5, 0.9, 0.1],
	[-0.2, -0.7, 0.3, 0.8],
	[-0.5, 0.8, 0.6, 0.9],
	[-0.1, 0.7, 0.5, 0.7],
	[-0.9, -0.9, 0.8, 0.4],
	[-0.5, 0.3, 0.6, 0.6],
	[-0.8, 0.5, 0.5, 0.1],
	[-0.3, -0.3, 0.9, 0.4],
];

export function glassFractureConstants(strength: number, equalisation: number, scale: [number, number], uvOffsets: Vec4): FractureConstants {
	const inv = strength > 0 ? 1 / strength : 0;
	return {
		strength: [(1 - strength) * inv, inv, 0, 0],
		uvOffsets: [...uvOffsets] as Vec4,
		uvScale: [scale[0], scale[0] * equalisation, scale[1], scale[1] * equalisation],
	};
}

export const NO_FRACTURE: FractureConstants = glassFractureConstants(0, 1, [0, 0], [0, 0, 0, 0]);

const slotOf = (partType: number) => partType - 16;

// Bit per pane slot whose window meshes are no longer drawn: cracked or smashed.
export function damagedPaneBits(s: Pick<SimState, 'spec' | 'glass'>): number {
	let bits = 0;
	s.spec.glassPanes.forEach((g, p) => {
		const slot = slotOf(g.partType);
		const state = s.glass[p]?.state;
		if ((state === GlassState.Cracked || state === GlassState.Smashed) && slot >= 0 && slot < 8) bits |= 1 << slot;
	});
	return bits;
}

// The fracture constants a shattered-glass model is drawn with, or null
// while it isn't drawn (its pane is intact or smashed, or the car's
// DeformationSpec has no pane of that type).
export function crackedPaneConstants(s: Pick<SimState, 'spec' | 'glass'>, bodyPartType: number, glassIndex: number): FractureConstants | null {
	const p = s.spec.glassPanes.findIndex((g) => g.partType === bodyPartType);
	const pane = p >= 0 ? s.glass[p] : undefined;
	if (!pane || pane.state !== GlassState.Cracked) return null;
	const offsets = GLASS_FRACTURE_UV_OFFSETS[Math.min(Math.max(glassIndex, 0), GLASS_FRACTURE_UV_OFFSETS.length - 1)];
	return glassFractureConstants(Math.min(pane.crack, 1), pane.equalisation, [pane.width, pane.width], offsets);
}

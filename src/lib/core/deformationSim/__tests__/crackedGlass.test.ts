// Spec for how a window draws once its pane breaks: a cracked pane swaps its
// window meshes for the shattered-glass model with fracture constants made
// from the pane's crack amount and shape; a smashed pane draws nothing.

import { describe, expect, it } from 'vitest';
import type { GlassPane } from '../../deformationSpec';
import { createCrashSim, GlassState } from '../sim';
import { crackAmount, updateGlass } from '../glass';
import {
	crackedPaneConstants, damagedPaneBits, GLASS_FRACTURE_UV_OFFSETS, glassFractureConstants, NO_FRACTURE,
} from '../crackedGlass';
import { makeSpec } from './fixture';

// Two panes: a windscreen (type 20, slot 4) on the shell's tag corners and a
// side window (type 16, slot 0).
function twoPaneSim() {
	const spec = makeSpec();
	const pane = (partType: number): GlassPane => ({
		plane: [0, 0, 1, 0],
		matrix: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
		cornerTagIndices: [0, 3, 4, 0], bytes58: [1, 1, 1, 1],
		short5C: 0, short5E: 0, short60: 0, partType,
	});
	spec.glassPanes = [pane(20), pane(16)];
	return createCrashSim(spec);
}

describe('glassFractureConstants', () => {
	it('packs strength, offsets and scale the way the glass shaders read them', () => {
		const c = glassFractureConstants(0.25, 0.5, [1.2, 1.2], [-0.2, -0.7, 0.3, 0.8]);
		expect(c.strength).toEqual([3, 4, 0, 0]);
		expect(c.uvOffsets).toEqual([-0.2, -0.7, 0.3, 0.8]);
		expect(c.uvScale).toEqual([1.2, 0.6, 1.2, 0.6]);
	});

	it('reaches the whole crack texture at full strength', () => {
		expect(glassFractureConstants(1, 1, [1, 1], [0, 0, 0, 0]).strength).toEqual([0, 1, 0, 0]);
	});

	it('resets to all zeros: no crack line survives the remap', () => {
		expect(NO_FRACTURE).toEqual({ strength: [0, 0, 0, 0], uvOffsets: [0, 0, 0, 0], uvScale: [0, 0, 0, 0] });
	});
});

describe('crackedPaneConstants', () => {
	it('is null for an intact pane, a smashed pane, or a type the spec has no pane for', () => {
		const sim = twoPaneSim();
		expect(crackedPaneConstants(sim.state, 20, 0)).toBeNull();
		sim.state.glass[0].state = GlassState.Smashed;
		expect(crackedPaneConstants(sim.state, 20, 0)).toBeNull();
		sim.state.glass[0].state = GlassState.Cracked;
		expect(crackedPaneConstants(sim.state, 17, 0)).toBeNull();
	});

	it('takes the strength from the crack amount and the scale from the pane shape the sim reported', () => {
		const sim = twoPaneSim();
		const s = sim.state;
		// The tag corners at rest: shell nose (0, 0.5, 2.3), door (1, 0.5, 2.2), trim (0.5, 0.2, 2.2).
		s.tags[4] = [0.5, 0.2, 2.2 - 0.02];
		updateGlass(s);
		expect(s.glass[0].state).toBe(GlassState.Cracked);
		const c = crackedPaneConstants(s, 20, 3)!;
		const crack = crackAmount(0.02);
		expect(c.strength[1]).toBeCloseTo(1 / crack, 6);
		expect(c.strength[0]).toBeCloseTo((1 - crack) / crack, 6);
		const width = Math.hypot(0.5, 0.3, 0.02);
		const eq = Math.hypot(1, 0, 0.1) / width;
		expect(c.uvScale[0]).toBeCloseTo(width, 6);
		expect(c.uvScale[1]).toBeCloseTo(width * eq, 6);
		expect(c.uvOffsets).toEqual(GLASS_FRACTURE_UV_OFFSETS[3]);
	});

	it('reuses the last offsets row past the eighth table entry', () => {
		const sim = twoPaneSim();
		sim.state.glass[0] = { state: GlassState.Cracked, crack: 0.5, width: 1, equalisation: 1 };
		expect(crackedPaneConstants(sim.state, 20, 11)!.uvOffsets).toEqual(GLASS_FRACTURE_UV_OFFSETS[7]);
	});
});

describe('damagedPaneBits', () => {
	it('sets a pane slot once it cracks, and keeps it when it smashes', () => {
		const sim = twoPaneSim();
		expect(damagedPaneBits(sim.state)).toBe(0);
		sim.state.glass[0].state = GlassState.Cracked;
		expect(damagedPaneBits(sim.state)).toBe(1 << 4);
		sim.state.glass[1].state = GlassState.Smashed;
		expect(damagedPaneBits(sim.state)).toBe((1 << 4) | 1);
	});
});

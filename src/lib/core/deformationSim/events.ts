// What happened during one simulator step, for anything that reacts to a
// crash without being part of it (particle effects, readouts). The list is
// cleared at the start of every step, so after stepCrashSim it holds exactly
// that step's events. Positions and velocities are in the simulator's world
// frame (the handling frame at the moment of the hit; the car moves through
// it by carPos), which is where the game spawns its effects too.

import type { Vec3 } from '../deformationSpec';

export type ContactEvent = {
	sensor: number;
	point: Vec3;         // on the obstacle's surface
	normal: Vec3;        // unit, out of the obstacle toward the car
	impulse: number;     // shaped contact impulse, N·s
	closingSpeed: number; // m/s along the normal
	// How fast the car slides across the surface here: the car body's
	// velocity at this contact (after the step's earlier contacts) with the
	// along-normal part removed. The car body only translates, so this is the
	// contact point's own slide (the solver's mid-step spin, which the step
	// throws away, is left out). Sparks need it; scratch and slide friction
	// read the same slide.
	slide: Vec3;
	scratch: number;     // paint scratch this contact added to its sensor
};

export type PartEvent = {
	part: number;        // IK part index
	gfx: number;         // GraphicsSpec part index
	partType: number;
	state: 'hinged' | 'detached';
	pos: Vec3;           // the part's origin
	vel: Vec3;           // the car's velocity when it came loose
};

export enum GlassState { Intact = 0, Cracked = 1, Smashed = 2 }

export type GlassEvent = {
	pane: number;        // index into spec.glassPanes
	partType: number;    // the pane's body-part type (16 + its render slot)
	state: GlassState.Cracked | GlassState.Smashed;
	crack: number;       // 0..1 for a crack, 0 for a smash
	corners: [Vec3, Vec3, Vec3, Vec3];
	normal: Vec3;
	carVel: Vec3;
};

export type CrashEvents = {
	// The car's position and velocity as the step began (before its contacts).
	car: { pos: Vec3; vel: Vec3 };
	contacts: ContactEvent[];
	parts: PartEvent[];
	glass: GlassEvent[];
};

export const emptyEvents = (): CrashEvents => ({ car: { pos: [0, 0, 0], vel: [0, 0, 0] }, contacts: [], parts: [], glass: [] });

export function clearEvents(e: CrashEvents, carPos: Vec3, carVel: Vec3): void {
	e.car = { pos: [...carPos] as Vec3, vel: [...carVel] as Vec3 };
	e.contacts.length = 0;
	e.parts.length = 0;
	e.glass.length = 0;
}

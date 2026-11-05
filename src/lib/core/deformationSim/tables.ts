// Constants of the game's crash-deformation model. All of them are the
// shipped values; nothing here is tuned for the editor.

import type { Vec3 } from '../deformationSpec';

export const STEP = 1 / 60;

// The six crush directions a sensor's spec budgets (directionParams[d]) and
// passes impulses along (nextSensor[d]), in car-local axes.
export const DIRECTIONS: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export enum AbsorptionSet { Normal = 0, AiCrashing = 1, PlayerExtremeCrash = 2, Shutdown = 3, Invincible = 4 }

type Row = { absorption: number; speedForMax: number; proportion: number };
const set = (abs: number[], speed: number, prop: number[]): Row[] =>
	abs.map((absorption, i) => ({ absorption, speedForMax: speed, proportion: prop[i] }));
const NORMAL_ABS = [0.98, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
const AI_ABS = [0.98, 0.95, 0.92, 0.91, 0.9, 0.8, 0.5, 0.3, 0.2, 0.1];
const AI_ROWS = set(AI_ABS, 30, [0.5, 0.5, 0.5, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4]);

// [set][sensor absorption level 0..9]
export const ABSORPTION: Row[][] = [
	set(NORMAL_ABS, 80, [0, 0, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6]),
	AI_ROWS,
	set(NORMAL_ABS, 30, [1, 1, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7]),
	AI_ROWS,
	set(new Array(10).fill(0), 100, new Array(10).fill(0)),
];

// speedForMax scale per crush direction (+X, -X, +Y, -Y, +Z, -Z).
export const DIRECTION_SPEED_SCALE = [0.5, 0.5, 1.0, 0.2, 1.0, 1.0];
// Crush-budget multiplier per absorption set.
export const COMPRESSION_LIMIT_FACTOR = [1.0, 1.0, 1.5, 1.25, 1.0];

// A crashing car may use its whole crush budget and absorption; a car that is
// only scraping along is held to 0.2 of both.
export const CRASH_BUDGET = 1.0;
export const DRIVE_BUDGET = 0.2;
// Extra room past the current deformed face a crashing sensor may be pushed.
export const CRASH_LIMIT_PAD = 0.5;
// Only half of the solved collision impulse is fed to deformation and to the
// car's velocity (restitution is 0 outside Showtime).
export const IMPULSE_SHAPING = 0.5;

// IK relaxation rates: tag points move toward their sensor-driven target in
// four passes, the driven points re-solve after each pass.
export const IK_RATES = [0.05, 0.1, 0.5, 1.0];

// Detachment.
export const MIN_IMPULSE_FOR_DETACHMENT = 500;
export const MAX_IMPULSE_FOR_DETACHMENT = 5000;
export const MAX_IMPULSE_FOR_DETACHMENT_TOUGH = 1200;
export const MAX_PHYSICAL_PARTS = 20;
export const JOINT_NEVER_BREAKS = -0.9;
export const JOINT_ROTATION_GATE = 0.3;
export const SILL_PARTS = new Set([24, 25]);           // driven points clamped into the deformed box
export const SKINNING_CLAMP_MARGIN: Vec3 = [0.1, 0, 0];

// Hinge joints.
export const GRAVITY = 9.81;
export const JOINT_RELAX = 0.975;
export const JOINT_BOUNCE = -0.1;
export const ANCHOR_CLAMP = 0.5;

// Free (detached) parts.
export const PART_MAX_SPEED = 60;
export const PART_MAX_SPIN = 5;

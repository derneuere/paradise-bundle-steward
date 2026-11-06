// The game's crash-effect parameters: spark showers, debris, dust and smoke.
// None of these are data-driven particle descriptions; the game ships them
// as fixed attrib values for its native spark / debris / smoke arrays. All
// values are the shipped ones (lengths in metres, times in seconds).

import type { Vec3 } from '../deformationSpec';

// ---- Sparks -----------------------------------------------------------------

// A crashing car's contact throws a shower once the contact slides faster
// than 15 mph across the surface; the next one may follow 0.02 - 0.15 s later.
export const SPARK_MIN_SLIDE = 6.7041669;
export const SPARK_COOLDOWN = { base: 0.02, random: 0.13 };
// Shower size from the slide speed: 0 at 10 mph, 1 at ~50 mph, halved at random.
export const SPARK_SIZE_FROM = 4.4694443;
export const SPARK_SIZE_SLOPE = 0.0559353642;
// 100 sparks for the smallest shower, 250 for the biggest.
export const SPARK_COUNT = { base: 100.5, perSize: 150 };

type Range = [number, number];
// Every controller value is lerped small -> large by the shower size squared.
export type SparkController = {
	lateral: [Range, Range];   // degrees off the surface
	forward: [Range, Range];   // degrees around the surface normal
	speed: [Range, Range];     // m/s, scaled down below the speed threshold
	inherit: [Range, Range];   // share of the slide velocity a spark keeps
	size: [Range, Range];
	radiusX: [number, number];  // spawn scatter along the normal
	radiusYZ: [number, number]; // spawn scatter across the surface
	reflection: number;
	speedThreshold: number;
};

export const CRASH_SHOWER: SparkController = {
	lateral: [[2, 10], [2, 15]],
	forward: [[-180, 180], [-180, 180]],
	speed: [[5, 12], [8, 20]],
	inherit: [[0.6, 1.0], [0.6, 1.2]],
	size: [[0.5, 1.25], [0.75, 1.75]],
	radiusX: [0, 0],
	radiusYZ: [0.1, 0.2],
	reflection: 2.0,
	speedThreshold: 44.694,
};

// The crash spark array. Colour and lifetime are fixed per spark, picked by
// its index & 3; there is no colour-over-life.
export const CRASH_SPARKS = {
	colours: [[1, 0.88, 0.68], [1, 0.839, 0.527], [1, 0.855, 0.597], [0.617, 0.768, 1]] as Vec3[],
	lifetimes: [0.3, 0.1, 0.2, 0.15],
	radius: 0.02,          // ribbon half-width per unit spark size
	blurTime: 0.025,       // the ribbon spans this much of the spark's path
	gravity: -9.81,
	drag: { initial: 1.0, terminal: 0.5, duration: 0.4 },
	bounce: 0.5,
};

// ---- Debris -----------------------------------------------------------------

export enum DebrisKind { Coloured = 0, Shiny = 1, Dark = 2, HighDetail = 3, Glass = 4 }
export const DEBRIS_KINDS = [DebrisKind.Coloured, DebrisKind.Shiny, DebrisKind.Dark, DebrisKind.HighDetail, DebrisKind.Glass];

export type DebrisPreset = {
	mesh: string;         // the PARTICLES.BUNDLE mesh collection the pieces are drawn with
	budget: number;       // live pieces at most
	diffuse: number;      // colour multiplier
	colour: Vec3 | 'paint';
	bounciness: Vec3;     // per world axis, on every bounce
	fadeIn: number;       // seconds a new piece takes to grow to full size
};
const BOUNCE: Vec3 = [0.7, 0.6, 0.7];
const bounce = (k: number): Vec3 => [BOUNCE[0] * k, BOUNCE[1] * k, BOUNCE[2] * k];
export const DEBRIS_PRESETS: Record<DebrisKind, DebrisPreset> = {
	[DebrisKind.Coloured]: { mesh: 'lowres_debris.rf3', budget: 400, diffuse: 1.0, colour: 'paint', bounciness: BOUNCE, fadeIn: 0.1 },
	[DebrisKind.Shiny]: { mesh: 'lowres_debris.rf3', budget: 300, diffuse: 0.7, colour: [1, 1, 1], bounciness: bounce(0.9), fadeIn: 0.1 },
	[DebrisKind.Dark]: { mesh: 'lowres_debris.rf3', budget: 400, diffuse: 0.5, colour: [0.5, 0.5, 0.5], bounciness: bounce(0.8), fadeIn: 0.1 },
	[DebrisKind.HighDetail]: { mesh: 'highres_debris_02.rf3', budget: 100, diffuse: 1.0, colour: [1, 1, 1], bounciness: bounce(0.5), fadeIn: 0.1 },
	[DebrisKind.Glass]: { mesh: 'Glass_debris.rf3', budget: 400, diffuse: 1.0, colour: [1, 1, 1], bounciness: bounce(0.8), fadeIn: 0.001 },
};
// A piece's size is the scale its mesh is drawn at; the meshes are 0.2 - 1.8 m
// across at scale 1 (glass 2 - 4 cm), so a 0.05 - 0.12 chip is 2 - 20 cm and a
// 0.3 - 0.5 body bit 6 - 70 cm. Without the meshes a stand-in chip is drawn
// with the collection's mean bounding radius (half the bounding-box diagonal,
// from its radius table): radius = size x this.
export const DEBRIS_MESH_RADIUS: Record<DebrisKind, number> = {
	[DebrisKind.Coloured]: 0.766, [DebrisKind.Shiny]: 0.766, [DebrisKind.Dark]: 0.766,
	[DebrisKind.HighDetail]: 0.422, [DebrisKind.Glass]: 0.0183,
};
export const DEBRIS_DRAG = 0.8;
export const DEBRIS_GRAVITY = -9.8;
// Lifetime by the piece's place in its batch & 3; a piece grows in over its
// preset's fade-in and its alpha fades over the last 0.8 s.
export const DEBRIS_LIFETIMES = [1.4, 1.8, 1.6, 2.0];
export const DEBRIS_FADE_OUT = 0.8;

// A crashing car's contacts throw a burst of debris at most every 0.18 s,
// scaled by the car's speed.
export const BURST_COOLDOWN = 0.18;
export const BURST_ORIGIN_LIFT = 0.2;
export const BURST_BOX: Vec3 = [0.5, 0.5, 0.25];
export const BURST_CONE = { halfAngle: 70, speed: [4, 9] as Range, inherit: [0.051, 0.2] as Range };
export const BURST: { kind: DebrisKind; count: number; size: Range }[] = [
	{ kind: DebrisKind.Coloured, count: 5, size: [0.05, 0.12] },
	{ kind: DebrisKind.Shiny, count: 2, size: [0.05, 0.07] },
	{ kind: DebrisKind.Dark, count: 55, size: [0.08, 0.12] },
	{ kind: DebrisKind.HighDetail, count: 6, size: [0.3, 0.5] },
];

// 0 below 5 m/s, 0.61 at 25 m/s, 1 at 60 m/s.
export function burstScale(speed: number): number {
	if (speed <= 5) return 0;
	if (speed <= 25) return ((speed - 5) / 20) * 0.61;
	return Math.min(0.61 + ((speed - 25) / 35) * 0.39, 1);
}

// While crashing the car sheds debris and smoke along its path: pieces per
// metre travelled, scaled 0 -> 1 as its speed goes 8 -> 50 m/s. Rivals shed
// less than the player.
export const TRAIL_SPEED: Range = [8, 50];
export type TrailRow = { kind: DebrisKind | 'smoke'; rate: number; size: Range };
export const PLAYER_TRAIL: TrailRow[] = [
	{ kind: DebrisKind.Coloured, rate: 2, size: [0.05, 0.12] },
	{ kind: DebrisKind.Shiny, rate: 2, size: [0.05, 0.07] },
	{ kind: DebrisKind.Dark, rate: 7, size: [0.05, 0.12] },
	{ kind: DebrisKind.HighDetail, rate: 0, size: [0.25, 0.4] },
	{ kind: DebrisKind.Glass, rate: 20, size: [1, 1] },
	{ kind: 'smoke', rate: 7, size: [0.6, 1.0] },
];
export const AI_TRAIL: TrailRow[] = PLAYER_TRAIL.map((r, i) => ({ ...r, rate: [1, 1, 3, 0, 10, 3][i] }));
export const TRAIL_SPREAD: Range = [2, 5];
export const TRAIL_INHERIT: Range = [0.1, 0.4];

// A smashed pane bursts into 320 glass pieces per square metre.
export const GLASS_PER_SQ_M = 320;

export const GLASS_SIZE: Range = [1, Math.sqrt(1.75)]; // squared after the draw
export const GLASS_SPEED_CAP = 40;
export const GLASS_OUTWARD = { min: [2, 0.01] as Range, max: [10, 0.15] as Range }; // base + per m/s of car speed
export const GLASS_INHERIT: Range = [0.4, 0.6];
export const GLASS_RADIAL: Range = [3, 8];

// ---- Dust and smoke ---------------------------------------------------------

// A crashing car scraping the world kicks up dust: 2.5 puffs per metre it
// travels while in contact above 5 m/s.
export const DUST_MIN_SPEED = 5;
export const DUST_PER_METRE = 2.5;
export const DUST_BOX: { min: Vec3; max: Vec3 } = { min: [-1, 0, -1], max: [1, 1, 1] };
export const DUST_VELOCITY: { min: Vec3; max: Vec3 } = { min: [-6, 1, -6], max: [6, 4, 6] };
export const DUST_INHERIT: Range = [0.05, 0.15];
export const DUST_SIZE: Range = [0.8, 1.2];

export type PuffModel = {
	life: number;
	lifeScale: number[];           // by puff index & 3
	size: [number, number, number]; // start, mid, end
	midTime: number;               // fraction of the life
	colour: [number, number, number, number][]; // RGBA start, mid, end
	rise: number;                  // added to y as rise * t² (no half)
	drag: { initial: number; terminal: number; duration: number };
	spin: number;                  // rad/s, either way
	budget: number;
};
const LIFE_SCALE = [1, 0.8, 0.9, 0.7];
export const DUST: PuffModel = {
	life: 2, lifeScale: LIFE_SCALE, size: [1.5, 3.5, 5], midTime: 0.2,
	colour: [[0.44, 0.44, 0.44, 0.017], [0.52, 0.5, 0.51, 0.3], [0.58, 0.6, 0.51, 0.011]],
	rise: 0.2, drag: { initial: 0.9, terminal: 0, duration: 1 }, spin: 0.6, budget: 300,
};
export const SMOKE: PuffModel = {
	life: 5, lifeScale: LIFE_SCALE, size: [4, 7, 15], midTime: 0.03,
	colour: [[0.61, 0.61, 0.61, 0], [0.92, 0.92, 0.92, 0.31], [0.22, 0.22, 0.22, 0]],
	rise: 0.2, drag: { initial: 0.9, terminal: 0, duration: 1 }, spin: 0.1, budget: 300,
};

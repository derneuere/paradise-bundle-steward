// IK part-type slots of a vehicle DeformationSpec (0x1001C) and the engine rules
// that decide what each slot does in a crash.
//
// partType is a stable slot id across every retail car. The names below come
// from measured part positions over the full retail VEHICLES set (scripts/
// parts-taxonomy.ts) plus the engine's own special cases. Car model space is
// +x = right, +y = up, +z = forward.
//
// How a panel leaves the car (all enforced by the engine, not by the data):
//   * A part whose tag points are all at/above the never-detach sentinel is a
//     dent-only part. So is any part with partGraphics == -1: it has no mesh to
//     hand to the detached-part pool.
//   * A detachable part with a jointed tag point first HINGES (swings on the
//     joint). It only flies off later, if the joint breaks: never when the
//     joint's detach threshold is <= -0.9, never for the bonnet (type 3, it
//     pops open and stays), and never for the last attached exhaust (84/85).
//   * A detachable part with no jointed tag points flies straight off.
//   * Toughened types (bumpers, wings, 108-115) ignore impacts below a minimum
//     impulse but give up at a lower ceiling.

export const PART_ROOT = 999;
export const PART_BODY_SHELL = 46;
export const PART_BONNET = 3;
export const EXHAUST_PARTS = new Set([84, 85]);

// Wheel-arch parts. Each one's left-most (FL/RL) or right-most (FR/RR) tag
// point anchors that wheel's suspension; the axle-pair types anchor both
// wheels of one axle. They are dent-only in every retail car.
export const WHEEL_ARCH = { FL: 48, FR: 49, RL: 50, RR: 51 } as const;
export const AXLE_PAIR_REAR = 130;
export const AXLE_PAIR_FRONT = 131;
export const WHEEL_PARTS = new Set<number>([48, 49, 50, 51, AXLE_PAIR_REAR, AXLE_PAIR_FRONT]);

// The 4 header WheelSpecs are stored FL, FR, RL, RR (all but a handful of
// retail cars put header wheel 0 at -x, +z).
export const HEADER_WHEEL_ARCHES = [WHEEL_ARCH.FL, WHEEL_ARCH.FR, WHEEL_ARCH.RL, WHEEL_ARCH.RR];

export const TOUGHENED_PARTS = new Set([1, 2, 26, 27, 28, 29, 108, 109, 110, 111, 112, 113, 114, 115]);

// The engine treats a tag point whose squared detach threshold is >= 9995 as
// "never detaches". Retail never-detach tags store 1e16 in both fields.
export const NEVER_DETACH_SQUARED = 9995;
export const NEVER_DETACH_VALUE = 1e16;
export const JOINT_NEVER_BREAKS = -0.9;

export { PART_NAMES, partName } from '../../../src/lib/core/deformationSim/partNames';

type PartLike = {
	partType: number;
	partGraphics: number;
	startIndexOfTagPoints: number;
	numberOfTagPoints: number;
	jointSpecs: { jointDetachThreshold: number }[];
};
type TagLike = { fDetachThresholdSquared: number; jointIndex: number };

export type CrashBehaviour = 'inert' | 'dent only' | 'flies off' | 'hinges, breaks off' | 'hinges, never breaks';

export function crashBehaviour(part: PartLike, tagPoints: TagLike[]): CrashBehaviour {
	if (part.partGraphics < 0) return 'inert';
	const tags = tagPoints.slice(part.startIndexOfTagPoints, part.startIndexOfTagPoints + part.numberOfTagPoints);
	if (!tags.some((t) => t.fDetachThresholdSquared < NEVER_DETACH_SQUARED)) return 'dent only';
	const jointed = tags.filter((t) => t.jointIndex !== -1);
	if (jointed.length === 0) return 'flies off';
	const breakable = part.partType !== PART_BONNET
		&& jointed.some((t) => (part.jointSpecs[t.jointIndex]?.jointDetachThreshold ?? -1) > JOINT_NEVER_BREAKS);
	return breakable ? 'hinges, breaks off' : 'hinges, never breaks';
}

export const canLeaveCar = (b: CrashBehaviour) => b === 'flies off' || b === 'hinges, breaks off';

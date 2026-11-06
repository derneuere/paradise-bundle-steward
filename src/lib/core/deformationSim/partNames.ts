// Display names for the DeformationSpec partType slots, measured from part
// positions across the retail cars (+x = the car's right, +z = forward).
export const PART_NAMES: Record<number, string> = {
	1: 'front bumper', 2: 'rear bumper', 3: 'bonnet', 4: 'boot', 5: 'boot spoiler', 6: 'front grille',
	8: 'door R', 10: 'door L', 9: 'mirror R', 11: 'mirror L', 12: 'rear door R', 13: 'rear door L',
	24: 'sill R', 25: 'sill L', 26: 'front wing R', 27: 'front wing L', 28: 'rear quarter L', 29: 'rear quarter R',
	40: 'headlight R', 41: 'headlight L', 42: 'tail light R', 43: 'tail light L', 46: 'body shell',
	48: 'wheel arch FL', 49: 'wheel arch FR', 50: 'wheel arch RL', 51: 'wheel arch RR', 70: 'front plate',
	84: 'exhaust A', 85: 'exhaust B', 130: 'rear axle pair', 131: 'front axle pair', 999: 'root',
};

export const partName = (type: number): string => PART_NAMES[type] ?? `part ${type}`;

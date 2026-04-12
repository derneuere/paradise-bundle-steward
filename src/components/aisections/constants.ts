import { SectionSpeed, AISectionFlag, EResetSpeedType } from '@/lib/core/aiSections';

export const SPEED_LABELS: Record<number, string> = {
	[SectionSpeed.E_SECTION_SPEED_VERY_SLOW]: 'Very Slow',
	[SectionSpeed.E_SECTION_SPEED_SLOW]: 'Slow',
	[SectionSpeed.E_SECTION_SPEED_NORMAL]: 'Normal',
	[SectionSpeed.E_SECTION_SPEED_FAST]: 'Fast',
	[SectionSpeed.E_SECTION_SPEED_VERY_FAST]: 'Very Fast',
};

export const FLAG_NAMES: { flag: number; label: string }[] = [
	{ flag: AISectionFlag.SHORTCUT, label: 'SC' },
	{ flag: AISectionFlag.NO_RESET, label: 'NR' },
	{ flag: AISectionFlag.IN_AIR, label: 'Air' },
	{ flag: AISectionFlag.SPLIT, label: 'Split' },
	{ flag: AISectionFlag.JUNCTION, label: 'Jct' },
	{ flag: AISectionFlag.TERMINATOR, label: 'Term' },
	{ flag: AISectionFlag.AI_SHORTCUT, label: 'AISC' },
	{ flag: AISectionFlag.AI_INTERSTATE_EXIT, label: 'Exit' },
];

export const RESET_SPEED_LABELS: Record<number, string> = {
	[EResetSpeedType.E_RESET_SPEED_TYPE_CUSTOM]: 'Custom',
	[EResetSpeedType.E_RESET_SPEED_TYPE_NONE]: 'None',
	[EResetSpeedType.E_RESET_SPEED_TYPE_SLOW]: 'Slow',
	[EResetSpeedType.E_RESET_SPEED_TYPE_FAST]: 'Fast',
	[EResetSpeedType.E_RESET_SPEED_TYPE_SLOW_NORTH_FACE]: 'Slow N',
	[EResetSpeedType.E_RESET_SPEED_TYPE_SLOW_SOUTH_FACE]: 'Slow S',
	[EResetSpeedType.E_RESET_SPEED_TYPE_SLOW_EAST_FACE]: 'Slow E',
	[EResetSpeedType.E_RESET_SPEED_TYPE_SLOW_WEST_FACE]: 'Slow W',
	[EResetSpeedType.E_RESET_SPEED_TYPE_SLOW_REVERSE]: 'Slow Rev',
	[EResetSpeedType.E_RESET_SPEED_TYPE_STOP_REVERSE]: 'Stop Rev',
	[EResetSpeedType.E_RESET_SPEED_TYPE_STOP_NORTH_FACE]: 'Stop N',
	[EResetSpeedType.E_RESET_SPEED_TYPE_STOP_SOUTH_FACE]: 'Stop S',
	[EResetSpeedType.E_RESET_SPEED_TYPE_STOP_EAST_FACE]: 'Stop E',
	[EResetSpeedType.E_RESET_SPEED_TYPE_STOP_WEST_FACE]: 'Stop W',
	[EResetSpeedType.E_RESET_SPEED_TYPE_STOP_NORTH_EAST_FACE]: 'Stop NE',
	[EResetSpeedType.E_RESET_SPEED_TYPE_STOP_SOUTH_WEST_FACE]: 'Stop SW',
	[EResetSpeedType.E_RESET_SPEED_TYPE_NONE_AND_IGNORE]: 'None+Ign',
	[EResetSpeedType.E_RESET_SPEED_TYPE_WEST_AND_IGNORE]: 'W+Ign',
	[EResetSpeedType.E_RESET_SPEED_TYPE_REVERSE_AND_IGNORE]: 'Rev+Ign',
	[EResetSpeedType.E_RESET_SPEED_TYPE_REVERSE_AND_IGNORE_SLOW]: 'RevSlow+Ign',
};

export const HEX = (v: number) => `0x${(v >>> 0).toString(16).toUpperCase()}`;

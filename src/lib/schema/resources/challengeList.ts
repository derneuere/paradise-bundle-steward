// Hand-written schema for ParsedChallengeList.
//
// Mirrors the types in `src/lib/core/challengeList.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs
// a matching entry here or the walker will report it as an unknown
// field.
//
// Migration notes:
// - ChallengeList is the single-record-per-bundle case (`0x1001F`), so
//   the root navigates into `challenges[i]` through the hierarchy tree.
// - The existing tab-based editor (General / Action 1 / Action 2 /
//   Advanced) is preserved via `propertyGroups` on ChallengeListEntry
//   with `component:` references into `challengeListExtensions`.
// - The overview statistics card on the list root is preserved via a
//   root-level `component` propertyGroup.
// - padding fields (`padding`, `padding1`..`padding4`) are hidden from
//   the inspector but still walked so the round-trip stays byte-exact.

import type {
	FieldSchema,
	PropertyGroup,
	RecordSchema,
	ResourceSchema,
	SchemaContext,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

// CgsID — 64-bit hash, displayed as hex.
const cgsId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });

// Fixed-size primitive tuple.
const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

// Fixed-size record list.
const fixedRecordList = (type: string, length: number): FieldSchema => ({
	kind: 'list',
	item: record(type),
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

// Variable-length record list with an optional item-label callback.
const recordList = (
	type: string,
	itemLabel?: (item: unknown, index: number, ctx: SchemaContext) => string,
	customRenderer?: string,
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: true,
	removable: true,
	itemLabel,
	customRenderer,
});

// ---------------------------------------------------------------------------
// Type-code → short label map (for tree labels + action-type discriminator)
// ---------------------------------------------------------------------------
//
// The prompt calls for a type-code → short-label map at the top of the
// schema file so the tree can label `challenges[i]` with its primary
// action type. These are the same labels the existing virtualized list
// uses in its row badges — shorter than the full enum names in
// `challengeOptionRegistry.actionType`.

const ACTION_TYPE_SHORT_LABELS: Record<number, string> = {
	0: 'Min Speed',
	1: 'In Air',
	2: 'Air Distance',
	3: 'Leap Cars',
	4: 'Drift',
	5: 'Near Miss',
	6: 'Barrel Rolls',
	7: 'Oncoming',
	8: 'Flat Spin',
	9: 'Land',
	10: 'Road Rule Time',
	11: 'Road Rule Crash',
	12: 'Power Parking (Player)',
	13: 'Power Parking (Traffic)',
	14: 'Crash Into Player',
	15: 'Burnouts',
	16: 'Meet Up',
	17: 'Billboard',
	18: 'Boost Time',
	19: 'Barrel Rolls (Rev)',
	20: 'Flat Spin (Rev)',
	21: 'Land (Rev)',
	22: 'Convoy',
	23: '?23',
	24: 'Air Chain Mult',
	25: 'Flat Spin Chain Mult',
	26: 'Barrel Roll Chain Mult',
	27: 'Super Jump Chain Mult',
	28: 'Billboard Chain Mult',
	29: '?29',
	30: 'Chained Mult',
	31: 'Air Mult',
	32: 'Flat Spin Mult',
	33: 'Barrel Roll Mult',
	34: 'Super Jump Mult',
	35: 'Billboard Mult',
	36: 'Cars Leapt Mult',
	37: 'Takedown Mult',
	38: 'Multiplier',
	39: 'Stunt Score',
	40: 'Corkscrew',
	41: 'Land Super Jumps',
	42: 'Land Specific Super Jump',
	43: 'Smash Specific Billboard',
	44: 'Interstate Lap',
	45: 'Interstate Lap (No Stop)',
	46: 'Interstate Lap (No Crash)',
	47: 'Aerial Near Miss',
	48: 'Rev Driving',
	49: 'Rev Oncoming',
	50: 'Takedowns',
	51: 'Vert Takedown',
	52: 'Target',
	53: 'Wheelie Distance',
	54: 'Wheelie Times',
	55: 'Wheelie Near Miss',
	56: 'Wheelie Oncoming',
	57: 'Oncoming Near Miss',
	58: '?58',
	59: '?59',
	60: 'Distance',
	61: '?61',
	62: 'Jump Over Bikes',
	63: 'Count',
};

function actionTypeShortLabel(code: number | undefined): string {
	if (code == null) return '?';
	return ACTION_TYPE_SHORT_LABELS[code] ?? `Type ${code}`;
}

// ---------------------------------------------------------------------------
// Enum and flag value tables
// ---------------------------------------------------------------------------

// Full action-type list — used as the enum discriminator on
// `ChallengeListEntryAction.actionType`. Unknown values fall through to
// the default enum renderer; the short-label table above keeps tree
// labels readable without requiring every code to be in the enum table.
const ACTION_TYPE_VALUES = Object.entries(ACTION_TYPE_SHORT_LABELS).map(
	([value, label]) => ({ value: Number(value), label }),
);

const COOP_TYPE_VALUES = [
	{ value: 0, label: 'Once' },
	{ value: 1, label: 'Individual' },
	{ value: 2, label: 'Individual Accumulation' },
	{ value: 3, label: 'Simultaneous' },
	{ value: 4, label: 'Cumulative' },
	{ value: 5, label: 'Average' },
	{ value: 6, label: 'Individual Sequence' },
	{ value: 7, label: 'Count' },
];

// Modifier is a bitmask (KX_MODIFIER_*), not a discrete enum.
const MODIFIER_BITS = [
	{ mask: 0x01, label: 'Without Crashing' },
	{ mask: 0x02, label: 'Pristine' },
	{ mask: 0x04, label: 'Head On' },
	{ mask: 0x08, label: 'In Air' },
	{ mask: 0x10, label: 'Bank For Success' },
	{ mask: 0x20, label: 'Stands By Before Part 2' },
	{ mask: 0x40, label: 'Timer Starts On Activation' },
];

const COMBINE_ACTION_VALUES = [
	{ value: 0, label: 'Chain' },
	{ value: 1, label: 'Failure Resets Chain' },
	{ value: 2, label: 'Failure Resets Everyone' },
	{ value: 3, label: '? 3 (unused)' },
	{ value: 4, label: 'Simultaneous' },
	{ value: 5, label: 'Independent' },
	{ value: 6, label: '? 6 (sequential)' },
	{ value: 7, label: 'Count' },
];

const LOCATION_TYPE_VALUES = [
	{ value: 0, label: 'Anywhere' },
	{ value: 1, label: 'District' },
	{ value: 2, label: 'County' },
	{ value: 3, label: 'Trigger' },
	{ value: 4, label: 'Road' },
	{ value: 5, label: 'Road (No Marker)' },
	{ value: 6, label: 'Gas Station' },
	{ value: 7, label: 'Auto Repair' },
	{ value: 8, label: 'Paint Shop' },
];

const CHALLENGE_DATA_TYPE_VALUES = [
	{ value: 0, label: 'Crashes' },
	{ value: 1, label: 'Near Miss' },
	{ value: 2, label: 'Oncoming' },
	{ value: 3, label: 'Drift' },
	{ value: 4, label: 'Air' },
	{ value: 5, label: 'Air Distance' },
	{ value: 6, label: 'Barrel Rolls' },
	{ value: 7, label: 'Flat Spins' },
	{ value: 8, label: 'Cars Leapt' },
	{ value: 9, label: 'Speed Road Rule' },
	{ value: 10, label: 'Crash Road Rule' },
	{ value: 11, label: 'Successful Landings' },
	{ value: 12, label: 'Burnouts' },
	{ value: 13, label: 'Power Parks' },
	{ value: 14, label: 'Percentage' },
	{ value: 15, label: 'Meet Up' },
	{ value: 16, label: 'Billboards' },
	{ value: 17, label: 'Boost Time' },
	{ value: 18, label: 'Convoy Position' },
	{ value: 19, label: 'Distance' },
	{ value: 20, label: 'Chain' },
	{ value: 21, label: 'Multiplier' },
	{ value: 22, label: 'Stunt Score' },
	{ value: 23, label: 'Corkscrew' },
	{ value: 24, label: 'Super Jump' },
	{ value: 25, label: 'Interstate Lap' },
	{ value: 26, label: 'Takedowns' },
	{ value: 27, label: 'Vert Takedown' },
	{ value: 28, label: 'Aerial Near Miss' },
	{ value: 29, label: 'Rev Driving' },
	{ value: 30, label: 'Rev Oncoming' },
	{ value: 31, label: 'Target' },
	{ value: 32, label: 'Bikes Leapt' },
	{ value: 33, label: 'Wheelie' },
	{ value: 34, label: 'Wheelie Near Miss' },
	{ value: 35, label: 'Wheelie Oncoming' },
	{ value: 36, label: 'Oncoming Near Miss' },
	{ value: 37, label: 'Distance Traveled' },
	{ value: 38, label: 'Count (placeholder)' },
];

const DIFFICULTY_VALUES = [
	{ value: 0, label: 'Easy' },
	{ value: 1, label: 'Medium' },
	{ value: 2, label: 'Hard' },
	{ value: 3, label: 'Very Hard' },
];

const ENTITLEMENT_VALUES = [
	{ value: 0, label: 'Release' },
	{ value: 1, label: 'Unknown DLC' },
	{ value: 2, label: 'Unknown DLC 2' },
	{ value: 3, label: 'Cagney' },
	{ value: 4, label: 'Davis' },
	{ value: 5, label: 'Island' },
];

const CAR_RESTRICTION_VALUES = [
	{ value: 0, label: 'None' },
	{ value: 1, label: 'Danger' },
	{ value: 2, label: 'Aggression' },
	{ value: 3, label: 'Stunt' },
];

// `numPlayers` is stored as a u8 but uses hex-encoded digits:
// 0x22 = 2 players, 0x33 = 3 players, etc. Render as an enum.
const NUM_PLAYERS_VALUES = [
	{ value: 0x22, label: '2 Players (0x22)' },
	{ value: 0x33, label: '3 Players (0x33)' },
	{ value: 0x44, label: '4 Players (0x44)' },
	{ value: 0x55, label: '5 Players (0x55)' },
	{ value: 0x66, label: '6 Players (0x66)' },
	{ value: 0x77, label: '7 Players (0x77)' },
	{ value: 0x88, label: '8 Players (0x88)' },
];

// ---------------------------------------------------------------------------
// Tree label helpers
// ---------------------------------------------------------------------------

function trimNulls(s: string | undefined | null): string {
	if (!s) return '';
	return s.replace(/\0+$/, '').trim();
}

function challengeLabel(c: unknown, index: number): string {
	try {
		if (!c || typeof c !== 'object') return `#${index}`;
		const ch = c as {
			actions?: { actionType?: number }[];
			titleStringID?: string;
			challengeID?: bigint;
		};
		const primary = ch.actions?.[0];
		const typeLabel = actionTypeShortLabel(primary?.actionType);
		const title = trimNulls(ch.titleStringID);
		const id = ch.challengeID;
		const name = title.length > 0
			? title
			: id != null ? `0x${id.toString(16).toUpperCase()}` : '?';
		return `#${index} · ${typeLabel} · ${name}`;
	} catch {
		return `#${index}`;
	}
}

function actionLabel(a: unknown, index: number): string {
	try {
		if (!a || typeof a !== 'object') return `Action ${index + 1}`;
		const act = a as { actionType?: number };
		return `Action ${index + 1} · ${actionTypeShortLabel(act.actionType)}`;
	} catch {
		return `Action ${index + 1}`;
	}
}

function locationDataLabel(l: unknown, index: number): string {
	try {
		if (!l || typeof l !== 'object') return `Location ${index + 1}`;
		const loc = l as { district?: number; county?: number; triggerID?: bigint };
		const d = loc.district ?? 0;
		const c = loc.county ?? 0;
		const t = loc.triggerID != null && loc.triggerID !== 0n
			? `T:0x${loc.triggerID.toString(16).toUpperCase()}`
			: '';
		return `Location ${index + 1} · D${d}/C${c}${t ? ' · ' + t : ''}`;
	} catch {
		return `Location ${index + 1}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const LocationData: RecordSchema = {
	name: 'LocationData',
	description: 'Challenge location — district/county + optional trigger and road IDs.',
	fields: {
		district: u8(),
		county: u8(),
		triggerID: cgsId(),
		roadID: cgsId(),
	},
	fieldMetadata: {
		district: { description: 'EDistrict — Paradise City district code. Packed into the low 8 bits of the first u32.' },
		county: { description: 'ECounty — Paradise City county code. Packed into bits 8-15 of the first u32.' },
		triggerID: { description: 'CgsID of the linked trigger, if any.' },
		roadID: {
			description: 'CgsID of the linked road, if any. The current parser packs district/county/triggerID into 8 bytes and leaves roadID at 0 — the writer mirrors this, so the field is always zero on round-trip.',
			readOnly: true,
		},
	},
	label: (value, index) => locationDataLabel(value, index ?? 0),
};

const ChallengeListEntryAction: RecordSchema = {
	name: 'ChallengeListEntryAction',
	description: 'One of two goal parts that make up a challenge.',
	fields: {
		actionType: { kind: 'enum', storage: 'u8', values: ACTION_TYPE_VALUES },
		coopType: { kind: 'enum', storage: 'u8', values: COOP_TYPE_VALUES },
		modifier: { kind: 'flags', storage: 'u8', bits: MODIFIER_BITS },
		combineActionType: { kind: 'enum', storage: 'u8', values: COMBINE_ACTION_VALUES },
		numLocations: u8(),
		locationType: fixedList(
			{ kind: 'enum', storage: 'u8', values: LOCATION_TYPE_VALUES },
			4,
		),
		padding1: fixedList(u8(), 7),
		locationData: fixedRecordList('LocationData', 4),
		numTargets: u8(),
		padding2: fixedList(u8(), 3),
		// Stored as u32 in the parser but interpreted as int32_t per spec.
		// Signed display is preferable, so use i32; the writer masks to 32
		// bits, making signed/unsigned equivalent on round-trip.
		targetValue: fixedList({ kind: 'i32' }, 2),
		targetDataType: fixedList(
			{ kind: 'enum', storage: 'u8', values: CHALLENGE_DATA_TYPE_VALUES },
			2,
		),
		padding3: fixedList(u8(), 2),
		timeLimit: f32(),
		convoyTime: f32(),
		propType: u32(),
		padding4: fixedList(u8(), 4),
	},
	fieldMetadata: {
		actionType: { label: 'Action Type', description: 'Goal type — see EChallengeActionType.' },
		coopType: { label: 'Co-op Type' },
		modifier: { label: 'Modifier', description: 'KX_MODIFIER_* bitmask.' },
		combineActionType: { label: 'Combine Action Type' },
		numLocations: { label: 'Number of Locations', description: 'How many of the 4 location slots are used (0-4).' },
		locationType: { label: 'Location Types', description: 'Per-slot location type; unused slots should be 0.' },
		padding1: { hidden: true },
		locationData: { label: 'Locations', description: 'Per-slot location data; unused slots should be zero.' },
		numTargets: { label: 'Number of Targets', description: '0-2 depending on the action type.' },
		padding2: { hidden: true },
		targetValue: { label: 'Target Values', description: 'Goal values — first entry is the primary goal, second is action-specific.' },
		targetDataType: { label: 'Target Data Types' },
		padding3: { hidden: true },
		timeLimit: { label: 'Time Limit (s)', description: 'Any non-zero value makes the challenge timed.' },
		convoyTime: { label: 'Convoy Time (s)', description: 'Counts down; resets challenge on zero. Unused in retail.' },
		propType: { label: 'Prop Type' },
		padding4: { hidden: true },
	},
	propertyGroups: [
		{
			title: 'Goal',
			properties: ['actionType', 'coopType', 'modifier', 'combineActionType'],
		},
		{
			title: 'Locations',
			properties: ['numLocations', 'locationType', 'locationData'],
		},
		{
			title: 'Targets',
			properties: ['numTargets', 'targetValue', 'targetDataType'],
		},
		{
			title: 'Timing',
			properties: ['timeLimit', 'convoyTime', 'propType'],
		},
	],
	label: (value, index) => actionLabel(value, index ?? 0),
};

const ChallengeListEntry: RecordSchema = {
	name: 'ChallengeListEntry',
	description: 'One online challenge — title/description IDs, difficulty, player count, and two goal actions.',
	fields: {
		actions: fixedRecordList('ChallengeListEntryAction', 2),
		descriptionStringID: { kind: 'string' },
		titleStringID: { kind: 'string' },
		challengeID: cgsId(),
		carID: cgsId(),
		carType: { kind: 'enum', storage: 'u8', values: CAR_RESTRICTION_VALUES },
		carColourIndex: u8(),
		carColourPaletteIndex: u8(),
		numPlayers: { kind: 'enum', storage: 'u8', values: NUM_PLAYERS_VALUES },
		numActions: u8(),
		difficulty: { kind: 'enum', storage: 'u8', values: DIFFICULTY_VALUES },
		entitlementGroup: { kind: 'enum', storage: 'u8', values: ENTITLEMENT_VALUES },
		padding: u8(),
	},
	fieldMetadata: {
		actions: { label: 'Actions', description: 'Fixed pair — action 2 is only active when numActions ≥ 2.' },
		descriptionStringID: { label: 'Description String ID', description: 'FBCD_<GameDB ID> — localized description key.' },
		titleStringID: { label: 'Title String ID', description: 'FBCT_<GameDB ID> — localized title key.' },
		challengeID: { label: 'Challenge ID (CgsID)' },
		carID: { label: 'Car ID (CgsID)', description: 'Unused — car restriction by exact car ID.' },
		carType: { label: 'Car Type', description: 'Unused — see ECarRestrictionType.' },
		carColourIndex: { label: 'Car Colour Index', description: 'Unused.' },
		carColourPaletteIndex: { label: 'Car Colour Palette Index', description: 'Unused.' },
		numPlayers: { label: 'Number of Players', description: 'Hex-encoded: 0x22 = 2 players, 0x33 = 3, etc.' },
		numActions: { label: 'Number of Actions', description: '1 or 2 — the second action is only active when set to 2.' },
		difficulty: { label: 'Difficulty' },
		entitlementGroup: { label: 'Entitlement Group' },
		padding: { hidden: true },
	},
	propertyGroups: [
		{
			title: 'General',
			properties: [
				'titleStringID',
				'descriptionStringID',
				'challengeID',
				'difficulty',
				'numPlayers',
				'numActions',
				'entitlementGroup',
				'carType',
			],
		},
		{
			title: 'Action 1',
			component: 'ChallengeAction1Tab',
		},
		{
			title: 'Action 2',
			component: 'ChallengeAction2Tab',
		},
		{
			title: 'Advanced',
			properties: ['carID', 'carColourIndex', 'carColourPaletteIndex'],
		},
	],
	label: (value, index) => challengeLabel(value, index ?? 0),
};

const CHALLENGE_LIST_GROUPS: PropertyGroup[] = [
	{
		title: 'Overview',
		component: 'ChallengeOverviewTab',
	},
	{
		title: 'Header',
		properties: ['numChallenges', 'bytePad'],
	},
];

const ChallengeList: RecordSchema = {
	name: 'ChallengeList',
	description: 'Root record for the Challenge List resource (0x1001F).',
	fields: {
		numChallenges: u32(),
		challenges: recordList('ChallengeListEntry', (c, i) => challengeLabel(c, i)),
		bytePad: { kind: 'bigint', bytes: 8 },
	},
	fieldMetadata: {
		numChallenges: {
			label: 'Challenge Count',
			description: 'Must equal challenges.length — the writer rejects mismatches.',
			readOnly: true,
		},
		challenges: { label: 'Challenges' },
		bytePad: { label: 'Byte Pad', description: 'Opaque 8-byte header padding field.' },
	},
	propertyGroups: CHALLENGE_LIST_GROUPS,
};

// ---------------------------------------------------------------------------
// Registry + resource
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	ChallengeList,
	ChallengeListEntry,
	ChallengeListEntryAction,
	LocationData,
};

export const challengeListResourceSchema: ResourceSchema = {
	key: 'challengeList',
	name: 'Challenge List',
	rootType: 'ChallengeList',
	registry,
};

// Exports used by tests and extensions.
export {
	ACTION_TYPE_SHORT_LABELS,
	actionTypeShortLabel,
	challengeLabel,
	actionLabel,
	locationDataLabel,
};

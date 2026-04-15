// Hand-written schema for ParsedVehicleList (resource type 0x10005).
//
// Mirrors the types in `src/lib/core/vehicleList.ts`. Covers every parsed
// field in the model so the schema editor can walk, edit, and round-trip
// without loss.
//
// The `vehicles` list gets tree-driven navigation (per-vehicle record nodes
// show up in the hierarchy). Clicking a vehicle opens the custom form
// extension `VehicleEditorTab` in the inspector — preserving the existing
// tab-based editor UI without rewriting it schema-first. The default record
// form is still available via the `Fields` tab.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaContext,
	SchemaRegistry,
} from '../types';

import {
	VehicleType,
	CarType,
	LiveryType,
	Rank,
	AIEngineStream,
	getDecryptedId,
} from '@/lib/core/vehicleList';

// ---------------------------------------------------------------------------
// Local field helpers
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const string = (): FieldSchema => ({ kind: 'string' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

// CgsID — 64-bit hash, displayed as hex.
const cgsId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });

const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

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
// Enum + flag tables
// ---------------------------------------------------------------------------

const VEHICLE_TYPE_VALUES = [
	{ value: VehicleType.CAR, label: 'Car' },
	{ value: VehicleType.BIKE, label: 'Bike' },
	{ value: VehicleType.PLANE, label: 'Plane' },
];

const CAR_TYPE_VALUES = [
	{ value: CarType.SPEED, label: 'Speed' },
	{ value: CarType.AGGRESSION, label: 'Aggression' },
	{ value: CarType.STUNT, label: 'Stunt' },
	{ value: CarType.NONE, label: 'None' },
	{ value: CarType.LOCKED, label: 'Locked' },
	{ value: CarType.INVALID, label: 'Invalid' },
];

const LIVERY_TYPE_VALUES = [
	{ value: LiveryType.DEFAULT, label: 'Default' },
	{ value: LiveryType.COLOUR, label: 'Colour' },
	{ value: LiveryType.PATTERN, label: 'Pattern' },
	{ value: LiveryType.SILVER, label: 'Silver' },
	{ value: LiveryType.GOLD, label: 'Gold' },
	{ value: LiveryType.COMMUNITY, label: 'Community' },
];

const RANK_VALUES = [
	{ value: Rank.LEARNERS_PERMIT, label: "Learner's Permit" },
	{ value: Rank.D_CLASS, label: 'D Class' },
	{ value: Rank.C_CLASS, label: 'C Class' },
	{ value: Rank.B_CLASS, label: 'B Class' },
	{ value: Rank.A_CLASS, label: 'A Class' },
	{ value: Rank.BURNOUT_LICENSE, label: 'Burnout License' },
];

const AI_ENGINE_STREAM_VALUES = [
	{ value: AIEngineStream.NONE, label: 'None' },
	{ value: AIEngineStream.AIROD_EX, label: 'AIROD_EX' },
	{ value: AIEngineStream.AI_CIVIC_EX, label: 'AI_CIVIC_EX' },
	{ value: AIEngineStream.AI_GT_ENG, label: 'AI_GT_ENG' },
	{ value: AIEngineStream.AI_MUST_EX, label: 'AI_MUST_EX' },
	{ value: AIEngineStream.AI_F1_EX, label: 'AI_F1_EX' },
	{ value: AIEngineStream.AI_BIKE_EX, label: 'AI_BIKE_EX' },
];

// Vehicle flags — pulled from the existing VehicleEditor constants.
const VEHICLE_FLAG_BITS = [
	{ mask: 0x1, label: 'Is Race Vehicle' },
	{ mask: 0x2, label: 'Can Check Traffic' },
	{ mask: 0x4, label: 'Can Be Checked' },
	{ mask: 0x8, label: 'Is Trailer' },
	{ mask: 0x10, label: 'Can Tow Trailer' },
	{ mask: 0x20, label: 'Can Be Painted' },
	{ mask: 0x40, label: 'Unknown 0' },
	{ mask: 0x80, label: 'Is First In Speed Range' },
	{ mask: 0x100, label: 'Has Switchable Boost' },
	{ mask: 0x200, label: 'Unknown 1' },
	{ mask: 0x400, label: 'Unknown 2' },
	{ mask: 0x800, label: 'Is WIP' },
	{ mask: 0x1000, label: 'Is From v1.0' },
	{ mask: 0x2000, label: 'Is From v1.3' },
	{ mask: 0x4000, label: 'Is From v1.4' },
	{ mask: 0x8000, label: 'Is From v1.5' },
	{ mask: 0x10000, label: 'Is From v1.6' },
	{ mask: 0x20000, label: 'Is From v1.7' },
	{ mask: 0x40000, label: 'Is From v1.8' },
	{ mask: 0x80000, label: 'Is From v1.9' },
];

// Junkyard category is a u32 bitmask — each bit tags a category bucket.
const CATEGORY_FLAG_BITS = [
	{ mask: 0x1, label: 'Paradise Cars' },
	{ mask: 0x2, label: 'Paradise Bikes' },
	{ mask: 0x4, label: 'Online Cars' },
	{ mask: 0x8, label: 'Toy Vehicles' },
	{ mask: 0x10, label: 'Legendary Cars' },
	{ mask: 0x20, label: 'Boost Special Cars' },
	{ mask: 0x40, label: 'Cop Cars' },
	{ mask: 0x80, label: 'Big Surf Island Cars' },
];

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function vehicleLabel(v: unknown, index: number): string {
	if (!v || typeof v !== 'object') return `#${index}`;
	const entry = v as {
		id?: bigint;
		vehicleName?: string;
		vehicleType?: number;
		boostType?: number;
	};
	// If neither id nor vehicleType is populated, this isn't a real entry —
	// return the bare index rather than "#N · ? · ?". Happens in defensive
	// rendering on partially-constructed data.
	if (entry.id == null && entry.vehicleType == null) return `#${index}`;
	try {
		const decrypted = entry.id != null ? getDecryptedId(entry.id) : '';
		const idLabel = decrypted || (entry.id != null ? `0x${entry.id.toString(16).toUpperCase()}` : '?');
		const classLabel = entry.vehicleType != null
			? (VEHICLE_TYPE_VALUES[entry.vehicleType]?.label ?? '?')
			: '?';
		const boostLabel = entry.boostType != null
			? (CAR_TYPE_VALUES[entry.boostType]?.label ?? '?')
			: '';
		const suffix = boostLabel ? ` ${boostLabel}` : '';
		return `#${index} · ${idLabel} · ${classLabel}${suffix}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const VehicleListHeader: RecordSchema = {
	name: 'VehicleListHeader',
	description: 'Vehicle list file header (16 bytes).',
	fields: {
		numVehicles: u32(),
		startOffset: u32(),
		unknown1: u32(),
		unknown2: u32(),
	},
	fieldMetadata: {
		numVehicles: {
			label: 'Num vehicles',
			readOnly: true,
			derivedFrom: 'vehicles',
			description: 'Derived from vehicles.length at write time.',
		},
		startOffset: {
			label: 'Start offset',
			readOnly: true,
			description: 'Always 16 — the byte offset where the entry list begins.',
		},
		unknown1: { label: 'Unknown 1', description: 'Preserved from the fixture.' },
		unknown2: { label: 'Unknown 2', description: 'Preserved from the fixture.' },
	},
};

const VehicleListEntryGamePlayData: RecordSchema = {
	name: 'VehicleListEntryGamePlayData',
	description: 'Gameplay-affecting vehicle parameters.',
	fields: {
		damageLimit: f32(),
		flags: { kind: 'flags', storage: 'u32', bits: VEHICLE_FLAG_BITS },
		boostBarLength: u8(),
		unlockRank: { kind: 'enum', storage: 'u8', values: RANK_VALUES },
		boostCapacity: u8(),
		strengthStat: u8(),
	},
	fieldMetadata: {
		damageLimit: {
			label: 'Damage limit',
			description: 'Always 1 in retail data.',
		},
		flags: { label: 'Vehicle flags' },
		boostBarLength: { label: 'Boost bar length' },
		unlockRank: { label: 'Unlock rank' },
		boostCapacity: {
			label: 'Boost capacity',
			description: '0 means default (≈5).',
		},
		strengthStat: {
			label: 'Strength stat',
			description: 'Junkyard strength — used as crashes-to-lose for Marked Man / Road Rage.',
		},
	},
};

const VehicleListEntryAudioData: RecordSchema = {
	name: 'VehicleListEntryAudioData',
	description: 'Audio / voice-over / music configuration for a vehicle.',
	fields: {
		exhaustName: cgsId(),
		exhaustEntityKey: cgsId(),
		engineEntityKey: cgsId(),
		engineName: cgsId(),
		rivalUnlockName: string(),
		wonCarVoiceOverKey: cgsId(),
		rivalReleasedVoiceOverKey: cgsId(),
		aiMusicLoopContentSpec: string(),
		aiExhaustIndex: { kind: 'enum', storage: 'u8', values: AI_ENGINE_STREAM_VALUES },
		aiExhaustIndex2ndPick: { kind: 'enum', storage: 'u8', values: AI_ENGINE_STREAM_VALUES },
		aiExhaustIndex3rdPick: { kind: 'enum', storage: 'u8', values: AI_ENGINE_STREAM_VALUES },
	},
	fieldMetadata: {
		exhaustName: {
			label: 'Exhaust name',
			description: 'Encrypted CgsID — decodes to e.g. DRAG_EX.',
		},
		exhaustEntityKey: {
			label: 'Exhaust entity key',
			description: 'GameDB AttribSysCollectionKey for the exhaust vehicle-engine collection.',
		},
		engineEntityKey: {
			label: 'Engine entity key',
			description: 'GameDB AttribSysCollectionKey for the engine vehicle-engine collection.',
		},
		engineName: {
			label: 'Engine name',
			description: 'Encrypted CgsID — decodes to e.g. DRAG_ENG.',
		},
		rivalUnlockName: {
			label: 'Rival unlock stream',
			description: 'Named from a short lookup table; arbitrary hex also accepted.',
		},
		wonCarVoiceOverKey: { label: 'Won car VO key' },
		rivalReleasedVoiceOverKey: { label: 'Rival released VO key' },
		aiMusicLoopContentSpec: {
			label: 'AI music stream',
			description: 'Named from a short lookup table; arbitrary hex also accepted.',
		},
		aiExhaustIndex: { label: 'AI exhaust (1st)' },
		aiExhaustIndex2ndPick: { label: 'AI exhaust (2nd)' },
		aiExhaustIndex3rdPick: { label: 'AI exhaust (3rd)' },
	},
};

const VehicleListEntry: RecordSchema = {
	name: 'VehicleListEntry',
	description: 'A single vehicle — roughly 40 fields of identity, gameplay, audio, and cosmetics.',
	fields: {
		id: cgsId(),
		parentId: cgsId(),
		vehicleName: string(),
		manufacturer: string(),
		wheelName: string(),
		gamePlayData: record('VehicleListEntryGamePlayData'),
		attribCollectionKey: cgsId(),
		audioData: record('VehicleListEntryAudioData'),
		unknownData: fixedList(u8(), 16),
		category: { kind: 'flags', storage: 'u32', bits: CATEGORY_FLAG_BITS },
		vehicleType: { kind: 'enum', storage: 'u8', values: VEHICLE_TYPE_VALUES },
		boostType: { kind: 'enum', storage: 'u8', values: CAR_TYPE_VALUES },
		liveryType: { kind: 'enum', storage: 'u8', values: LIVERY_TYPE_VALUES },
		topSpeedNormal: u8(),
		topSpeedBoost: u8(),
		topSpeedNormalGUIStat: u8(),
		topSpeedBoostGUIStat: u8(),
		colorIndex: u8(),
		paletteIndex: u8(),
	},
	fieldMetadata: {
		id: { label: 'Vehicle ID', description: 'Encrypted CgsID — decodes to e.g. XASBSCB1.' },
		parentId: { label: 'Parent ID', description: 'Encrypted CgsID — decodes to e.g. PASBSC01.' },
		vehicleName: { label: 'Vehicle name' },
		manufacturer: { label: 'Manufacturer' },
		wheelName: { label: 'Default wheel name' },
		gamePlayData: { label: 'Gameplay' },
		attribCollectionKey: {
			label: 'Attrib collection key',
			description: 'burnoutcarasset GameDB key — lookup8 encoded in the vehicle AttribSys.',
		},
		audioData: { label: 'Audio' },
		unknownData: {
			label: 'Unknown (16 bytes)',
			description: 'Plane-related? Always null in retail data. Preserved for round-trip.',
			hidden: true,
		},
		category: { label: 'Junkyard category' },
		vehicleType: { label: 'Vehicle type' },
		boostType: { label: 'Boost type' },
		liveryType: { label: 'Livery type' },
		topSpeedNormal: { label: 'Top speed (normal)' },
		topSpeedBoost: { label: 'Top speed (boost)' },
		topSpeedNormalGUIStat: { label: 'Speed GUI stat', description: '1–10 junkyard stat.' },
		topSpeedBoostGUIStat: { label: 'Boost GUI stat', description: '1–10 junkyard stat.' },
		colorIndex: { label: 'Default color index' },
		paletteIndex: { label: 'Default palette index' },
	},
	propertyGroups: [
		{ title: 'Editor', component: 'VehicleEditorTab' },
		{
			title: 'Identity',
			properties: ['id', 'parentId', 'vehicleName', 'manufacturer', 'wheelName'],
		},
		{
			title: 'Classification',
			properties: ['vehicleType', 'boostType', 'liveryType', 'category'],
		},
		{
			title: 'Gameplay',
			properties: ['gamePlayData'],
		},
		{
			title: 'Performance',
			properties: [
				'topSpeedNormal',
				'topSpeedBoost',
				'topSpeedNormalGUIStat',
				'topSpeedBoostGUIStat',
				'colorIndex',
				'paletteIndex',
			],
		},
		{
			title: 'Audio',
			properties: ['audioData'],
		},
		{
			title: 'Technical',
			properties: ['attribCollectionKey'],
		},
	],
	label: (value, index) => vehicleLabel(value, index ?? 0),
};

const VehicleList: RecordSchema = {
	name: 'VehicleList',
	description: 'Root record for the Vehicle List resource (0x10005).',
	fields: {
		header: record('VehicleListHeader'),
		vehicles: recordList('VehicleListEntry', vehicleLabel),
	},
	fieldMetadata: {
		header: { label: 'Header' },
		vehicles: { label: 'Vehicles' },
	},
	propertyGroups: [
		{ title: 'Vehicles', properties: ['vehicles'] },
		{ title: 'Header', properties: ['header'] },
	],
};

// ---------------------------------------------------------------------------
// Registry + resource
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	VehicleList,
	VehicleListHeader,
	VehicleListEntry,
	VehicleListEntryGamePlayData,
	VehicleListEntryAudioData,
};

export const vehicleListResourceSchema: ResourceSchema = {
	key: 'vehicleList',
	name: 'Vehicle List',
	rootType: 'VehicleList',
	registry,
};

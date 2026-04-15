// Hand-written schema for ParsedTriggerData (resource 0x10003).
//
// Mirrors the types in `src/lib/core/triggerData.ts`. All 11 record types
// that appear in the parsed model are declared in the registry so
// `walkResource` visits every parsed field. Count fields that the parser
// does NOT store on the model (miLandmarkCount, miRegionCount, etc.) are
// derived by the writer from array lengths and never appear as schema
// fields either — the registry stays in lockstep with the parsed shape.
//
// The root `size` field IS on the parsed model but the writer overwrites
// it with the actual total byte length on every call, so it's marked
// `hidden: true, readOnly: true`.
//
// TriggerRegion (base class) is not a record type here — the parser
// spreads its five fields (box, id, regionIndex, type, enabled) directly
// into each subclass (Landmark / GenericRegion / Blackspot / VFXBoxRegion),
// so the schema inlines those five fields into every subclass record.

import type {
	FieldSchema,
	PropertyGroup,
	RecordSchema,
	ResourceSchema,
	SchemaContext,
	SchemaRegistry,
	ValidationResult,
} from '../types';

// ---------------------------------------------------------------------------
// Local field helpers — short-hand constructors matching trafficData.ts.
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const i8 = (): FieldSchema => ({ kind: 'i8' });
const i16 = (): FieldSchema => ({ kind: 'i16' });
const i32 = (): FieldSchema => ({ kind: 'i32' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const vec4 = (): FieldSchema => ({ kind: 'vec4' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

// 64-bit hash displayed as hex (CgsID).
const cgsId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });
// 64-bit integer displayed as decimal — used for the opaque miCamera field.
const int64 = (): FieldSchema => ({ kind: 'bigint', bytes: 8 });

const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

const primList = (item: FieldSchema): FieldSchema => ({
	kind: 'list',
	item,
	addable: true,
	removable: true,
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
// Enum tables — translate the C# enum names into user-friendly labels.
// The values match the parser's enums in `src/lib/core/triggerData.ts`.
// ---------------------------------------------------------------------------

const TRIGGER_REGION_TYPE_VALUES = [
	{ value: 0, label: 'Landmark', description: 'E_TYPE_LANDMARK' },
	{ value: 1, label: 'Blackspot', description: 'E_TYPE_BLACKSPOT' },
	{ value: 2, label: 'Generic Region', description: 'E_TYPE_GENERIC_REGION' },
	{ value: 3, label: 'VFX Box Region', description: 'E_TYPE_VFXBOX_REGION' },
];

const STUNT_CAMERA_TYPE_VALUES = [
	{ value: 0, label: 'No Cuts', description: 'E_STUNT_CAMERA_TYPE_NO_CUTS' },
	{ value: 1, label: 'Custom', description: 'E_STUNT_CAMERA_TYPE_CUSTOM' },
	{ value: 2, label: 'Normal', description: 'E_STUNT_CAMERA_TYPE_NORMAL' },
];

const GENERIC_REGION_TYPE_VALUES = [
	{ value: 0, label: 'Junk Yard', description: 'E_TYPE_JUNK_YARD' },
	{ value: 1, label: 'Bike Shop' },
	{ value: 2, label: 'Gas Station', description: 'E_TYPE_GAS_STATION' },
	{ value: 3, label: 'Body Shop', description: 'E_TYPE_BODY_SHOP' },
	{ value: 4, label: 'Paint Shop', description: 'E_TYPE_PAINT_SHOP' },
	{ value: 5, label: 'Car Park', description: 'E_TYPE_CAR_PARK' },
	{ value: 6, label: 'Signature Takedown', description: 'E_TYPE_SIGNATURE_TAKEDOWN' },
	{ value: 7, label: 'Killzone', description: 'E_TYPE_KILLZONE' },
	{ value: 8, label: 'Jump', description: 'E_TYPE_JUMP' },
	{ value: 9, label: 'Smash', description: 'E_TYPE_SMASH' },
	{ value: 10, label: 'Signature Crash', description: 'E_TYPE_SIGNATURE_CRASH' },
	{ value: 11, label: 'Signature Crash Camera', description: 'E_TYPE_SIGNATURE_CRASH_CAMERA' },
	{ value: 12, label: 'Road Limit', description: 'E_TYPE_ROAD_LIMIT' },
	{ value: 13, label: 'Overdrive Boost', description: 'E_TYPE_OVERDRIVE_BOOST' },
	{ value: 14, label: 'Overdrive Strength', description: 'E_TYPE_OVERDRIVE_STRENGTH' },
	{ value: 15, label: 'Overdrive Speed', description: 'E_TYPE_OVERDRIVE_SPEED' },
	{ value: 16, label: 'Overdrive Control', description: 'E_TYPE_OVERDRIVE_CONTROL' },
	{ value: 17, label: 'Tire Shop', description: 'E_TYPE_TIRE_SHOP' },
	{ value: 18, label: 'Tuning Shop', description: 'E_TYPE_TUNING_SHOP' },
	{ value: 19, label: 'Picture Paradise', description: 'E_TYPE_PICTURE_PARADISE' },
	{ value: 20, label: 'Tunnel', description: 'E_TYPE_TUNNEL' },
	{ value: 21, label: 'Overpass', description: 'E_TYPE_OVERPASS' },
	{ value: 22, label: 'Bridge', description: 'E_TYPE_BRIDGE' },
	{ value: 23, label: 'Warehouse', description: 'E_TYPE_WAREHOUSE' },
	{ value: 24, label: 'Large Overhead Object', description: 'E_TYPE_LARGE_OVERHEAD_OBJECT' },
	{ value: 25, label: 'Narrow Alley', description: 'E_TYPE_NARROW_ALLEY' },
	{ value: 26, label: 'Pass Tunnel', description: 'E_TYPE_PASS_TUNNEL' },
	{ value: 27, label: 'Pass Overpass', description: 'E_TYPE_PASS_OVERPASS' },
	{ value: 28, label: 'Pass Bridge', description: 'E_TYPE_PASS_BRIDGE' },
	{ value: 29, label: 'Pass Warehouse', description: 'E_TYPE_PASS_WAREHOUSE' },
	{ value: 30, label: 'Pass Large Overhead Object', description: 'E_TYPE_PASS_LARGEOVERHEADOBJECT' },
	{ value: 31, label: 'Pass Narrow Alley', description: 'E_TYPE_PASS_NARROWALLEY' },
	{ value: 32, label: 'Ramp', description: 'E_TYPE_RAMP' },
	{ value: 33, label: 'Gold' },
	{ value: 34, label: 'Island Entitlement' },
];

const BLACKSPOT_SCORE_TYPE_VALUES = [
	{ value: 0, label: 'Distance', description: 'E_SCORE_TYPE_DISTANCE' },
	{ value: 1, label: 'Car Count', description: 'E_SCORE_TYPE_CAR_COUNT' },
];

const SPAWN_TYPE_VALUES = [
	{ value: 0, label: 'Player Spawn', description: 'E_TYPE_PLAYER_SPAWN' },
	{ value: 1, label: 'Car Select Left', description: 'E_TYPE_CAR_SELECT_LEFT' },
	{ value: 2, label: 'Car Select Right', description: 'E_TYPE_CAR_SELECT_RIGHT' },
	{ value: 3, label: 'Car Unlock', description: 'E_TYPE_CAR_UNLOCK' },
];

// Landmark flags — mu8Flags. Only bit 0 is documented on the wiki.
const LANDMARK_FLAG_BITS = [
	{ mask: 0x01, label: 'Online', description: 'KI_FLAG_ONLINE — landmark is reachable in online mode.' },
];

// ---------------------------------------------------------------------------
// Drive-thru buffer validation.
//
// The drivethru manager and GUI cache use fixed-length arrays sized for
// drivethrus: 46 slots in v1.0 retail, 53 in v1.9 / Remastered. Exceeding
// the reservation causes a buffer overflow when the game iterates
// drivethrus at runtime. We count the "shop family" generic regions
// (junkyard, bike/gas/body/paint shops, car park, tire/tuning shops) and
// emit a warning at >46 and an error at >53. Without a reliable way to
// know the target profile at edit time we warn on both transitions so
// users editing for v1.0 still see the softer threshold.
// ---------------------------------------------------------------------------

const DRIVETHRU_TYPES: ReadonlySet<number> = new Set<number>([
	0, // Junk Yard
	1, // Bike Shop
	2, // Gas Station
	3, // Body Shop
	4, // Paint Shop
	5, // Car Park
	17, // Tire Shop
	18, // Tuning Shop
]);

const DRIVETHRU_LIMIT_V1_0 = 46;
const DRIVETHRU_LIMIT_V1_9 = 53;

function validateTriggerData(value: Record<string, unknown>): ValidationResult[] {
	const grs = (value.genericRegions as unknown[]) ?? [];
	let driveThruCount = 0;
	for (const gr of grs) {
		if (gr && typeof gr === 'object') {
			const type = (gr as { genericType?: number }).genericType;
			if (typeof type === 'number' && DRIVETHRU_TYPES.has(type)) driveThruCount++;
		}
	}
	const out: ValidationResult[] = [];
	if (driveThruCount > DRIVETHRU_LIMIT_V1_9) {
		out.push({
			severity: 'error',
			field: 'genericRegions',
			message: `Drive-thru count ${driveThruCount} exceeds the Remastered (v1.9) buffer reservation of ${DRIVETHRU_LIMIT_V1_9}. The game will overflow the drivethru manager / GUI cache arrays at runtime.`,
		});
	} else if (driveThruCount > DRIVETHRU_LIMIT_V1_0) {
		out.push({
			severity: 'warning',
			field: 'genericRegions',
			message: `Drive-thru count ${driveThruCount} exceeds the v1.0 buffer reservation of ${DRIVETHRU_LIMIT_V1_0}. Safe on v1.9 / Remastered (limit ${DRIVETHRU_LIMIT_V1_9}) but crashes v1.0 profiles.`,
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// Tree-label helpers
//
// All helpers defensively handle undefined values — label callbacks run on
// every render and must not throw, or the tree blows up mid-draw.
// ---------------------------------------------------------------------------

function boxPos(box: unknown): string {
	if (!box || typeof box !== 'object') return '?';
	const b = box as { positionX?: number; positionY?: number; positionZ?: number };
	const x = Math.round(b.positionX ?? 0);
	const y = Math.round(b.positionY ?? 0);
	const z = Math.round(b.positionZ ?? 0);
	return `(${x}, ${y}, ${z})`;
}

function vec4Pos(v: unknown): string {
	if (!v || typeof v !== 'object') return '?';
	const p = v as { x?: number; y?: number; z?: number };
	const x = Math.round(p.x ?? 0);
	const y = Math.round(p.y ?? 0);
	const z = Math.round(p.z ?? 0);
	return `(${x}, ${y}, ${z})`;
}

function landmarkLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const lm = value as { id?: number; designIndex?: number; box?: unknown };
		const idText = lm.id != null ? `id ${lm.id}` : 'id ?';
		const design = lm.designIndex != null ? ` · design ${lm.designIndex}` : '';
		return `#${index} · ${idText}${design} · ${boxPos(lm.box)}`;
	} catch {
		return `#${index}`;
	}
}

function genericRegionLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const gr = value as { genericType?: number; box?: unknown };
		const t = gr.genericType;
		const typeLabel = typeof t === 'number' && t >= 0 && t < GENERIC_REGION_TYPE_VALUES.length
			? GENERIC_REGION_TYPE_VALUES[t].label
			: `type ${t ?? '?'}`;
		return `#${index} · ${typeLabel} · ${boxPos(gr.box)}`;
	} catch {
		return `#${index}`;
	}
}

function blackspotLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const bs = value as { scoreAmount?: number; scoreType?: number; box?: unknown };
		const st = bs.scoreType;
		const kindLabel = typeof st === 'number' && st >= 0 && st < BLACKSPOT_SCORE_TYPE_VALUES.length
			? BLACKSPOT_SCORE_TYPE_VALUES[st].label
			: '?';
		return `#${index} · ${kindLabel} ${bs.scoreAmount ?? 0}pt · ${boxPos(bs.box)}`;
	} catch {
		return `#${index}`;
	}
}

function vfxLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const v = value as { box?: unknown; id?: number };
		const idText = v.id != null ? ` · id ${v.id}` : '';
		return `#${index}${idText} · ${boxPos(v.box)}`;
	} catch {
		return `#${index}`;
	}
}

function signatureStuntLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const st = value as { id?: bigint; stuntElementRegionIds?: number[] };
		const idHex = st.id != null ? `0x${st.id.toString(16).toUpperCase()}` : '?';
		const elems = st.stuntElementRegionIds?.length ?? 0;
		return `#${index} · ${idHex} · ${elems} elem${elems === 1 ? '' : 's'}`;
	} catch {
		return `#${index}`;
	}
}

function killzoneLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const kz = value as { triggerIds?: number[]; regionIds?: bigint[] };
		const triggers = kz.triggerIds?.length ?? 0;
		const regions = kz.regionIds?.length ?? 0;
		return `#${index} · ${triggers} trig · ${regions} reg`;
	} catch {
		return `#${index}`;
	}
}

function roamingLocationLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const rl = value as { position?: unknown; districtIndex?: number };
		const dist = rl.districtIndex != null ? `dist ${rl.districtIndex}` : 'dist ?';
		return `#${index} · ${dist} · ${vec4Pos(rl.position)}`;
	} catch {
		return `#${index}`;
	}
}

function spawnLocationLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const sp = value as { type?: number; position?: unknown };
		const t = sp.type;
		const typeLabel = typeof t === 'number' && t >= 0 && t < SPAWN_TYPE_VALUES.length
			? SPAWN_TYPE_VALUES[t].label
			: `type ${t ?? '?'}`;
		return `#${index} · ${typeLabel} · ${vec4Pos(sp.position)}`;
	} catch {
		return `#${index}`;
	}
}

function startingGridLabel(_value: unknown, index: number): string {
	return `Grid ${index}`;
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

// BoxRegion — 9 flat floats. Origin is the box center; rotation is in
// radians around each axis; dimensions are half-extents on each axis.
const BoxRegion: RecordSchema = {
	name: 'BoxRegion',
	description: 'Axis-aligned box with rotation and dimensions. Origin is the box center.',
	fields: {
		positionX: f32(),
		positionY: f32(),
		positionZ: f32(),
		rotationX: f32(),
		rotationY: f32(),
		rotationZ: f32(),
		dimensionX: f32(),
		dimensionY: f32(),
		dimensionZ: f32(),
	},
	fieldMetadata: {
		positionX: { label: 'Position X' },
		positionY: { label: 'Position Y' },
		positionZ: { label: 'Position Z' },
		rotationX: { label: 'Rotation X (rad)' },
		rotationY: { label: 'Rotation Y (rad)' },
		rotationZ: { label: 'Rotation Z (rad)' },
		dimensionX: { label: 'Dimension X' },
		dimensionY: { label: 'Dimension Y' },
		dimensionZ: { label: 'Dimension Z' },
	},
	propertyGroups: [
		{ title: 'Position', properties: ['positionX', 'positionY', 'positionZ'] },
		{ title: 'Rotation', properties: ['rotationX', 'rotationY', 'rotationZ'] },
		{ title: 'Dimension', properties: ['dimensionX', 'dimensionY', 'dimensionZ'] },
	],
};

// StartingGrid — 8 starting positions + 8 starting directions. The parser
// reads miStartingGridCount and walks N grids; retail data always has 0
// grids per landmark, so this record is effectively unused.
const StartingGrid: RecordSchema = {
	name: 'StartingGrid',
	description: 'Landmark starting grid — 8 positions and 8 directions. miStartingGridCount is always 0 in retail; this record is effectively unused by shipped game data but preserved here for fidelity.',
	fields: {
		startingPositions: fixedList(vec4(), 8),
		startingDirections: fixedList(vec4(), 8),
	},
	fieldMetadata: {
		startingPositions: { label: 'Starting positions (8 × Vector4)' },
		startingDirections: { label: 'Starting directions (8 × Vector4)' },
	},
	label: (_value, index) => startingGridLabel(_value, index ?? 0),
};

// Shared TriggerRegion base fields — inlined into each subclass. The
// schema framework doesn't support record inheritance and the parser
// spreads the base into its subclasses in-place, so inlining matches the
// parsed shape exactly.
const TRIGGER_REGION_BASE_FIELDS = {
	box: record('BoxRegion'),
	id: i32(),
	regionIndex: i16(),
	type: { kind: 'enum' as const, storage: 'u8' as const, values: TRIGGER_REGION_TYPE_VALUES },
	enabled: u8(),
};

const TRIGGER_REGION_BASE_METADATA = {
	id: {
		label: 'ID',
		description: 'mId — per-region identifier. Killzones and signature stunts reference regions by this ID; the writer throws if a referenced id is missing.',
	},
	regionIndex: {
		label: 'Region index',
		description: 'miRegionIndex — index into the consolidated mppRegions pointer array. Must be unique across all regions in the bundle.',
	},
	type: {
		label: 'Region type',
		description: 'Should match the list this region lives in (Landmark=0, Blackspot=1, Generic=2, VFXBoxRegion=3).',
	},
	enabled: {
		label: 'Enabled',
		description: '1 = active, 0 = disabled. Drive-thrus only persist to 1.0 profile saves when set to 1.',
	},
};

const Landmark: RecordSchema = {
	name: 'Landmark',
	description: 'Challenge landmark — a named region that appears in the online landmark list.',
	fields: {
		...TRIGGER_REGION_BASE_FIELDS,
		startingGrids: {
			kind: 'list',
			item: record('StartingGrid'),
			addable: true,
			removable: true,
			itemLabel: (value, index) => startingGridLabel(value, index),
		},
		designIndex: u8(),
		district: u8(),
		flags: { kind: 'flags', storage: 'u8', bits: LANDMARK_FLAG_BITS },
	},
	fieldMetadata: {
		...TRIGGER_REGION_BASE_METADATA,
		startingGrids: {
			description: 'mpaStartingGrids — miStartingGridCount is always 0 in retail data, so this list is almost always empty.',
		},
		designIndex: {
			label: 'Design index',
			description: 'muDesignIndex — landmark design identifier; indexes into the landmark art/meta tables.',
		},
		district: {
			label: 'District',
			description: 'muDistrict — district ID. Always 3 in retail.',
		},
		flags: { label: 'Flags' },
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['id', 'regionIndex', 'type', 'enabled', 'designIndex', 'district', 'flags'] },
		{ title: 'Box', properties: ['box'] },
		{ title: 'Starting Grids', properties: ['startingGrids'] },
	],
	label: (value, index) => landmarkLabel(value, index ?? 0),
};

const GenericRegion: RecordSchema = {
	name: 'GenericRegion',
	description: 'Generic region — the kitchen-sink variant covering shops, jumps, smashes, overdrives, and terrain tags. Must be sorted by ID so the game can binary-search at runtime.',
	fields: {
		...TRIGGER_REGION_BASE_FIELDS,
		groupId: i32(),
		cameraCut1: i16(),
		cameraCut2: i16(),
		cameraType1: { kind: 'enum', storage: 'i8', values: STUNT_CAMERA_TYPE_VALUES },
		cameraType2: { kind: 'enum', storage: 'i8', values: STUNT_CAMERA_TYPE_VALUES },
		genericType: { kind: 'enum', storage: 'u8', values: GENERIC_REGION_TYPE_VALUES },
		isOneWay: i8(),
	},
	fieldMetadata: {
		...TRIGGER_REGION_BASE_METADATA,
		groupId: { label: 'Group ID', description: 'miGroupID — GameDB group identifier.' },
		cameraCut1: { label: 'Camera cut 1', description: 'miCameraCut1 — index into a cut sequence.' },
		cameraCut2: { label: 'Camera cut 2' },
		cameraType1: { label: 'Camera type 1' },
		cameraType2: { label: 'Camera type 2' },
		genericType: { label: 'Generic type' },
		isOneWay: { label: 'Is one way', description: 'Stored as int8. 0 = bidirectional, non-zero = one-way trigger.' },
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['id', 'regionIndex', 'type', 'enabled', 'genericType', 'groupId', 'isOneWay'] },
		{ title: 'Cameras', properties: ['cameraCut1', 'cameraCut2', 'cameraType1', 'cameraType2'] },
		{ title: 'Box', properties: ['box'] },
	],
	label: (value, index) => genericRegionLabel(value, index ?? 0),
};

const Blackspot: RecordSchema = {
	name: 'Blackspot',
	description: 'Blackspot — a crash-scoring trigger.',
	fields: {
		...TRIGGER_REGION_BASE_FIELDS,
		scoreType: { kind: 'enum', storage: 'u8', values: BLACKSPOT_SCORE_TYPE_VALUES },
		scoreAmount: i32(),
	},
	fieldMetadata: {
		...TRIGGER_REGION_BASE_METADATA,
		scoreType: { label: 'Score type' },
		scoreAmount: {
			label: 'Score amount',
			description: 'miScoreAmount — target score. Interpreted as distance or car count depending on scoreType.',
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['id', 'regionIndex', 'type', 'enabled', 'scoreType', 'scoreAmount'] },
		{ title: 'Box', properties: ['box'] },
	],
	label: (value, index) => blackspotLabel(value, index ?? 0),
};

const VFXBoxRegion: RecordSchema = {
	name: 'VFXBoxRegion',
	description: 'VFX box region — a plain trigger box with no extra fields beyond the TriggerRegion base.',
	fields: {
		...TRIGGER_REGION_BASE_FIELDS,
	},
	fieldMetadata: {
		...TRIGGER_REGION_BASE_METADATA,
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['id', 'regionIndex', 'type', 'enabled'] },
		{ title: 'Box', properties: ['box'] },
	],
	label: (value, index) => vfxLabel(value, index ?? 0),
};

const Killzone: RecordSchema = {
	name: 'Killzone',
	description: 'Killzone — a set of GenericRegion trigger IDs plus a set of CgsID region IDs.',
	fields: {
		triggerIds: primList(i32()),
		regionIds: primList(cgsId()),
	},
	fieldMetadata: {
		triggerIds: {
			label: 'Trigger IDs',
			description: 'GenericRegion.id values. The writer resolves these to file offsets and throws "Missing GenericRegion offset for id X" if a referenced id is not present in genericRegions.',
		},
		regionIds: {
			label: 'Region IDs (CgsID[])',
			description: 'GameDB region hashes (64-bit), written verbatim.',
		},
	},
	label: (value, index) => killzoneLabel(value, index ?? 0),
};

const SignatureStunt: RecordSchema = {
	name: 'SignatureStunt',
	description: 'Signature stunt — a named stunt composed of one or more generic regions.',
	fields: {
		id: cgsId(),
		camera: int64(),
		stuntElementRegionIds: primList(i32()),
	},
	fieldMetadata: {
		id: {
			label: 'ID (CgsID)',
			description: 'mId — GameDB hash identifying the stunt.',
		},
		camera: {
			label: 'Camera (int64)',
			description: 'miCamera — opaque 64-bit camera identifier. Semantics TBD on the wiki.',
		},
		stuntElementRegionIds: {
			label: 'Stunt element region IDs',
			description: 'GenericRegion.id values. Same constraint as killzones — the writer throws if a referenced id is missing.',
		},
	},
	label: (value, index) => signatureStuntLabel(value, index ?? 0),
};

const RoamingLocation: RecordSchema = {
	name: 'RoamingLocation',
	description: 'Roaming traffic / AI spawn location.',
	fields: {
		position: vec4(),
		districtIndex: u8(),
	},
	fieldMetadata: {
		position: { label: 'Position (Vector4)' },
		districtIndex: {
			label: 'District index',
			description: 'muDistrictIndex — identifies which district the location belongs to.',
		},
	},
	label: (value, index) => roamingLocationLabel(value, index ?? 0),
};

const SpawnLocation: RecordSchema = {
	name: 'SpawnLocation',
	description: 'Player / car spawn location — used for player spawn, car select screen, and unlock cinematics.',
	fields: {
		position: vec4(),
		direction: vec4(),
		junkyardId: cgsId(),
		type: { kind: 'enum', storage: 'u8', values: SPAWN_TYPE_VALUES },
	},
	fieldMetadata: {
		position: { label: 'Position (Vector4)' },
		direction: { label: 'Direction (Vector4)' },
		junkyardId: {
			label: 'Junkyard ID (CgsID)',
			description: 'mJunkyardId — GameDB hash of the junkyard this spawn belongs to.',
		},
		type: { label: 'Spawn type' },
	},
	label: (value, index) => spawnLocationLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root — TriggerData
//
// The property groups preserve the original editor's top-level tab
// structure. Header and Map 2D wrap existing components via the
// extension registry; every other list tab references the matching field
// (whose customRenderer points back at the same extension name), so the
// default rendering path is used regardless of whether the user clicks
// the tab or navigates to the list via the tree.
// ---------------------------------------------------------------------------

const TRIGGER_DATA_PROPERTY_GROUPS: PropertyGroup[] = [
	{ title: 'Header', component: 'HeaderTab' },
	{ title: 'Map 2D', component: 'RegionsMapTab' },
	{ title: 'Landmarks', properties: ['landmarks'] },
	{ title: 'Generic Regions', properties: ['genericRegions'] },
	{ title: 'Blackspots', properties: ['blackspots'] },
	{ title: 'VFX', properties: ['vfxBoxRegions'] },
	{ title: 'Signature Stunts', properties: ['signatureStunts'] },
	{ title: 'Killzones', properties: ['killzones'] },
	{ title: 'Roaming', properties: ['roamingLocations'] },
	{ title: 'Spawns', properties: ['spawnLocations'] },
];

const TriggerData: RecordSchema = {
	name: 'TriggerData',
	description: 'Root record for the Trigger Data resource (0x10003). Contains landmarks, generic regions (drive-thrus, jumps, smashes, overdrives, …), blackspots, VFX boxes, signature stunts, killzones, and spawn/roaming locations.',
	fields: {
		version: i32(),
		size: u32(),
		playerStartPosition: vec4(),
		playerStartDirection: vec4(),
		landmarks: recordList('Landmark', landmarkLabel, 'LandmarksTab'),
		onlineLandmarkCount: i32(),
		signatureStunts: recordList('SignatureStunt', signatureStuntLabel, 'SignatureStuntsTab'),
		genericRegions: recordList('GenericRegion', genericRegionLabel, 'GenericRegionsTab'),
		killzones: recordList('Killzone', killzoneLabel, 'KillzonesTab'),
		blackspots: recordList('Blackspot', blackspotLabel, 'BlackspotsTab'),
		vfxBoxRegions: recordList('VFXBoxRegion', vfxLabel, 'VfxTab'),
		roamingLocations: recordList('RoamingLocation', roamingLocationLabel, 'RoamingTab'),
		spawnLocations: recordList('SpawnLocation', spawnLocationLabel, 'SpawnsTab'),
	},
	fieldMetadata: {
		version: {
			label: 'Version',
			description: 'miVersionNumber — resource version. 42 in review builds; retail uses its own values.',
		},
		size: {
			label: 'Size (bytes)',
			description: 'muSize — total resource byte length. Patched by the writer on every call, so user edits are ignored.',
			hidden: true,
			readOnly: true,
		},
		playerStartPosition: {
			label: 'Player start position',
			description: 'mPlayerStartPosition — dev start position (Vector4).',
		},
		playerStartDirection: {
			label: 'Player start direction',
			description: 'mPlayerStartDirection — dev start direction (Vector4).',
		},
		landmarks: {
			description: 'Landmarks — listed before online landmarks in the binary. miLandmarkCount is derived from this array\'s length at write time.',
		},
		onlineLandmarkCount: {
			label: 'Online landmark count',
			description: 'miOnlineLandmarkCount — independent of landmarks.length; typically 0 in offline bundles.',
		},
		signatureStunts: {
			description: 'Each signature stunt references generic regions by ID; the writer throws "Missing GenericRegion offset for id X" if a reference is unknown.',
		},
		genericRegions: {
			description: 'Must be sorted by ID for the game\'s runtime binary search. See the drive-thru validation on the root record for the buffer reservation caveat.',
		},
		killzones: {
			description: 'Each killzone references generic regions by ID; the writer throws on unknown references.',
		},
		vfxBoxRegions: {
			description: 'VFX box regions — the simplest region variant (no extra fields beyond the TriggerRegion base).',
		},
		roamingLocations: {
			description: 'Roaming traffic / AI spawn points. Each entry has 15 bytes of implicit trailing padding in the binary.',
		},
		spawnLocations: {
			description: 'Player / car-select / unlock spawn points. Each entry has 7 bytes of implicit trailing padding in the binary.',
		},
	},
	propertyGroups: TRIGGER_DATA_PROPERTY_GROUPS,
	validate: validateTriggerData,
};

// ---------------------------------------------------------------------------
// Registry + exported resource schema
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	TriggerData,
	BoxRegion,
	StartingGrid,
	Landmark,
	GenericRegion,
	Blackspot,
	VFXBoxRegion,
	Killzone,
	SignatureStunt,
	RoamingLocation,
	SpawnLocation,
};

export const triggerDataResourceSchema: ResourceSchema = {
	key: 'triggerData',
	name: 'Trigger Data',
	rootType: 'TriggerData',
	registry,
};

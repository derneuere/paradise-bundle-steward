// Hand-written schema for ParsedTrafficData.
//
// Mirrors the types in `src/lib/core/trafficData.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here or the walker will report it as an unknown field.
//
// Fields that are derived from array lengths (`muNum*`) or patched at write
// time (`muSizeInBytes`) are marked readOnly + hidden. Phase A's round-trip
// test exercises parse → walk → write with no edits, so these don't need to
// be reconciled here; that's Phase B's job.

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

// Shorthand field constructors. Keeps the schema readable given how many
// entries there are.
const u8 = (): FieldSchema => ({ kind: 'u8' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const i8 = (): FieldSchema => ({ kind: 'i8' });
const i16 = (): FieldSchema => ({ kind: 'i16' });
const i32 = (): FieldSchema => ({ kind: 'i32' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const bool = (): FieldSchema => ({ kind: 'bool' });
const vec4 = (): FieldSchema => ({ kind: 'vec4' });
const matrix44 = (): FieldSchema => ({ kind: 'matrix44' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

// Fixed-size primitive tuple (e.g., `mauForwardHulls: u16[3]`).
const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

// Variable-length primitive list (e.g., `cumulativeProbs: u8[]`).
const primList = (item: FieldSchema): FieldSchema => ({
	kind: 'list',
	item,
	addable: true,
	removable: true,
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

// Fixed-size record list (e.g., `maTrafficLightControllers: TrafficLightController[8]`).
const fixedRecordList = (type: string, length: number): FieldSchema => ({
	kind: 'list',
	item: record(type),
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

// Ref into another list by index.
const ref = (
	listPath: (string | number)[],
	itemType: string,
	opts: { storage?: 'u8' | 'u16' | 'u32'; displayName?: string; nullValue?: number } = {},
): FieldSchema => ({
	kind: 'ref',
	storage: opts.storage ?? 'u16',
	target: { listPath, itemType, displayName: opts.displayName },
	nullValue: opts.nullValue,
});

// CgsID — 64-bit hash, displayed as hex.
const cgsId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });

// ---------------------------------------------------------------------------
// Enum tables (lifted from trafficData + parser constants)
// ---------------------------------------------------------------------------

const VEHICLE_CLASS_VALUES = [
	{ value: 0, label: 'Car' },
	{ value: 1, label: 'Van' },
	{ value: 2, label: 'Bus' },
	{ value: 3, label: 'Big Rig' },
];

const VEHICLE_FLAG_BITS = [
	{ mask: 0x01, label: 'Trailer' },
	{ mask: 0x02, label: 'Bus' },
	{ mask: 0x04, label: 'Taxi' },
	{ mask: 0x08, label: 'Emergency' },
	{ mask: 0x10, label: 'Bike' },
	{ mask: 0x20, label: 'Truck' },
];

// ---------------------------------------------------------------------------
// Tree label helpers
// ---------------------------------------------------------------------------

// Describe a flow type by its first vehicle type's class.
function flowTypeLabel(ft: unknown, index: number, ctx: SchemaContext): string {
	if (!ft || typeof ft !== 'object') return `#${index}`;
	const flow = ft as { vehicleTypeIds?: number[]; cumulativeProbs?: number[] };
	const ids = flow.vehicleTypeIds ?? [];
	if (ids.length === 0) return `#${index} · empty`;
	const root = ctx.root as { vehicleTypes?: { muVehicleClass: number }[] } | undefined;
	const vt = root?.vehicleTypes?.[ids[0]];
	const cls = vt ? (VEHICLE_CLASS_VALUES[vt.muVehicleClass]?.label ?? '?') : '?';
	const more = ids.length > 1 ? ` +${ids.length - 1}` : '';
	return `#${index} · ${cls}${more}`;
}

function hullLabel(hull: unknown, index: number): string {
	if (!hull || typeof hull !== 'object') return `#${index}`;
	const h = hull as { sections?: unknown[]; rungs?: unknown[]; junctions?: unknown[] };
	return `Hull ${index} · ${h.sections?.length ?? 0} sec · ${h.rungs?.length ?? 0} rungs · ${h.junctions?.length ?? 0} jct`;
}

function sectionLabel(sec: unknown, index: number): string {
	if (!sec || typeof sec !== 'object') return `#${index}`;
	const s = sec as { mfSpeed?: number; muSpanIndex?: number };
	const speed = s.mfSpeed != null ? `${s.mfSpeed.toFixed(0)} m/s` : '?';
	return `#${index} · ${speed} · span ${s.muSpanIndex ?? '?'}`;
}

function sectionFlowLabel(sf: unknown, index: number, ctx: SchemaContext): string {
	if (!sf || typeof sf !== 'object') return `#${index}`;
	const f = sf as { muFlowTypeId?: number; muVehiclesPerMinute?: number };
	const root = ctx.root as { flowTypes?: { vehicleTypeIds: number[] }[] } | undefined;
	const ft = f.muFlowTypeId != null ? root?.flowTypes?.[f.muFlowTypeId] : undefined;
	const tag = ft ? `→ FlowType #${f.muFlowTypeId}` : `→ FlowType #${f.muFlowTypeId ?? '?'} (?)`;
	return `#${index} · ${tag} · ${f.muVehiclesPerMinute ?? 0}/min`;
}

function staticVehicleLabel(sv: unknown, index: number): string {
	if (!sv || typeof sv !== 'object') return `#${index}`;
	const v = sv as { mTransform?: number[]; mFlowTypeID?: number };
	const m = v.mTransform;
	const pos = m ? `(${m[12]?.toFixed(0) ?? 0}, ${m[13]?.toFixed(0) ?? 0}, ${m[14]?.toFixed(0) ?? 0})` : '?';
	return `#${index} · FlowType #${v.mFlowTypeID ?? '?'} · ${pos}`;
}

function junctionLabel(j: unknown, index: number): string {
	if (!j || typeof j !== 'object') return `#${index}`;
	const jx = j as { muID?: number; muNumStates?: number; muNumLights?: number };
	return `#${index} · ID ${jx.muID ?? '?'} · ${jx.muNumStates ?? 0} states · ${jx.muNumLights ?? 0} lights`;
}

function vehicleTypeLabel(vt: unknown, index: number): string {
	if (!vt || typeof vt !== 'object') return `#${index}`;
	const v = vt as { muVehicleClass?: number; muAssetId?: number };
	const cls = v.muVehicleClass != null ? (VEHICLE_CLASS_VALUES[v.muVehicleClass]?.label ?? `class ${v.muVehicleClass}`) : '?';
	return `#${index} · ${cls} · asset ${v.muAssetId ?? '?'}`;
}

function vehicleAssetLabel(a: unknown, index: number): string {
	if (!a || typeof a !== 'object') return `#${index}`;
	const x = a as { mVehicleId?: bigint };
	const id = x.mVehicleId != null ? `0x${x.mVehicleId.toString(16).toUpperCase()}` : '?';
	return `#${index} · ${id}`;
}

function killZoneLabel(kz: unknown, index: number): string {
	if (!kz || typeof kz !== 'object') return `#${index}`;
	const k = kz as { muOffset?: number; muCount?: number };
	return `#${index} · offset ${k.muOffset ?? 0} · count ${k.muCount ?? 0}`;
}

function neighbourLabel(n: unknown, index: number): string {
	if (!n || typeof n !== 'object') return `#${index}`;
	const x = n as { muSection?: number };
	return `#${index} → section ${x.muSection ?? '?'}`;
}

function lightTriggerLabel(lt: unknown, index: number): string {
	if (!lt || typeof lt !== 'object') return `#${index}`;
	const t = lt as { mPosPlusYRot?: { x: number; y: number; z: number } };
	const p = t.mPosPlusYRot;
	return p ? `#${index} · (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})` : `#${index}`;
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const PvsHullSet: RecordSchema = {
	name: 'PvsHullSet',
	description: 'PVS cell — up to 8 visible hulls.',
	fields: {
		mauItems: fixedList(u16(), 8),
		muCount: u32(),
	},
	fieldMetadata: {
		mauItems: { label: 'Hull indexes' },
		muCount: { label: 'Count' },
	},
};

const TrafficPvs: RecordSchema = {
	name: 'TrafficPvs',
	description: 'Potentially Visible Set — spatial grid + per-cell hull lists.',
	fields: {
		mGridMin: vec4(),
		mCellSize: vec4(),
		mRecipCellSize: vec4(),
		muNumCells_X: u32(),
		muNumCells_Z: u32(),
		muNumCells: u32(),
		hullPvsSets: recordList('PvsHullSet'),
	},
	fieldMetadata: {
		muNumCells: { label: 'Num cells (total)', readOnly: true, derivedFrom: 'muNumCells_X · muNumCells_Z' },
		mRecipCellSize: { description: 'Reciprocal of cell size — derived from mCellSize.' },
	},
};

const TrafficSection: RecordSchema = {
	name: 'TrafficSection',
	description: 'One traffic section (lane strip) within a hull.',
	fields: {
		muRungOffset: u32(),
		muNumRungs: u8(),
		muStopLineOffset: u8(),
		muNumStopLines: u8(),
		muSpanIndex: u8(),
		mauForwardHulls: fixedList(u16(), 3),
		mauBackwardHulls: fixedList(u16(), 3),
		mauForwardSections: fixedList(u8(), 3),
		mauBackwardSections: fixedList(u8(), 3),
		muTurnLeftProb: u8(),
		muTurnRightProb: u8(),
		muNeighbourOffset: u16(),
		muLeftNeighbourCount: u8(),
		muRightNeighbourCount: u8(),
		muChangeLeftProb: u8(),
		muChangeRightProb: u8(),
		_pad22: fixedList(u8(), 2),
		mfSpeed: f32(),
		mfLength: f32(),
		_pad2C: fixedList(u8(), 4),
	},
	fieldMetadata: {
		muNumRungs: { readOnly: true, derivedFrom: 'rungs' },
		muNumStopLines: { readOnly: true, derivedFrom: 'stopLines' },
		muLeftNeighbourCount: { readOnly: true },
		muRightNeighbourCount: { readOnly: true },
		_pad22: { hidden: true },
		_pad2C: { hidden: true },
	},
};

const TrafficLaneRung: RecordSchema = {
	name: 'TrafficLaneRung',
	fields: {
		maPoints: fixedList(vec4(), 2),
	},
	fieldMetadata: {
		maPoints: { label: 'Points (A, B)' },
	},
};

const TrafficNeighbour: RecordSchema = {
	name: 'TrafficNeighbour',
	fields: {
		muSection: u8(),
		muSharedLength: u8(),
		muOurStartRung: u8(),
		muTheirStartRung: u8(),
	},
};

const TrafficSectionSpan: RecordSchema = {
	name: 'TrafficSectionSpan',
	fields: {
		muMaxVehicles: u16(),
		_pad02: fixedList(u8(), 2),
		mfMaxVehicleRecip: f32(),
	},
	fieldMetadata: {
		_pad02: { hidden: true },
		mfMaxVehicleRecip: { readOnly: true, derivedFrom: 'muMaxVehicles', description: '1 / muMaxVehicles' },
	},
};

const TrafficStaticVehicle: RecordSchema = {
	name: 'TrafficStaticVehicle',
	fields: {
		mTransform: matrix44(),
		mFlowTypeID: ref(['flowTypes'], 'TrafficFlowType', { storage: 'u16', displayName: 'Flow type' }),
		mExistsAtAllChance: u8(),
		muFlags: u8(),
		_pad43: fixedList(u8(), 12),
	},
	fieldMetadata: {
		mTransform: { label: 'Transform (4x4)' },
		mExistsAtAllChance: { description: '0–255 probability' },
		_pad43: { hidden: true },
	},
};

const TrafficSectionFlow: RecordSchema = {
	name: 'TrafficSectionFlow',
	description: 'Per-section flow assignment — ties a section to a FlowType.',
	fields: {
		muFlowTypeId: ref(['flowTypes'], 'TrafficFlowType', { storage: 'u16', displayName: 'Flow type' }),
		muVehiclesPerMinute: u16(),
	},
};

const TrafficLightController: RecordSchema = {
	name: 'TrafficLightController',
	fields: {
		mauTrafficLightIds: fixedList(u16(), 2),
		mauStopLineIds: fixedList(u8(), 6),
		mauStopLineHulls: fixedList(u16(), 6),
		muNumStopLines: u8(),
		muNumTrafficLights: u8(),
	},
};

const TrafficJunctionLogicBox: RecordSchema = {
	name: 'TrafficJunctionLogicBox',
	fields: {
		muID: u32(),
		mauStateTimings: fixedList(u16(), 16),
		mauStoppedLightStates: fixedList(u8(), 16),
		muNumStates: u8(),
		muNumLights: u8(),
		_pad36: fixedList(u8(), 2),
		muEventJunctionID: u32(),
		miOfflineStartDataIndex: i32(),
		miOnlineStartDataIndex: i32(),
		miBikeStartDataIndex: i32(),
		maTrafficLightControllers: fixedRecordList('TrafficLightController', 8),
		_pad108: fixedList(u8(), 8),
		mPosition: vec4(),
	},
	fieldMetadata: {
		_pad36: { hidden: true },
		_pad108: { hidden: true },
		miOfflineStartDataIndex: { description: '-1 if unused' },
		miOnlineStartDataIndex: { description: '-1 if unused' },
		miBikeStartDataIndex: { description: '-1 if unused' },
	},
	propertyGroups: [
		{
			title: 'Identity',
			properties: ['muID', 'muEventJunctionID', 'mPosition'],
		},
		{
			title: 'Timings',
			properties: ['muNumStates', 'mauStateTimings', 'mauStoppedLightStates'],
		},
		{
			title: 'Controllers',
			properties: ['muNumLights', 'maTrafficLightControllers'],
		},
		{
			title: 'Start Data',
			properties: ['miOfflineStartDataIndex', 'miOnlineStartDataIndex', 'miBikeStartDataIndex'],
		},
	],
};

const TrafficStopLine: RecordSchema = {
	name: 'TrafficStopLine',
	fields: {
		muParamFixed: u16(),
	},
};

const TrafficLightTrigger: RecordSchema = {
	name: 'TrafficLightTrigger',
	fields: {
		mDimensions: vec4(),
		mPosPlusYRot: vec4(),
	},
	fieldMetadata: {
		mPosPlusYRot: { label: 'Position + Y rotation' },
	},
};

const TrafficLightTriggerStartData: RecordSchema = {
	name: 'TrafficLightTriggerStartData',
	fields: {
		maStartingPositions: fixedList(vec4(), 8),
		maStartingDirections: fixedList(vec4(), 8),
		maDestinationIDs: fixedList(cgsId(), 16),
		maeDestinationDifficulties: fixedList(u8(), 16),
		muNumStartingPositions: u8(),
		muNumDestinations: u8(),
		muNumLanes: u8(),
		_pad193: fixedList(u8(), 13),
	},
	fieldMetadata: {
		_pad193: { hidden: true },
	},
};

const TrafficHull: RecordSchema = {
	name: 'TrafficHull',
	description: 'One traffic hull — a contiguous region containing sections, rungs, junctions, etc.',
	fields: {
		muNumSections: u8(),
		muNumSectionSpans: u8(),
		muNumJunctions: u8(),
		muNumStoplines: u8(),
		muNumNeighbours: u8(),
		muNumStaticTraffic: u8(),
		muNumVehicleAssets: u8(),
		_pad07: u8(),
		muNumRungs: u16(),
		muFirstTrafficLight: u16(),
		muLastTrafficLight: u16(),
		muNumLightTriggers: u8(),
		muNumLightTriggersStartData: u8(),
		sections: recordList('TrafficSection', sectionLabel, 'SectionsTab'),
		rungs: recordList('TrafficLaneRung', undefined, 'LaneRungsTab'),
		cumulativeRungLengths: primList(f32()),
		neighbours: recordList('TrafficNeighbour', neighbourLabel, 'NeighboursTab'),
		sectionSpans: recordList('TrafficSectionSpan', undefined, 'SectionSpansTab'),
		staticTrafficVehicles: recordList('TrafficStaticVehicle', staticVehicleLabel, 'StaticVehiclesTab'),
		sectionFlows: recordList('TrafficSectionFlow', sectionFlowLabel, 'SectionFlowsTab'),
		junctions: recordList('TrafficJunctionLogicBox', junctionLabel, 'JunctionsTab'),
		stopLines: recordList('TrafficStopLine'),
		lightTriggers: recordList('TrafficLightTrigger', lightTriggerLabel, 'LightTriggersTab'),
		lightTriggerStartData: recordList('TrafficLightTriggerStartData'),
		lightTriggerJunctionLookup: primList(u8()),
		mauVehicleAssets: fixedList(u8(), 16),
	},
	fieldMetadata: {
		muNumSections: { readOnly: true, derivedFrom: 'sections', hidden: true },
		muNumSectionSpans: { readOnly: true, derivedFrom: 'sectionSpans', hidden: true },
		muNumJunctions: { readOnly: true, derivedFrom: 'junctions', hidden: true },
		muNumStoplines: { readOnly: true, derivedFrom: 'stopLines', hidden: true },
		muNumNeighbours: { readOnly: true, derivedFrom: 'neighbours', hidden: true },
		muNumStaticTraffic: { readOnly: true, derivedFrom: 'staticTrafficVehicles', hidden: true },
		muNumVehicleAssets: { readOnly: true, derivedFrom: 'mauVehicleAssets', hidden: true },
		muNumRungs: { readOnly: true, derivedFrom: 'rungs', hidden: true },
		muNumLightTriggers: { readOnly: true, derivedFrom: 'lightTriggers', hidden: true },
		muNumLightTriggersStartData: { readOnly: true, derivedFrom: 'lightTriggerStartData', hidden: true },
		_pad07: { hidden: true },
		cumulativeRungLengths: { description: 'Parallel array to rungs.' },
		lightTriggerJunctionLookup: { description: 'Maps each light trigger to its junction index.' },
	},
	label: (value, index) => hullLabel(value, index ?? 0),
};

const TrafficFlowType: RecordSchema = {
	name: 'TrafficFlowType',
	description: 'A flow mix — selects vehicle types by cumulative probability.',
	fields: {
		vehicleTypeIds: primList(ref(['vehicleTypes'], 'TrafficVehicleTypeData', { storage: 'u16', displayName: 'Vehicle type' })),
		cumulativeProbs: primList(u8()),
		muNumVehicleTypes: u8(),
	},
	fieldMetadata: {
		muNumVehicleTypes: { readOnly: true, derivedFrom: 'vehicleTypeIds', hidden: true },
	},
	label: (value, index, ctx) => flowTypeLabel(value, index ?? 0, ctx),
};

const TrafficKillZone: RecordSchema = {
	name: 'TrafficKillZone',
	fields: {
		muOffset: u16(),
		muCount: u8(),
		_pad03: u8(),
	},
	fieldMetadata: {
		_pad03: { hidden: true },
	},
};

const TrafficKillZoneRegion: RecordSchema = {
	name: 'TrafficKillZoneRegion',
	fields: {
		muHull: u16(),
		muSection: u8(),
		muStartRung: u8(),
		muEndRung: u8(),
		_pad05: u8(),
	},
	fieldMetadata: {
		_pad05: { hidden: true },
	},
};

const TrafficVehicleTypeData: RecordSchema = {
	name: 'TrafficVehicleTypeData',
	fields: {
		muTrailerFlowTypeId: ref(['flowTypes'], 'TrafficFlowType', { storage: 'u16', displayName: 'Trailer flow' }),
		mxVehicleFlags: { kind: 'flags', storage: 'u8', bits: VEHICLE_FLAG_BITS },
		muVehicleClass: { kind: 'enum', storage: 'u8', values: VEHICLE_CLASS_VALUES },
		muInitialDirt: u8(),
		muAssetId: ref(['vehicleAssets'], 'TrafficVehicleAsset', { storage: 'u8', displayName: 'Asset' }),
		muTraitsId: ref(['vehicleTraits'], 'TrafficVehicleTraits', { storage: 'u8', displayName: 'Traits' }),
		_pad07: u8(),
	},
	fieldMetadata: {
		_pad07: { hidden: true },
		muInitialDirt: { description: 'Typically 0 in retail data.' },
	},
};

const TrafficVehicleTypeUpdateData: RecordSchema = {
	name: 'TrafficVehicleTypeUpdateData',
	fields: {
		mfWheelRadius: f32(),
		mfSuspensionRoll: f32(),
		mfSuspensionPitch: f32(),
		mfSuspensionTravel: f32(),
		mfMass: f32(),
	},
};

const TrafficVehicleAsset: RecordSchema = {
	name: 'TrafficVehicleAsset',
	fields: {
		mVehicleId: cgsId(),
	},
};

const TrafficVehicleTraits: RecordSchema = {
	name: 'TrafficVehicleTraits',
	fields: {
		mfSwervingAmountModifier: f32(),
		mfAcceleration: f32(),
		muCuttingUpChance: u8(),
		muTailgatingChance: u8(),
		muPatience: u8(),
		muTantrumAttackCumProb: u8(),
		muTantrumStopCumProb: u8(),
		_pad0D: fixedList(u8(), 3),
	},
	fieldMetadata: {
		_pad0D: { hidden: true },
	},
};

const TrafficLightType: RecordSchema = {
	name: 'TrafficLightType',
	fields: {
		muCoronaOffset: u8(),
		muNumCoronas: u8(),
	},
};

const TrafficLightCollection: RecordSchema = {
	name: 'TrafficLightCollection',
	fields: {
		posAndYRotations: primList(vec4()),
		instanceIDs: primList(u32()),
		instanceTypes: primList(u8()),
		trafficLightTypes: recordList('TrafficLightType'),
		coronaTypes: primList(u8()),
		coronaPositions: primList(vec4()),
		mauInstanceHashOffsets: fixedList(u16(), 129),
		instanceHashTable: primList(u32()),
		instanceHashToIndexLookup: primList(u16()),
	},
	fieldMetadata: {
		mauInstanceHashOffsets: { hidden: true, description: 'Fixed 129-entry hash bucket offset table.' },
		instanceHashTable: { hidden: true, description: 'Hash table — regenerated at write time.' },
		instanceHashToIndexLookup: { hidden: true },
	},
};

// Root-level tabs shown when the TrafficData node itself is selected. Four
// of these delegate to existing Phase 1 tabs through the extension registry
// (component: ...); the others list plain fields that the schema-driven
// form already knows how to render.
//
// Tree-driven navigation still works orthogonally — clicking `hulls[3]` in
// the left tree changes the inspector to a TrafficHull form regardless of
// which root tab was last active.
const TRAFFIC_DATA_GROUPS: PropertyGroup[] = [
	{
		title: 'Overview',
		component: 'OverviewTab',
	},
	{
		title: 'Header',
		properties: ['muDataVersion', 'muSizeInBytes'],
	},
	{
		title: 'World',
		properties: ['pvs'],
	},
	{
		title: 'Flow Types',
		properties: ['flowTypes'],
	},
	{
		title: 'Vehicles',
		component: 'VehiclesTab',
	},
	{
		title: 'Kill Zones',
		component: 'KillZonesTab',
	},
	{
		title: 'Lights',
		component: 'TrafficLightsTab',
	},
	{
		title: 'Paint',
		properties: ['paintColours'],
	},
];

const TrafficData: RecordSchema = {
	name: 'TrafficData',
	description: 'Root record for the Traffic Data resource (0x10002).',
	fields: {
		muDataVersion: u8(),
		muSizeInBytes: u32(),
		pvs: record('TrafficPvs'),
		hulls: recordList('TrafficHull'),
		flowTypes: recordList('TrafficFlowType', undefined, 'FlowTypesTab'),
		killZoneIds: primList(cgsId()),
		killZones: recordList('TrafficKillZone', killZoneLabel),
		killZoneRegions: recordList('TrafficKillZoneRegion'),
		vehicleTypes: recordList('TrafficVehicleTypeData', vehicleTypeLabel),
		vehicleTypesUpdate: recordList('TrafficVehicleTypeUpdateData'),
		vehicleAssets: recordList('TrafficVehicleAsset', vehicleAssetLabel),
		vehicleTraits: recordList('TrafficVehicleTraits'),
		trafficLights: record('TrafficLightCollection'),
		// paintColours is a primList of vec4 — wrapped as a custom renderer
		// so the PaintColoursTab swatch UI is used instead of the default
		// Vec4 grid table.
		paintColours: { kind: 'list', item: vec4(), addable: true, removable: true, customRenderer: 'PaintColoursTab' },
	},
	fieldMetadata: {
		muDataVersion: { description: 'Always 45 in retail.' },
		muSizeInBytes: { readOnly: true, hidden: true, description: 'Patched by the writer.' },
		killZoneIds: { description: 'Parallel array to killZones.' },
		vehicleTypesUpdate: { description: 'Parallel array to vehicleTypes.' },
	},
	propertyGroups: TRAFFIC_DATA_GROUPS,
};

// ---------------------------------------------------------------------------
// Registry + resource
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	TrafficData,
	TrafficPvs,
	PvsHullSet,
	TrafficHull,
	TrafficSection,
	TrafficLaneRung,
	TrafficNeighbour,
	TrafficSectionSpan,
	TrafficStaticVehicle,
	TrafficSectionFlow,
	TrafficLightController,
	TrafficJunctionLogicBox,
	TrafficStopLine,
	TrafficLightTrigger,
	TrafficLightTriggerStartData,
	TrafficFlowType,
	TrafficKillZone,
	TrafficKillZoneRegion,
	TrafficVehicleTypeData,
	TrafficVehicleTypeUpdateData,
	TrafficVehicleAsset,
	TrafficVehicleTraits,
	TrafficLightType,
	TrafficLightCollection,
};

export const trafficDataResourceSchema: ResourceSchema = {
	key: 'trafficData',
	name: 'Traffic Data',
	rootType: 'TrafficData',
	registry,
};

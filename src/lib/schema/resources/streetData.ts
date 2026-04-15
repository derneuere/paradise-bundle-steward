// Hand-written schema for ParsedStreetData.
//
// Mirrors the types in `src/lib/core/streetData.ts` (9 exported types: SpanBase,
// AIInfo, Street, Junction, Road, ScoreList, ChallengeData, ChallengeParScores,
// ParsedStreetData). Keep these in lockstep with the parser/writer — any field
// added to the parser needs a matching entry here or the walker will report it
// as an unknown field.
//
// Fields that are patched/zeroed by the writer (mpa*, miSpanCount, miExitCount)
// are marked readOnly + hidden so they don't clutter the inspector but still
// survive the walker.
//
// The writer is intentionally lossy on its first pass (drops the spans/exits
// tail for retail Burnout Paradise's buggy FixUp()). The round-trip test
// accepts this via stable-writer checking rather than byte-exact comparison
// against the original payload.

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
const i16 = (): FieldSchema => ({ kind: 'i16' });
const i32 = (): FieldSchema => ({ kind: 'i32' });
const vec3 = (): FieldSchema => ({ kind: 'vec3' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

// Signed int64. Decimal display (not hex) because BigIntField's hex path
// breaks on negative values and the parser reads these via BigInt.asIntN(64,...).
const i64 = (): FieldSchema => ({ kind: 'bigint', bytes: 8 });

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
	customRenderer?: string,
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: true,
	removable: true,
	customRenderer,
});

// ---------------------------------------------------------------------------
// Enum table — mirrors `ESpanType` in streetData.ts
// ---------------------------------------------------------------------------

const SPAN_TYPE_VALUES = [
	{ value: 0, label: 'Street' },
	{ value: 1, label: 'Junction' },
	{ value: 2, label: 'SpanTypeCount' },
];

// ---------------------------------------------------------------------------
// Tree-label helpers — wrapped in try/catch per migration-doc pitfall #7
// ---------------------------------------------------------------------------

function stripNul(s: string | undefined): string {
	return (s ?? '').replace(/\0+$/, '');
}

function streetLabel(item: unknown, index: number | null): string {
	const i = index ?? 0;
	try {
		const s = item as {
			superSpanBase?: { miRoadIndex?: number };
			mAiInfo?: { muMaxSpeedMPS?: number; muMinSpeedMPS?: number };
		};
		const road = s.superSpanBase?.miRoadIndex ?? '?';
		const max = s.mAiInfo?.muMaxSpeedMPS ?? 0;
		const min = s.mAiInfo?.muMinSpeedMPS ?? 0;
		return `#${i} · road ${road} · ${max}/${min} m/s`;
	} catch {
		return `#${i}`;
	}
}

function junctionLabel(item: unknown, index: number | null): string {
	const i = index ?? 0;
	try {
		const j = item as {
			macName?: string;
			superSpanBase?: { miRoadIndex?: number };
		};
		const name = stripNul(j.macName);
		const road = j.superSpanBase?.miRoadIndex ?? '?';
		if (name) return `#${i} · ${name} · road ${road}`;
		return `#${i} · road ${road}`;
	} catch {
		return `#${i}`;
	}
}

function roadLabel(item: unknown, index: number | null): string {
	const i = index ?? 0;
	try {
		const r = item as {
			macDebugName?: string;
			mReferencePosition?: { x: number; y: number; z: number };
		};
		const name = stripNul(r.macDebugName) || '(no name)';
		const p = r.mReferencePosition;
		const pos = p ? ` · (${p.x | 0}, ${p.y | 0}, ${p.z | 0})` : '';
		return `#${i} · ${name}${pos}`;
	} catch {
		return `#${i}`;
	}
}

function challengeLabel(item: unknown, index: number | null, ctx: SchemaContext): string {
	const i = index ?? 0;
	try {
		const c = item as {
			challengeData?: { mScoreList?: { maScores?: number[] } };
		};
		const scores = c.challengeData?.mScoreList?.maScores ?? [0, 0];
		const root = ctx.root as { roads?: { macDebugName?: string }[] } | undefined;
		const roadName = stripNul(root?.roads?.[i]?.macDebugName) || '(no name)';
		return `#${i} · ${roadName} · [${scores[0] ?? 0}, ${scores[1] ?? 0}]`;
	} catch {
		return `#${i}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas — ordered to match parser declaration order
// ---------------------------------------------------------------------------

const SpanBase: RecordSchema = {
	name: 'SpanBase',
	description: 'Common prefix for Street / Junction — road + span index plus span type.',
	fields: {
		miRoadIndex: i32(),
		miSpanIndex: i16(),
		padding: fixedList(u8(), 2),
		meSpanType: { kind: 'enum', storage: 'i32', values: SPAN_TYPE_VALUES },
	},
	fieldMetadata: {
		miRoadIndex: { description: 'Index into roads[].' },
		padding: { hidden: true },
	},
};

const AIInfo: RecordSchema = {
	name: 'AIInfo',
	description: 'AI cruising speed limits (m/s).',
	fields: {
		muMaxSpeedMPS: u8(),
		muMinSpeedMPS: u8(),
	},
	fieldMetadata: {
		muMaxSpeedMPS: { description: 'Maximum AI cruising speed (m/s).' },
		muMinSpeedMPS: { description: 'Minimum AI cruising speed (m/s).' },
	},
};

const Street: RecordSchema = {
	name: 'Street',
	description: 'One street span — a road-relative segment with AI speed info.',
	fields: {
		superSpanBase: record('SpanBase'),
		mAiInfo: record('AIInfo'),
		padding: fixedList(u8(), 2),
	},
	fieldMetadata: {
		padding: { hidden: true },
	},
	label: (value, index) => streetLabel(value, index),
};

const Junction: RecordSchema = {
	name: 'Junction',
	description: 'One junction — a named crossroads referenced by Roads.',
	fields: {
		superSpanBase: record('SpanBase'),
		mpaExits: i32(),
		miExitCount: i32(),
		macName: { kind: 'string' },
	},
	fieldMetadata: {
		mpaExits: {
			hidden: true,
			readOnly: true,
			description: 'Always zeroed by writer — retail FixUp() safety.',
		},
		miExitCount: {
			hidden: true,
			readOnly: true,
			description: 'Always zeroed by writer — retail FixUp() safety.',
		},
		macName: {
			description: '16-byte ASCII. Silently truncated on write if longer than 16 bytes.',
		},
	},
	label: (value, index) => junctionLabel(value, index),
};

const Road: RecordSchema = {
	name: 'Road',
	description: 'One road — reference position, 64-bit IDs, and challenge linkage.',
	fields: {
		mReferencePosition: vec3(),
		mpaSpans: i32(),
		mId: i64(),
		miRoadLimitId0: i64(),
		miRoadLimitId1: i64(),
		macDebugName: { kind: 'string' },
		mChallenge: i32(),
		miSpanCount: i32(),
		unknown: i32(),
		padding: fixedList(u8(), 4),
	},
	fieldMetadata: {
		mReferencePosition: {
			label: 'Reference position',
			description: 'World-space reference point for the road (Y-up display).',
			swapYZ: true,
		},
		mpaSpans: {
			hidden: true,
			readOnly: true,
			description: 'Always zeroed by writer.',
		},
		macDebugName: {
			description: '16-byte ASCII. Silently truncated on write if longer than 16 bytes.',
		},
		mChallenge: {
			description: 'Index into challenges[] (parallel array — length must match roads.length).',
		},
		miSpanCount: {
			hidden: true,
			readOnly: true,
			description: 'Always zeroed by writer.',
		},
		unknown: {
			description: 'Opaque — semantics TBD on the wiki. Always 1 in retail. Read/written as i32.',
		},
		padding: { hidden: true },
	},
	label: (value, index) => roadLabel(value, index),
};

const ScoreList: RecordSchema = {
	name: 'ScoreList',
	description: 'Two-element par-score array for a challenge.',
	fields: {
		maScores: fixedList(i32(), 2),
	},
	fieldMetadata: {
		maScores: { label: 'Scores' },
	},
};

const ChallengeData: RecordSchema = {
	name: 'ChallengeData',
	description: 'Per-challenge bookkeeping — dirty / valid bit arrays plus par scores.',
	fields: {
		mDirty: fixedList(u8(), 8),
		mValidScore: fixedList(u8(), 8),
		mScoreList: record('ScoreList'),
	},
	fieldMetadata: {
		mDirty: { description: '8-byte BitArray<2>.' },
		mValidScore: { description: '8-byte BitArray<2>.' },
	},
};

const ChallengeParScores: RecordSchema = {
	name: 'ChallengeParScores',
	description: 'One challenge par-score row — paired 1:1 with a Road.',
	fields: {
		challengeData: record('ChallengeData'),
		mRivals: fixedList(i64(), 2),
	},
	fieldMetadata: {
		mRivals: { description: 'Two 64-bit rival IDs (signed int64).' },
	},
	label: (value, index, ctx) => challengeLabel(value, index, ctx),
};

// Root-level tabs shown when the StreetData node itself is selected.
// Overview delegates to a custom extension. The four list tabs use the
// default form, which delegates to each list's customRenderer (the
// existing Streets/Junctions/Roads/Challenges table tabs).
// Listing the hidden mpa* fields under 'Header' keeps them grouped so the
// inspector doesn't auto-generate an empty "Other" tab for them. They still
// don't render because fieldMetadata marks them hidden.
const STREET_DATA_GROUPS: PropertyGroup[] = [
	{ title: 'Overview', component: 'StreetDataOverviewTab' },
	{
		title: 'Header',
		properties: ['miVersion', 'mpaStreets', 'mpaJunctions', 'mpaRoads', 'mpaChallengeParScores'],
	},
	{ title: 'Streets', properties: ['streets'] },
	{ title: 'Junctions', properties: ['junctions'] },
	{ title: 'Roads', properties: ['roads'] },
	{ title: 'Challenges', properties: ['challenges'] },
];

const StreetData: RecordSchema = {
	name: 'StreetData',
	description: 'Root record for the Street Data resource (0x10018).',
	fields: {
		miVersion: i32(),
		mpaStreets: i32(),
		mpaJunctions: i32(),
		mpaRoads: i32(),
		mpaChallengeParScores: i32(),
		streets: recordList('Street', 'StreetsTab'),
		junctions: recordList('Junction', 'JunctionsTab'),
		roads: recordList('Road', 'RoadsTab'),
		challenges: recordList('ChallengeParScores', 'ChallengesTab'),
	},
	fieldMetadata: {
		miVersion: { description: 'Always 6 in retail.' },
		mpaStreets: {
			hidden: true,
			readOnly: true,
			description: 'Layout offset — patched at write time.',
		},
		mpaJunctions: {
			hidden: true,
			readOnly: true,
			description: 'Layout offset — patched at write time.',
		},
		mpaRoads: {
			hidden: true,
			readOnly: true,
			description: 'Layout offset — patched at write time.',
		},
		mpaChallengeParScores: {
			hidden: true,
			readOnly: true,
			description: 'Layout offset — patched at write time.',
		},
		challenges: {
			description: 'Parallel array to roads — writer throws if lengths differ.',
		},
	},
	propertyGroups: STREET_DATA_GROUPS,
};

// ---------------------------------------------------------------------------
// Registry + resource
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	StreetData,
	SpanBase,
	AIInfo,
	Street,
	Junction,
	Road,
	ScoreList,
	ChallengeData,
	ChallengeParScores,
};

export const streetDataResourceSchema: ResourceSchema = {
	key: 'streetData',
	name: 'Street Data',
	rootType: 'StreetData',
	registry,
};

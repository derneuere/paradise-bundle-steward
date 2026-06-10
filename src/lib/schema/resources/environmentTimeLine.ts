// Hand-written schema for ParsedEnvironmentTimeLine (resource type 0x10013).
//
// Mirrors the types in `src/lib/core/environmentSettings.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: the timeline is a season's time-of-day schedule. Per location
// (every retail timeline has exactly one — "city"), an ascending list of
// (clock-time seconds, EnvironmentKeyframe id) pairs the game interpolates
// between as the in-game clock advances. The keyframe references are BND2
// imports resolved against the 0x10012 resources in the SAME bundle; retail
// timelines cover every keyframe in their bundle exactly once. Editing times
// or retargeting an entry is safe; adding/removing entries also resizes the
// resource's inline import table, which the bundle envelope's import metadata
// (importCount/importOffset) does not track yet — hence the warning below.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
	ValidationResult,
} from '../types';
import { formatTimeOfDay } from '@/lib/core/environmentSettings';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const u32 = (): FieldSchema => ({ kind: 'u32' });
const resourceId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function keyframeEntryLabel(item: unknown, index: number): string {
	try {
		if (!item || typeof item !== 'object') return `#${index}`;
		const e = item as { mfTimeOfDay?: number; mKeyframeId?: bigint };
		const time = e.mfTimeOfDay != null ? formatTimeOfDay(e.mfTimeOfDay) : '?';
		const id = e.mKeyframeId != null ? `0x${e.mKeyframeId.toString(16).toUpperCase()}` : '?';
		return `#${index} · ${time} · ${id}`;
	} catch {
		return `#${index}`;
	}
}

function locationLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const loc = value as { keyframes?: unknown[] };
		const n = loc.keyframes?.length ?? 0;
		return `#${index} · ${n} keyframe${n === 1 ? '' : 's'}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const EnvironmentTimeLineKeyframe: RecordSchema = {
	name: 'EnvironmentTimeLineKeyframe',
	description: 'One schedule entry: at this clock time, the environment look is exactly the referenced keyframe; between entries the game interpolates.',
	fields: {
		mfTimeOfDay: { kind: 'f32', min: 0, max: 86400 },
		mKeyframeId: resourceId(),
	},
	fieldMetadata: {
		mfTimeOfDay: {
			label: 'Time of day',
			description: 'Clock time in seconds since midnight (0–86400; 4:00 AM = 14400). Entries must stay in ascending order.',
		},
		mKeyframeId: {
			label: 'Keyframe',
			description: 'Resource id of the EnvironmentKeyframe (0x10012) in the same bundle (crc32 of the lowercased debug name), referenced via the inline import table — the on-disk pointer slot is 0 until load.',
		},
	},
	label: (value, index) => keyframeEntryLabel(value, index ?? 0),
};

const EnvironmentTimeLineLocation: RecordSchema = {
	name: 'EnvironmentTimeLineLocation',
	description: 'The schedule for one named location. Location names live in the EnvironmentDictionary (0x10014), matched by index — retail defines a single "city" location.',
	fields: {
		keyframes: {
			kind: 'list',
			item: { kind: 'record', type: 'EnvironmentTimeLineKeyframe' },
			addable: true,
			removable: true,
			makeEmpty: () => ({ mfTimeOfDay: 0, mKeyframeId: 0n }),
			itemLabel: (item, index) => keyframeEntryLabel(item, index),
		},
	},
	fieldMetadata: {
		keyframes: {
			label: 'Schedule',
			description: 'Ascending (time, keyframe) pairs. Retail timelines start at 00:00 and cover every keyframe in the bundle exactly once.',
			warning: 'Adding or removing entries resizes the resource\'s inline import table; the bundle envelope\'s import metadata is not recomputed yet — prefer editing times / retargeting existing entries.',
		},
	},
	label: (value, index) => locationLabel(value, index ?? 0),
	validate: (value): ValidationResult[] => {
		const keyframes = (value as { keyframes?: { mfTimeOfDay?: number }[] }).keyframes ?? [];
		const results: ValidationResult[] = [];
		for (let i = 1; i < keyframes.length; i++) {
			const prev = keyframes[i - 1]?.mfTimeOfDay ?? 0;
			const cur = keyframes[i]?.mfTimeOfDay ?? 0;
			if (cur <= prev) {
				results.push({
					severity: 'warning',
					message: `Schedule times must ascend: entry #${i} (${formatTimeOfDay(cur)}) is not after #${i - 1} (${formatTimeOfDay(prev)})`,
					field: 'keyframes',
				});
			}
		}
		return results;
	},
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedEnvironmentTimeLine: RecordSchema = {
	name: 'ParsedEnvironmentTimeLine',
	description: 'Root record for the Environment Timeline resource (0x10013): the per-location time-of-day schedule of EnvironmentKeyframes for one season. One timeline per season bundle.',
	fields: {
		muVersion: u32(),
		locations: {
			kind: 'list',
			item: { kind: 'record', type: 'EnvironmentTimeLineLocation' },
			// Every retail timeline has exactly one location, and the on-disk
			// layout for >1 is unverified (the parser would reject a multi-
			// location resource that disagrees with its canonical reading) —
			// so the list shape is locked.
			addable: false,
			removable: false,
			itemLabel: (item, index) => locationLabel(item, index),
		},
	},
	fieldMetadata: {
		muVersion: {
			label: 'Version',
			description: 'Format version — 1 in every retail resource; the writer rejects anything else.',
			readOnly: true,
		},
		locations: {
			label: 'Locations',
			description: 'One schedule per location, matched by index against the EnvironmentDictionary\'s location list ("city" in retail).',
		},
	},
	propertyGroups: [
		{ title: 'Schedule', properties: ['locations'] },
		{ title: 'Format', properties: ['muVersion'] },
	],
};

const registry: SchemaRegistry = {
	ParsedEnvironmentTimeLine,
	EnvironmentTimeLineLocation,
	EnvironmentTimeLineKeyframe,
};

export const environmentTimeLineResourceSchema: ResourceSchema = {
	key: 'environmentTimeLine',
	name: 'Environment Timeline',
	rootType: 'ParsedEnvironmentTimeLine',
	registry,
};

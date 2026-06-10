// Hand-written schema for ParsedNicotine (resource type 0xA024).
//
// Mirrors the types in `src/lib/core/nicotine.ts`. Keep these in lockstep
// with the parser/writer — any field added there needs a matching entry
// here, or the schema walker reports it as drift.
//
// Domain: a Nicotine map is the game's sound-mixer graph — one map for
// stereo, one for 5.1 surround. Nearly every word is an undocumented bit
// field, so most fields are plain u32s with the packed-count words locked
// read-only: their count bytes size sibling arrays on disk, and the writer
// throws if they disagree. The one field PROVEN meaningful is the master
// channel's mixData — it is the only substantive difference between the
// retail stereo and surround maps, and its i16 lanes move in clean steps of
// hundredths of a dB (0xD8F0 = -10000 = -100.00 dB floor; deltas -100..-1200
// = -1..-12 dB).

import type { FieldSchema, RecordSchema, ResourceSchema, SchemaRegistry } from '../types';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const u32 = (): FieldSchema => ({ kind: 'u32' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

const fixedRecordList = (type: string): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: false,
	removable: false,
});

// Word counts are locked by packed count bytes inside sibling bit fields, so
// the lists are fixed-size; the u32 items themselves stay editable.
const fixedWordList = (): FieldSchema => ({
	kind: 'list',
	item: u32(),
	addable: false,
	removable: false,
});

export const hex8 = (v: unknown): string =>
	typeof v === 'number' ? `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}` : '?';

function idLabel(field: string) {
	return (value: unknown, index: number | null): string => {
		const v = value as Record<string, unknown> | null;
		return `#${index ?? 0} · ${hex8(v?.[field])}`;
	};
}

function stateLabel(value: unknown, index: number | null): string {
	try {
		const s = value as { stateIndex?: number; masterMix?: { channels?: unknown[] } | null; subMix?: { channels?: unknown[] } | null };
		const parts: string[] = [];
		if (s.masterMix?.channels) parts.push(`${s.masterMix.channels.length} master`);
		if (s.subMix?.channels) parts.push(`${s.subMix.channels.length} submix`);
		const idx = typeof s.stateIndex === 'number' ? `0x${s.stateIndex.toString(16).toUpperCase()}` : `#${index ?? 0}`;
		return parts.length > 0 ? `${idx} · ${parts.join(' + ')}` : idx;
	} catch {
		return `#${index ?? 0}`;
	}
}

const PACKED_COUNT_WARNING = 'Bits 16-23 size the sibling word array on disk — the writer rejects any mismatch, so this word is locked.';

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const NicotineMixControl: RecordSchema = {
	name: 'NicotineMixControl',
	description: 'stMixCtlParams — one mix control input. Both words are undocumented bit fields.',
	fields: {
		nInputId: u32(),
		nUScaleCntSwing: u32(),
		extraData: fixedWordList(),
	},
	fieldMetadata: {
		nInputId: { label: 'Input ID', description: 'Packed control-input id (undocumented bit field).' },
		nUScaleCntSwing: { label: 'Scale/count/swing', description: `Packed bit field. ${PACKED_COUNT_WARNING}`, readOnly: true },
		extraData: { label: 'Extra words', description: 'Undocumented trailing words; count fixed by the packed byte in nUScaleCntSwing.' },
	},
	label: idLabel('nInputId'),
};

const Nicotine3DStateParams: RecordSchema = {
	name: 'Nicotine3DStateParams',
	description: 'st3DStateParams — one 3D positioning state: doppler curve plus four packed min/max quantity pairs.',
	fields: {
		n3DStateInfoId: u32(),
		nCurveIdDoppler: u32(),
		nQ0MinMax: u32(),
		nQ1MinMax: u32(),
		nQ2MinMax: u32(),
		nQ3MinMax: u32(),
	},
	fieldMetadata: {
		n3DStateInfoId: { label: '3D state info ID' },
		nCurveIdDoppler: { label: 'Doppler curve ID' },
		nQ0MinMax: { label: 'Q0 min/max', description: 'Packed min/max pair (undocumented units).' },
		nQ1MinMax: { label: 'Q1 min/max', description: 'Packed min/max pair (undocumented units).' },
		nQ2MinMax: { label: 'Q2 min/max', description: 'Packed min/max pair (undocumented units).' },
		nQ3MinMax: { label: 'Q3 min/max', description: 'Packed min/max pair (undocumented units).' },
	},
	label: idLabel('n3DStateInfoId'),
};

const Nicotine3DMixControl: RecordSchema = {
	name: 'Nicotine3DMixControl',
	description: 'st3DMixCtlParams — one 3D mix control input owning one or more state-param blocks.',
	fields: {
		nInputId: u32(),
		stateParams: fixedRecordList('Nicotine3DStateParams'),
	},
	fieldMetadata: {
		nInputId: { label: 'Input ID', description: 'Packed bit field. The low nibble of the top byte sizes stateParams (min 1) — the writer rejects any mismatch, so this word is locked.', readOnly: true },
		stateParams: { label: 'State params', description: 'One or more 3D positioning states; count fixed by the packed nibble in nInputId.' },
	},
	label: idLabel('nInputId'),
};

const NicotineSubMixChannel: RecordSchema = {
	name: 'NicotineSubMixChannel',
	description: 'stSubMixChParams — one submix channel (MIXCHID top byte 0xD0 in retail).',
	fields: {
		mixChId: u32(),
		upperLowerSwing: u32(),
		procOffsets: fixedWordList(),
	},
	fieldMetadata: {
		mixChId: { label: 'Mix channel ID', description: `Packed channel id. ${PACKED_COUNT_WARNING}`, readOnly: true },
		upperLowerSwing: { label: 'Upper/lower swing', description: 'Packed bit field (undocumented units; values like 0xFE60 suggest i16 hundredths-of-a-dB lanes).' },
		procOffsets: { label: 'Submix proc words', description: 'stSubMixStateParams nOffsetSubMixProc words (undocumented).' },
	},
	label: idLabel('mixChId'),
};

const NicotineMasterMixChannel: RecordSchema = {
	name: 'NicotineMasterMixChannel',
	description: 'stMasterMixChParams — one master mix channel. SnapshotData (0xA029) channels in the same bundle reference these by their exact mixChId word.',
	fields: {
		mixChId: u32(),
		mixData: u32(),
		sfxObjId: u32(),
		extraData: fixedWordList(),
	},
	fieldMetadata: {
		mixChId: { label: 'Mix channel ID', description: `Packed channel id (top byte 0xC0-0xC2 in retail). The companion SnapshotData references master channels by this exact word — changing it orphans snapshot data. ${PACKED_COUNT_WARNING}`, readOnly: true },
		mixData: { label: 'Mix data (attenuation)', description: 'Two i16 lanes in hundredths of a dB: low lane is the -10000 (-100.00 dB) floor in every retail channel; the high lane carries the channel attenuation (0 = unity; retail surround uses -100..-1200 = -1..-12 dB). The ONLY field that differs between the retail stereo and surround maps.' },
		sfxObjId: { label: 'SFX object ID', description: 'Packed bit field (undocumented).' },
		extraData: { label: 'Extra words', description: 'Undocumented trailing words; count fixed by the packed byte in mixChId.' },
	},
	label: idLabel('mixChId'),
};

const NicotinePresetEntry: RecordSchema = {
	name: 'NicotinePresetEntry',
	description: 'One preset entry. The array has no own header — the runtime sizes it from the master section\'s channel count, one entry per master channel in order.',
	fields: {
		header: u32(),
		extraData: fixedWordList(),
	},
	fieldMetadata: {
		header: { label: 'Header word', description: 'Packed bit field (top byte 0xE0-0xE2 in retail). Bits 0-7 size extraData on disk — the writer rejects any mismatch, so this word is locked.', readOnly: true },
		extraData: { label: 'Preset words', description: 'Undocumented preset payload; count fixed by the packed byte in the header word.' },
	},
	label: idLabel('header'),
};

const NicotineMixEvent: RecordSchema = {
	name: 'NicotineMixEvent',
	description: 'stMixEvtParams — one event control binding a trigger to mixer behaviour.',
	fields: {
		nEvtCtlId: u32(),
		nUScaleCntSwing: u32(),
		nTriggerId: u32(),
		nParam00: u32(),
		nParam01: u32(),
		nParam02: u32(),
		extraData: fixedWordList(),
	},
	fieldMetadata: {
		nEvtCtlId: { label: 'Event control ID' },
		nUScaleCntSwing: { label: 'Scale/count/swing', description: `Packed bit field (values like 0xD8F0 = -10000 suggest hundredths-of-a-dB lanes). ${PACKED_COUNT_WARNING}`, readOnly: true },
		nTriggerId: { label: 'Trigger ID' },
		nParam00: { label: 'Param 0' },
		nParam01: { label: 'Param 1' },
		nParam02: { label: 'Param 2' },
		extraData: { label: 'Extra words', description: 'Undocumented trailing words; count fixed by the packed byte in nUScaleCntSwing.' },
	},
	label: idLabel('nEvtCtlId'),
};

const NicotineMixCtlSection: RecordSchema = {
	name: 'NicotineMixCtlSection',
	description: 'stMixCtlHdr + its mix control array.',
	fields: {
		numNewMixDataProcs: u32(),
		numMainMixDataProcs: u32(),
		numMainMixCtlOut: u32(),
		controls: fixedRecordList('NicotineMixControl'),
	},
	fieldMetadata: {
		numNewMixDataProcs: { label: 'New mix data procs', description: 'Equals the control count in every retail section; preserved verbatim, not recomputed.', readOnly: true },
		numMainMixDataProcs: { label: 'Main mix data procs', description: 'Always 0 in retail.', readOnly: true },
		numMainMixCtlOut: { label: 'Main mix controls out', description: 'Always 0 in retail.', readOnly: true },
		controls: { label: 'Mix controls' },
	},
};

const Nicotine3DSection: RecordSchema = {
	name: 'Nicotine3DSection',
	description: 'st3DMixCtlHdr + its 3D mix control array.',
	fields: {
		numMainMap3DMixCtls: u32(),
		controls: fixedRecordList('Nicotine3DMixControl'),
		_reserved02: u32(),
		_reserved03: u32(),
	},
	fieldMetadata: {
		numMainMap3DMixCtls: { label: 'Main map 3D controls', description: 'Always 0 in retail.', readOnly: true },
		controls: { label: '3D mix controls' },
		_reserved02: { label: 'Reserved 02', description: 'Always 0 in retail; preserved verbatim.', hidden: true },
		_reserved03: { label: 'Reserved 03', description: 'Always 0 in retail; preserved verbatim.', hidden: true },
	},
};

const NicotineSubMixSection: RecordSchema = {
	name: 'NicotineSubMixSection',
	description: 'stMixChHdr + the submix channel array.',
	fields: {
		numUniqueSfxObjs: u32(),
		numMainIn: u32(),
		numSecIn: u32(),
		channels: fixedRecordList('NicotineSubMixChannel'),
	},
	fieldMetadata: {
		numUniqueSfxObjs: { label: 'Unique SFX objects', readOnly: true },
		numMainIn: { label: 'Main inputs', readOnly: true },
		numSecIn: { label: 'Secondary inputs', readOnly: true },
		channels: { label: 'Submix channels' },
	},
};

const NicotineMasterMixSection: RecordSchema = {
	name: 'NicotineMasterMixSection',
	description: 'stMixChHdr + the master mix channel array — the channels SnapshotData snapshots drive.',
	fields: {
		numUniqueSfxObjs: u32(),
		numMainIn: u32(),
		numSecIn: u32(),
		channels: fixedRecordList('NicotineMasterMixChannel'),
	},
	fieldMetadata: {
		numUniqueSfxObjs: { label: 'Unique SFX objects', readOnly: true },
		numMainIn: { label: 'Main inputs', readOnly: true },
		numSecIn: { label: 'Secondary inputs', readOnly: true },
		channels: { label: 'Master mix channels' },
	},
};

const NicotineEventSection: RecordSchema = {
	name: 'NicotineEventSection',
	description: 'stMixEventHdr + the event control array.',
	fields: {
		events: fixedRecordList('NicotineMixEvent'),
		_reserved01: u32(),
		_reserved02: u32(),
		_reserved03: u32(),
	},
	fieldMetadata: {
		events: { label: 'Event controls' },
		_reserved01: { label: 'Reserved 01', description: 'Mirrors the event count in every retail section; preserved verbatim.', hidden: true },
		_reserved02: { label: 'Reserved 02', description: '0x08E4EF64 in every retail section — stale pointer garbage, preserved verbatim.', hidden: true },
		_reserved03: { label: 'Reserved 03', description: 'Stale heap garbage (varies even between the otherwise-identical stereo and surround maps); preserved verbatim.', hidden: true },
	},
};

const NicotineState: RecordSchema = {
	name: 'NicotineState',
	description: 'One mixer state (stMixMapStateHdr + its sections). The engine selects states by stateIndex; absent sections are null.',
	fields: {
		stateIndex: u32(),
		mixControls: record('NicotineMixCtlSection'),
		threeDControls: record('Nicotine3DSection'),
		subMix: record('NicotineSubMixSection'),
		masterMix: record('NicotineMasterMixSection'),
		presets: fixedRecordList('NicotinePresetEntry'),
		events: record('NicotineEventSection'),
	},
	fieldMetadata: {
		stateIndex: { label: 'State index', description: 'Engine lookup id — 0x1F0000 + position in retail. The game asks for states by this value, so renumbering breaks lookups.', readOnly: true },
		mixControls: { label: 'Mix controls', description: 'stMixCtlHdr section; null when the state has none.' },
		threeDControls: { label: '3D mix controls', description: 'st3DMixCtlHdr section; null when the state has none.' },
		subMix: { label: 'Submix', description: 'Submix channel section; present in every retail state.' },
		masterMix: { label: 'Master mix', description: 'Master mix channel section; null when the state has none.' },
		presets: { label: 'Presets', description: 'One entry per master mix channel, in channel order — the array is sized by the master section\'s channel count on disk.' },
		events: { label: 'Events', description: 'Event control section; null when the state has none.' },
	},
	propertyGroups: [
		{ title: 'State', properties: ['stateIndex'] },
		{ title: 'Channels', properties: ['subMix', 'masterMix', 'presets'] },
		{ title: 'Controls', properties: ['mixControls', 'threeDControls', 'events'] },
	],
	label: stateLabel,
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedNicotine: RecordSchema = {
	name: 'ParsedNicotine',
	description: 'Root record for the Nicotine map resource (0xA024): the sound-mixer state graph for one output format (stereo or 5.1 surround). The companion SnapshotData resource references the master mix channels here.',
	fields: {
		mixMapId: u32(),
		states: fixedRecordList('NicotineState'),
		_stateTableSentinelSlots: u32(),
	},
	fieldMetadata: {
		mixMapId: { label: 'Mix map ID', description: 'Always 0 in retail.', readOnly: true },
		states: { label: 'Mixer states', description: 'Engine-selectable mix states, table order. Retail maps carry 9 (indices 0x1F0000-0x1F0008).' },
		_stateTableSentinelSlots: { label: 'State table sentinels', description: 'Trailing -1 slots after the real state-table entries (4 in retail; undocumented on the wiki). Preserved verbatim.', hidden: true },
	},
	propertyGroups: [
		{ title: 'Map', properties: ['mixMapId', 'states'] },
	],
};

const registry: SchemaRegistry = {
	ParsedNicotine,
	NicotineState,
	NicotineMixCtlSection,
	NicotineMixControl,
	Nicotine3DSection,
	Nicotine3DMixControl,
	Nicotine3DStateParams,
	NicotineSubMixSection,
	NicotineSubMixChannel,
	NicotineMasterMixSection,
	NicotineMasterMixChannel,
	NicotinePresetEntry,
	NicotineEventSection,
	NicotineMixEvent,
};

export const nicotineResourceSchema: ResourceSchema = {
	key: 'nicotine',
	name: 'Nicotine Map',
	rootType: 'ParsedNicotine',
	registry,
};

// Hand-written schema for ParsedVFXPropCollection (resource type 0x1001B).
//
// Mirrors the types in `src/lib/core/vfxPropCollection.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: maps every breakable prop (by GameDB id) to its crash particle
// effects. The ownership chain is prop → states (intact/wrecked) → one
// material each (+ optional coronas) → locators. Cross-record references are
// element indices into the sibling tables, grouped into contiguous runs
// (index + count); 0xFFFFFFFF means "no entries". Steward edits values in
// place but has no regroup op, so the run fields are read-only and the lists
// are fixed — adding an entry would require re-packing every downstream run.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';
import { VFX_MATERIAL_TYPES, VFX_CORONA_TYPE_COUNT, VFX_NULL_INDEX } from '@/lib/core/vfxPropCollection';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const f32 = (): FieldSchema => ({ kind: 'f32' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const u8 = (): FieldSchema => ({ kind: 'u8' });
const bool = (): FieldSchema => ({ kind: 'bool' });
const str = (): FieldSchema => ({ kind: 'string' });
const vec3 = (): FieldSchema => ({ kind: 'vec3' });
const matrix44 = (): FieldSchema => ({ kind: 'matrix44' });
const gameDbId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

const ref = (listPath: string[], itemType: string, displayName: string, nullValue?: number): FieldSchema => ({
	kind: 'ref',
	storage: 'u32',
	target: { listPath, itemType, displayName },
	nullValue,
});

const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	addable: false,
	removable: false,
	minLength: length,
	maxLength: length,
});

const fixedRecordList = (
	type: string,
	itemLabel: (item: unknown, index: number) => string,
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: false,
	removable: false,
	itemLabel,
});

const materialTypeEnum = (): FieldSchema => ({
	kind: 'enum',
	storage: 'u32',
	values: VFX_MATERIAL_TYPES.map((name, value) => ({ value, label: name })),
});

const coronaTypeEnum = (): FieldSchema => ({
	kind: 'enum',
	storage: 'u32',
	values: Array.from({ length: VFX_CORONA_TYPE_COUNT }, (_, value) => ({
		value,
		label: `Texture ${value}`,
	})),
});

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

const runLabel = (first: unknown, count: unknown): string => {
	const f = typeof first === 'number' ? first : -1;
	const c = typeof count === 'number' ? count : 0;
	if (c === 0 || f === VFX_NULL_INDEX) return 'none';
	return c === 1 ? `#${f}` : `#${f}–${f + c - 1}`;
};

function propLabel(item: unknown, index: number): string {
	try {
		const p = item as { mPropID?: bigint; mpPropStates?: number; muNumPropStates?: number };
		const id = typeof p?.mPropID === 'bigint' ? `0x${p.mPropID.toString(16).toUpperCase()}` : '?';
		return `#${index} · ${id} · states ${runLabel(p?.mpPropStates, p?.muNumPropStates)}`;
	} catch {
		return `#${index}`;
	}
}

function stateLabel(item: unknown, index: number): string {
	try {
		const s = item as { mpVFXMaterial?: number; mpCoronaType?: number; muNumCoronas?: number };
		const coronas = (s?.muNumCoronas ?? 0) > 0 ? ` · coronas ${runLabel(s?.mpCoronaType, s?.muNumCoronas)}` : '';
		return `#${index} · material #${s?.mpVFXMaterial ?? '?'}${coronas}`;
	} catch {
		return `#${index}`;
	}
}

function materialLabel(item: unknown, index: number): string {
	try {
		const m = item as { mType?: number; mpLocators?: number; muNumLocators?: number };
		const type = m?.mType != null && m.mType < VFX_MATERIAL_TYPES.length ? VFX_MATERIAL_TYPES[m.mType] : `type ${m?.mType}`;
		return `#${index} · ${type} · locators ${runLabel(m?.mpLocators, m?.muNumLocators)}`;
	} catch {
		return `#${index}`;
	}
}

function locatorLabel(item: unknown, index: number): string {
	try {
		const l = item as { mPosition?: { x?: number; y?: number; z?: number }; macDebugLefName?: string };
		// The debug name is a left-truncated .lef path — the file stem before
		// ".lef" is the recognisable part.
		const stem = l?.macDebugLefName?.match(/([^/]*)\.lef/)?.[1] ?? l?.macDebugLefName ?? '?';
		const p = l?.mPosition;
		const pos = p ? `(${p.x?.toFixed(2)}, ${p.y?.toFixed(2)}, ${p.z?.toFixed(2)})` : '';
		return `#${index} · ${stem} · ${pos}`;
	} catch {
		return `#${index}`;
	}
}

function coronaLabel(item: unknown, index: number): string {
	try {
		const c = item as { mpTypeData?: number; mrTimeOffset?: number };
		const phase = c?.mrTimeOffset ? ` · phase ${c.mrTimeOffset}` : '';
		return `#${index} · preset #${c?.mpTypeData ?? '?'}${phase}`;
	} catch {
		return `#${index}`;
	}
}

function coronaTypeDataLabel(item: unknown, index: number): string {
	try {
		const d = item as { mnID?: number; mType?: number; mrTimeOn?: number; mrTimeOff?: number };
		const flash = d?.mrTimeOn || d?.mrTimeOff ? `${d.mrTimeOn}s/${d.mrTimeOff}s` : 'always on';
		return `#${index} · GameDB ${d?.mnID ?? '?'} · tex ${d?.mType ?? '?'} · ${flash}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const VFXProp: RecordSchema = {
	name: 'VFXProp',
	description: 'One breakable prop, keyed by GameDB id, owning a contiguous run of states (1 = intact only, 2 = intact + wrecked in retail).',
	fields: {
		mPropID: gameDbId(),
		mpPropStates: ref(['propStates'], 'VFXPropState', 'Prop state'),
		muNumPropStates: u32(),
	},
	fieldMetadata: {
		mPropID: {
			label: 'Prop GameDB ID',
			description: 'GameDB id of the prop this effect set belongs to (u64; high half 0 in retail).',
		},
		mpPropStates: {
			label: 'First state',
			description: 'Element index of this prop\'s first state in the state table. Runs are contiguous and ordered — read-only until steward grows a regroup op.',
			readOnly: true,
		},
		muNumPropStates: {
			label: 'State count',
			description: 'Number of states in the run.',
			readOnly: true,
		},
	},
	label: (value, index) => propLabel(value, index ?? 0),
};

const VFXPropState: RecordSchema = {
	name: 'VFXPropState',
	description: 'One state of a prop (intact / wrecked). Owns exactly one material in retail, plus an optional run of coronas.',
	fields: {
		mpVFXMaterial: ref(['materials'], 'VFXMaterial', 'VFX material'),
		muNumVFXMaterials: u32(),
		mpCoronaType: ref(['coronas'], 'VFXCoronaType', 'Corona', VFX_NULL_INDEX),
		muNumCoronas: u32(),
	},
	fieldMetadata: {
		mpVFXMaterial: {
			label: 'First material',
			description: 'Element index into the material table. Every retail state owns exactly one.',
			readOnly: true,
		},
		muNumVFXMaterials: {
			label: 'Material count',
			readOnly: true,
		},
		mpCoronaType: {
			label: 'First corona',
			description: 'Element index into the corona table, or 0xFFFFFFFF when the state has no glows (317 of 324 retail states).',
			readOnly: true,
		},
		muNumCoronas: {
			label: 'Corona count',
			readOnly: true,
		},
	},
	label: (value, index) => stateLabel(value, index ?? 0),
};

const VFXMaterial: RecordSchema = {
	name: 'VFXMaterial',
	description: 'Effect-set selector for a prop state — the type picks which debris/dust particles play on impact (metal sparks, wood splinters, water spray, …).',
	fields: {
		mType: materialTypeEnum(),
		muNumLocators: u32(),
		mpLocators: ref(['locators'], 'VFXLocator', 'Locator', VFX_NULL_INDEX),
	},
	fieldMetadata: {
		mType: {
			label: 'Material type',
			description: 'eVFXMaterialType. Retail uses None (×270), Metal (×31), Wood (×13), Foliage/Plastic (×3), Water/Billboard (×2); the rest are valid but unused.',
		},
		muNumLocators: {
			label: 'Locator count',
			readOnly: true,
		},
		mpLocators: {
			label: 'First locator',
			description: 'Element index into the locator table, or 0xFFFFFFFF when the material emits from the prop origin only.',
			readOnly: true,
		},
	},
	label: (value, index) => materialLabel(value, index ?? 0),
};

const VFXLocator: RecordSchema = {
	name: 'VFXLocator',
	description: 'A prop-local point where the material\'s effect is emitted (e.g. each lamp head on a twin street light).',
	fields: {
		mPosition: vec3(),
		mHashedName: u32(),
		macDebugLefName: str(),
		_posW: f32(),
	},
	fieldMetadata: {
		mPosition: {
			label: 'Position',
			description: 'Emit offset in metres, relative to the prop\'s origin (NOT world space).',
		},
		mHashedName: {
			label: 'Name hash',
			description: 'Hash of the authoring effect-file reference. Not derivable from the truncated debug name — change only if you know the matching full path hash.',
		},
		macDebugLefName: {
			label: 'Debug .lef name',
			description: 'Authoring-time effect file path, LEFT-truncated to fit char[60] (max 59 bytes — the writer rejects longer). Purely diagnostic at runtime.',
		},
		_posW: {
			label: 'Position W lane',
			description: 'Unused 4th vpu lane of the position (0 in retail). Preserved verbatim.',
			hidden: true,
		},
	},
	label: (value, index) => locatorLabel(value, index ?? 0),
};

const VFXCoronaType: RecordSchema = {
	name: 'VFXCoronaType',
	description: 'One placed light glow (traffic-light lens, lamp head). The transform places it on the prop; the preset supplies texture and flash timing.',
	fields: {
		mTransform: matrix44(),
		mpTypeData: ref(['coronaTypeData'], 'VFXCoronaTypeData', 'Corona preset'),
		mrTimeOffset: f32(),
		_pad48: fixedList(u32(), 2),
	},
	fieldMetadata: {
		mTransform: {
			label: 'Transform',
			description: 'Matrix44Affine, prop-local; translation lives in row 3 (elements 12–14). Retail uses mirrored ±1 diagonals to flip paired lenses.',
		},
		mpTypeData: {
			label: 'Preset',
			description: 'Element index into the shared corona preset table.',
		},
		mrTimeOffset: {
			label: 'Phase offset',
			description: 'Offset into the flash cycle in master-time cycles — retail alternates paired flashers with 0 / 0.5.',
		},
		_pad48: {
			label: 'pad +0x48',
			description: 'Record pad (0 in retail); preserved verbatim.',
			hidden: true,
		},
	},
	label: (value, index) => coronaLabel(value, index ?? 0),
};

const VFXCoronaTypeData: RecordSchema = {
	name: 'VFXCoronaTypeData',
	description: 'Shared corona preset — texture slot, flash timing and size range — referenced by GameDB id from gameplay and by element index from placed coronas.',
	fields: {
		mnID: u32(),
		mType: coronaTypeEnum(),
		mrTimeOn: f32(),
		mrTimeOff: f32(),
		mrSizeMin: f32(),
		mrSizeMax: f32(),
		mrMasterTime: f32(),
		mbSynchronised: bool(),
		_pad1D: fixedList(u8(), 3),
	},
	fieldMetadata: {
		mnID: {
			label: 'GameDB ID',
			description: 'GameDB id of this preset.',
		},
		mType: {
			label: 'Corona texture',
			description: 'eVFXCoronaType — which of the 17 corona texture slots to draw.',
		},
		mrTimeOn: {
			label: 'Time on',
			description: 'Seconds lit per flash cycle. 0 with Time off 0 = always on.',
		},
		mrTimeOff: {
			label: 'Time off',
			description: 'Seconds dark per flash cycle.',
		},
		mrSizeMin: {
			label: 'Size min',
			description: 'Smallest rendered glow size in metres.',
		},
		mrSizeMax: {
			label: 'Size max',
			description: 'Largest rendered glow size in metres.',
		},
		mrMasterTime: {
			label: 'Master time',
			description: 'Master cycle length in seconds (0 in every retail preset).',
		},
		mbSynchronised: {
			label: 'Synchronised',
			description: 'Whether all instances of this preset flash in lockstep (false in every retail preset).',
		},
		_pad1D: {
			label: 'pad +0x1D',
			description: 'Record pad (0 in retail); preserved verbatim.',
			hidden: true,
		},
	},
	label: (value, index) => coronaTypeDataLabel(value, index ?? 0),
};

const ParsedVFXPropCollection: RecordSchema = {
	name: 'ParsedVFXPropCollection',
	description: 'Root record for the VFXPropCollection resource (0x1001B): the game-wide prop → crash-effect mapping. One retail instance exists (vfx_props_collection in PARTICLES.BUNDLE).',
	fields: {
		muVersion: u32(),
		props: fixedRecordList('VFXProp', propLabel),
		propStates: fixedRecordList('VFXPropState', stateLabel),
		materials: fixedRecordList('VFXMaterial', materialLabel),
		locators: fixedRecordList('VFXLocator', locatorLabel),
		coronas: fixedRecordList('VFXCoronaType', coronaLabel),
		coronaTypeData: fixedRecordList('VFXCoronaTypeData', coronaTypeDataLabel),
		_headerPad: rawBytes(),
	},
	fieldMetadata: {
		muVersion: {
			label: 'Version',
			description: 'Format version — always 3 in retail; the parser rejects anything else.',
			readOnly: true,
		},
		props: {
			label: 'Props',
			description: 'Every breakable prop with effects, keyed by GameDB id. Order is load-bearing: the state table is grouped by prop.',
		},
		propStates: {
			label: 'Prop states',
			description: 'Intact/wrecked states, grouped contiguously by owning prop.',
		},
		materials: {
			label: 'Materials',
			description: 'Effect-set selectors, one per state, in state order.',
		},
		locators: {
			label: 'Locators',
			description: 'Prop-local emit points, grouped contiguously by owning material.',
		},
		coronas: {
			label: 'Coronas',
			description: 'Placed light glows, grouped contiguously by owning state.',
		},
		coronaTypeData: {
			label: 'Corona presets',
			description: 'Shared flash-timing/size presets the placed coronas reference.',
		},
		_headerPad: {
			label: 'Header pad',
			description: 'Pad 0x34–0x40 after the version field (zeros in retail). Re-emitted verbatim.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Props', properties: ['props', 'propStates'] },
		{ title: 'Effects', properties: ['materials', 'locators'] },
		{ title: 'Coronas', properties: ['coronas', 'coronaTypeData'] },
		{ title: 'Format', properties: ['muVersion'] },
	],
};

// ---------------------------------------------------------------------------
// Registry export
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	ParsedVFXPropCollection,
	VFXProp,
	VFXPropState,
	VFXMaterial,
	VFXLocator,
	VFXCoronaType,
	VFXCoronaTypeData,
};

export const vfxPropCollectionResourceSchema: ResourceSchema = {
	key: 'vfxPropCollection',
	name: 'VFX Prop Collection',
	rootType: 'ParsedVFXPropCollection',
	registry,
};

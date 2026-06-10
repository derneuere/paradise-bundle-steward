// Hand-written schema for ParsedAemsBank (resource type 0xA022).
//
// Mirrors the types in `src/lib/core/aemsBank.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here, or the schema walker reports it as drift.
//
// Domain: an AEMS bank is a COMPILED audio artifact — its module region is
// x86 glue code + static data and its SFX region is an SND10 sample bank, so
// both stay opaque verbatim blobs here. The editable surface is the tail:
// the load-time fixup tables and the CSIS interface references that bind the
// bank to a Csis resource's class by CrcAndKey. Editing a reference without
// the matching Csis edit (or vice versa) silently breaks the audio link.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';
import { AEMS_PLATFORMS, AEMS_TARGET_TYPES, AEMS_INTERFACE_TYPES } from '@/lib/core/aemsBank';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const str = (): FieldSchema => ({ kind: 'string' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

const enumOf = (storage: 'u8', values: readonly { value: number; label: string }[]): FieldSchema => ({
	kind: 'enum',
	storage,
	values: values.map((v) => ({ value: v.value, label: v.label })),
});

const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	addable: false,
	removable: false,
	minLength: length,
	maxLength: length,
});

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function refLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const r = value as { idName?: string; idCrc?: number; idKey?: number };
		const name = r.idName || '(unnamed)';
		const crc = r.idCrc != null ? r.idCrc.toString(16).toUpperCase() : '?';
		const key = r.idKey != null ? r.idKey.toString(16).toUpperCase() : '?';
		return `${name} · 0x${crc}/0x${key}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const AemsInterfaceReference: RecordSchema = {
	name: 'AemsInterfaceReference',
	description: 'One CSIS subscription: names a Csis class and stores its CrcAndKey (the Csis resource\'s system crc + the class entry\'s crc). The loader patches the Csis::ClassHandle at handleOffset once the class resolves.',
	fields: {
		handleOffset: u32(),
		type: enumOf('u8', AEMS_INTERFACE_TYPES),
		idCrc: u16(),
		idKey: u16(),
		idName: str(),
		_pad: fixedList(u8(), 3),
	},
	fieldMetadata: {
		handleOffset: {
			label: 'Handle offset',
			description: 'Payload-relative offset of the Csis::ClassHandle inside the compiled module data. Baked in by the AEMS compiler — read-only because steward cannot relocate slots inside the opaque module blob.',
			readOnly: true,
		},
		type: {
			label: 'Interface type',
			description: 'AemsDef::InterfaceType — every retail bank uses Class (1).',
			readOnly: true,
		},
		idCrc: {
			label: 'System crc',
			description: 'Low u16 of the ID CrcAndKey — must equal the target Csis resource\'s header crc ((Σ its entry crcs) & 0x7FFF).',
			warning: 'Must match the subscribed Csis resource\'s system crc or the link silently breaks.',
		},
		idKey: {
			label: 'Entry crc',
			description: 'High u16 of the ID CrcAndKey — must equal the target class entry\'s own crc inside that Csis resource.',
			warning: 'Must match the subscribed Csis class entry\'s crc or the link silently breaks.',
		},
		idName: {
			label: 'Class name',
			description: 'Name of the Csis class this bank subscribes to (e.g. GearWhineClass). The runtime match is by CrcAndKey; the name is the human-readable identity.',
		},
		_pad: {
			label: 'pad (uninit)',
			description: 'Three uninitialised pad bytes — the ASCII bytes \'AKH\' in every retail bank. Preserved verbatim.',
			hidden: true,
		},
	},
	label: (value, index) => refLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedAemsBank: RecordSchema = {
	name: 'ParsedAemsBank',
	description: 'Root record for the AEMS Bank resource (0xA022): a compiled audio module (opaque x86 glue + static data), an opaque SND10 sample bank, the load-time fixup tables, and the CSIS subscriptions. Every size/offset in the header is derived on write.',
	fields: {
		platform: enumOf('u8', AEMS_PLATFORMS),
		targetType: enumOf('u8', AEMS_TARGET_TYPES),
		numModules: u16(),
		funcFixups: { kind: 'list', item: u32(), addable: false, removable: false },
		staticDataFixups: { kind: 'list', item: u32(), addable: false, removable: false },
		interfaceRefs: {
			kind: 'list',
			item: record('AemsInterfaceReference'),
			// The compiled module code expects exactly these subscriptions —
			// adding/removing one without recompiling the module breaks loading.
			addable: false,
			removable: false,
			itemLabel: (item, index) => refLabel(item, index),
		},
		_moduleData: rawBytes(),
		_sfxBank: rawBytes(),
		_envelopePad: rawBytes(),
	},
	fieldMetadata: {
		platform: {
			label: 'Platform',
			description: 'AEMS platform the bank was compiled for — 0 (PC) in every retail bank. Note this enum differs from the CSIS one (PS3 is 10 here, 7 there).',
			readOnly: true,
		},
		targetType: {
			label: 'Target type',
			description: 'Sample-bank flavour — SND10 (3) in every retail bank.',
			readOnly: true,
		},
		numModules: {
			label: 'Module count',
			description: 'Modules inside the compiled region. 1 in 22 retail banks; INAIR has 2 (the wiki\'s "always 1" is wrong). Read-only: the module region is an opaque blob steward cannot restructure.',
			readOnly: true,
		},
		funcFixups: {
			label: 'Function fixups',
			description: 'Offsets inside the compiled glue code where the loader patches call targets. Derived by the AEMS compiler from the module code — read-only.',
			readOnly: true,
		},
		staticDataFixups: {
			label: 'Static data fixups',
			description: 'Offsets inside the module\'s static data the loader patches, same mechanism as the function fixups — read-only.',
			readOnly: true,
		},
		interfaceRefs: {
			label: 'CSIS subscriptions',
			description: 'The Csis classes this bank binds to at load (by CrcAndKey + name). Count is fixed — the compiled module expects exactly these.',
		},
		_moduleData: {
			label: 'Module blob',
			description: 'Modules + compiled x86 glue code + static data, everything between the header and the SFX bank. Position-dependent machine code — preserved byte-for-byte.',
			hidden: true,
		},
		_sfxBank: {
			label: 'SND10 sample bank',
			description: 'The actual audio samples (\'S10A\' header; the sample count at +0x8 is stored big-endian). Opaque — preserved byte-for-byte.',
			hidden: true,
		},
		_envelopePad: {
			label: 'Envelope pad',
			description: '8 uninitialised bytes in the BinaryFile envelope (heap remnants in retail). Preserved verbatim.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Bank', properties: ['platform', 'targetType', 'numModules'] },
		{ title: 'Subscriptions', properties: ['interfaceRefs'] },
		{ title: 'Fixups', properties: ['funcFixups', 'staticDataFixups'] },
	],
};

const registry: SchemaRegistry = {
	ParsedAemsBank,
	AemsInterfaceReference,
};

export const aemsBankResourceSchema: ResourceSchema = {
	key: 'aemsBank',
	name: 'AEMS Bank',
	rootType: 'ParsedAemsBank',
	registry,
};

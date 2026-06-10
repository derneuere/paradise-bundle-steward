// Hand-written schema for ParsedCsis (resource type 0xA023).
//
// Mirrors the types in `src/lib/core/csis.ts`. Keep these in lockstep with
// the parser/writer — any field added to the parser needs a matching entry
// here, or the schema walker reports it as drift.
//
// Domain: a Csis resource is one audio module's subscription surface — the
// named functions / classes / global variables AEMS banks (0xA022) bind to.
// The link is by CrcAndKey, not by name: a bank's interface reference stores
// (this resource's system crc, the entry's crc). The system crc is derived
// ((Σ entry crcs) & 0x7FFF, recomputed on write), but each entry's own crc is
// NOT name-derived — editing it (or the entry set) without updating the
// subscribing banks silently breaks the audio link, hence the warnings.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';
import { CSIS_PLATFORMS, makeEmptyCsisEntry } from '@/lib/core/csis';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const str = (): FieldSchema => ({ kind: 'string' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

const platformEnum = (): FieldSchema => ({
	kind: 'enum',
	storage: 'u8',
	values: CSIS_PLATFORMS.map((p) => ({ value: p.value, label: p.label })),
});

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function entryLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const e = value as { name?: string; crc?: number };
		const name = e.name || '(unnamed)';
		const crc = e.crc != null ? `0x${e.crc.toString(16).toUpperCase()}` : '?';
		return `${name} · crc ${crc}`;
	} catch {
		return `#${index}`;
	}
}

const entryList = (type: string): FieldSchema => ({
	kind: 'list',
	item: record(type),
	makeEmpty: () => makeEmptyCsisEntry(),
	itemLabel: (item, index) => entryLabel(item, index),
});

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const entryFields: Record<string, FieldSchema> = {
	name: str(),
	crc: u16(),
	_key: u16(),
	_clients: u32(),
};

const entryFieldMetadata = {
	name: {
		label: 'Name',
		description: 'Entry name, e.g. GearWhineClass. Display/debug identity — the runtime link to AEMS banks is by crc, so renaming alone does not retarget anything.',
	},
	crc: {
		label: 'Entry crc',
		description: '15-bit checksum AEMS banks store as the high u16 of their interface-reference CrcAndKey. NOT derived from the name (no standard CRC-16 nor soundHash reproduces it) — change it only together with every subscribing bank.',
		warning: 'Must match the idKey of the AEMS bank interface references that subscribe to this entry, or the audio link silently breaks.',
	},
	_key: {
		label: 'Key (runtime)',
		description: 'High u16 of the on-disk CrcAndKey union — 0 in every retail resource; the runtime fills the key after resolution. Preserved verbatim.',
		hidden: true,
	},
	_clients: {
		label: 'Clients (runtime)',
		description: 'CListDStack subscriber-list head — 0 on disk (a pointer fixed up at runtime). Preserved verbatim.',
		hidden: true,
	},
};

const CsisEntry: RecordSchema = {
	name: 'CsisEntry',
	description: 'One named function or class this audio module exposes. AEMS banks subscribe by CrcAndKey (system crc + this entry\'s crc).',
	fields: entryFields,
	fieldMetadata: entryFieldMetadata,
	label: (value, index) => entryLabel(value, index ?? 0),
};

const CsisGlobalVariable: RecordSchema = {
	name: 'CsisGlobalVariable',
	description: 'A named global variable with its serialised current value. NO retail resource carries one — this shape is wiki-documented but fixture-unvalidated.',
	fields: {
		...entryFields,
		curVal: u32(),
	},
	fieldMetadata: {
		...entryFieldMetadata,
		curVal: {
			label: 'Current value (raw bits)',
			description: 'CsisDef::Parameter union — the same 4 bytes read as either intVal or floatVal. Stored here as raw u32 bits since the type is not recorded.',
		},
	},
	label: (value, index) => entryLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedCsis: RecordSchema = {
	name: 'ParsedCsis',
	description: 'Root record for the Csis resource (0xA023): one audio module\'s CSIS subscription surface. The header system crc is derived ((Σ entry crcs) & 0x7FFF) and recomputed on write.',
	fields: {
		platform: platformEnum(),
		resolved: u8(),
		functions: entryList('CsisEntry'),
		classes: entryList('CsisEntry'),
		globalVariables: {
			kind: 'list',
			item: record('CsisGlobalVariable'),
			// No retail resource has globals, so the 0x10-byte on-disk shape is
			// wiki-only — adding one would write fixture-unvalidated bytes.
			addable: false,
			removable: false,
			itemLabel: (item, index) => entryLabel(item, index),
		},
		_envelopePad: rawBytes(),
		_tailGarbage: rawBytes(),
	},
	fieldMetadata: {
		platform: {
			label: 'Platform',
			description: 'CsisDef::Platform the resource was compiled for — 0 (PC) in every retail resource. Note this enum differs from the AEMS bank one (PS3 is 7 here, 10 there).',
			readOnly: true,
		},
		resolved: {
			label: 'Resolved (runtime)',
			description: '0 on disk; the runtime sets it once pointers are fixed up.',
			readOnly: true,
		},
		functions: {
			label: 'Functions',
			description: 'Named functions this module exposes. Empty in 9 of the 10 retail resources (BoostCsis declares Message_1 / Message).',
		},
		classes: {
			label: 'Classes',
			description: 'Named classes this module exposes — what AEMS bank interface references (type 1 = class) bind to.',
		},
		globalVariables: {
			label: 'Global variables',
			description: 'Named globals with serialised values. Empty in every retail resource; read-only because the on-disk shape is fixture-unvalidated.',
		},
		_envelopePad: {
			label: 'Envelope pad',
			description: '8 uninitialised bytes in the BinaryFile envelope (heap remnants — UTF-16 path fragments in retail). Preserved verbatim.',
			hidden: true,
		},
		_tailGarbage: {
			label: 'Tail garbage',
			description: 'Uninitialised bytes padding the payload to 16-byte alignment — stale heap pointers in retail. Preserved verbatim; zero-filled where edits change the pad length.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Module', properties: ['platform', 'resolved'] },
		{ title: 'Entries', properties: ['functions', 'classes', 'globalVariables'] },
	],
};

const registry: SchemaRegistry = {
	ParsedCsis,
	CsisEntry,
	CsisGlobalVariable,
};

export const csisResourceSchema: ResourceSchema = {
	key: 'csis',
	name: 'CSIS',
	rootType: 'ParsedCsis',
	registry,
};

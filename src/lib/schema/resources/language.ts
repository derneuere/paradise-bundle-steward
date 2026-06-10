// Hand-written schema for ParsedLanguage (resource type 0x27).
//
// Mirrors the types in `src/lib/core/language.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here, or the schema walker reports it as drift.
//
// Domain: one Language resource per language bundle maps a u32 hash of the
// untranslated string ID to its UTF-8 translation. The hash is the
// cross-language key — the SAME hash appears in all 14 bundles, so renaming a
// hash here orphans the string in this language only. The last entry of every
// retail bundle is a filler (hash 0, thousands of 'A's) sizing the resource
// to exactly 0xD4800 bytes; if an edit grows the resource, shrinking the
// filler text by the same number of UTF-8 bytes keeps the total size stable.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';
import { ELANGUAGE } from '@/lib/core/language';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const u32 = (): FieldSchema => ({ kind: 'u32' });
const string = (): FieldSchema => ({ kind: 'string' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

const languageEnum = (): FieldSchema => ({
	kind: 'enum',
	storage: 'u32',
	values: ELANGUAGE.map((l) => ({ value: l.value, label: l.label })),
});

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

export function formatHash(hash: number): string {
	return `0x${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

const LABEL_TEXT_MAX = 32;

function entryLabel(ent: unknown, index: number): string {
	try {
		if (!ent || typeof ent !== 'object') return `#${index}`;
		const e = ent as { muHash?: number; text?: string };
		if (e.muHash == null || e.text == null) return `#${index}`;
		// The retail filler entry would otherwise label as 500k 'A's.
		if (e.muHash === 0 && /^A+$/.test(e.text)) {
			return `#${index} · filler (${e.text.length} bytes of size padding)`;
		}
		const text = e.text.length > LABEL_TEXT_MAX ? `${e.text.slice(0, LABEL_TEXT_MAX)}…` : e.text;
		return `#${index} · ${formatHash(e.muHash)} · "${text}"`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const LanguageEntry: RecordSchema = {
	name: 'LanguageEntry',
	description: 'One localised string: the u32 hash of its untranslated string ID plus the UTF-8 translation. The hash is the lookup key the game uses, identical across all 14 language bundles.',
	fields: {
		muHash: u32(),
		text: string(),
		_padAfter: u32(),
	},
	fieldMetadata: {
		muHash: {
			label: 'String ID hash',
			description: 'u32 hash of the untranslated string ID — the cross-language lookup key. Must stay unique within the resource (retail bundles have zero collisions); hash 0 is the trailing filler entry.',
		},
		text: {
			label: 'Text',
			description: 'The translated string, stored as NUL-terminated UTF-8. Any length is fine — the writer rebuilds every string offset — but it cannot contain an embedded NUL.',
		},
		_padAfter: {
			label: 'Pad after terminator',
			description: 'Extra zero bytes after this string\'s NUL terminator (0 or 3 in retail). Preserved for byte-exact round-trip.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'String', properties: ['muHash', 'text'] },
	],
	label: (value, index) => entryLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedLanguage: RecordSchema = {
	name: 'ParsedLanguage',
	description: 'Root record for the Language resource (0x27): every localised string of one language. Retail sizes each resource to exactly 0xD4800 bytes via the trailing filler entry, so all 14 languages fit one fixed allocation.',
	fields: {
		meLanguageID: languageEnum(),
		entries: {
			kind: 'list',
			item: record('LanguageEntry'),
			addable: true,
			removable: true,
			itemLabel: entryLabel,
			makeEmpty: () => ({ muHash: 0, text: '', _padAfter: 0 }),
		},
	},
	fieldMetadata: {
		meLanguageID: {
			label: 'Language',
			description: 'CgsLanguage::Sku::ELanguage id of this bundle. Note the wiki/retail mismatch: id 12 is named E_LANGUAGE_GREEK but retail bundle 0008 (the only user of 12) contains Russian strings.',
		},
		entries: {
			label: 'Strings',
			description: 'All strings in disk order (the table is ordered by blob offset, not by hash). New entries start with hash 0 — set a unique hash before shipping, since 0 is taken by the trailing filler entry.',
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['meLanguageID'] },
		{ title: 'Strings', properties: ['entries'] },
	],
};

const registry: SchemaRegistry = {
	ParsedLanguage,
	LanguageEntry,
};

export const languageResourceSchema: ResourceSchema = {
	key: 'language',
	name: 'Language',
	rootType: 'ParsedLanguage',
	registry,
};

// V6 prototype AI Sections schema (Burnout 5 2007-02-22 X360 build).
//
// Backs `ParsedAISectionsV6`:
//
//   { kind: 'v6', version: number, legacy: LegacyAISectionsData }
//
// The `legacy` field nests the actual V6 payload — that's where every
// section, portal, and noGo line lives. Mirrors the V4 schema's nesting so
// the editor-registry boundary narrowing (ADR-0008) stays consistent across
// prototype variants.
//
// V6 vs V4 deltas (see `src/lib/core/aiSectionsLegacy.ts`):
//   - Section header grew from 0x30 to 0x34 bytes:
//       + miSpanIndex (i32) — index into StreetData spans, -1 = none
//       + mu8eDistrict (u8) — Suburbs / Industrial / Country / City / Airport
//       (mu8Pad shrunk from 3 bytes to 2 to absorb the new fields)
//   - Flag set expanded from 1 speculative bit to a documented set:
//       IS_IN_AIR | IS_SHORTCUT | IS_JUNCTION
//   - Header is unchanged shape; the on-disk muVersion field still reads 4
//     in this prototype despite the section layout being V6, so the parser
//     captures it separately as `legacy.headerVersion` for byte-exact
//     round-trip preservation.

import type {
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../../types';
import {
	BoundaryLine,
	LEGACY_DANGER_RATING_VALUES,
	LEGACY_DISTRICT_VALUES,
	LEGACY_V6_FLAG_BITS,
	DANGER_SHORT,
	boundaryLineLabel,
	f32,
	fixedList,
	i32,
	recordList,
	u32,
	vec4,
	u16,
} from './shared';

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function legacyV6SectionLabel(sec: unknown, index: number): string {
	try {
		if (!sec || typeof sec !== 'object') return `#${index}`;
		const s = sec as { dangerRating?: number; portals?: unknown[]; spanIndex?: number };
		const danger = s.dangerRating != null ? (DANGER_SHORT[s.dangerRating] ?? `${s.dangerRating}`) : '?';
		const ports = s.portals?.length ?? 0;
		const span = s.spanIndex != null && s.spanIndex >= 0 ? ` · span ${s.spanIndex}` : '';
		return `#${index} · ${danger}${ports > 0 ? ` · ${ports} portals` : ''}${span}`;
	} catch {
		return `#${index}`;
	}
}

function legacyPortalLabel(portal: unknown, index: number): string {
	try {
		if (!portal || typeof portal !== 'object') return `Portal ${index}`;
		const p = portal as { linkSection?: number; boundaryLines?: unknown[] };
		const link = p.linkSection ?? '?';
		const bls = p.boundaryLines?.length ?? 0;
		return `Portal ${index} · →#${link}${bls > 0 ? ` · ${bls} BL` : ''}`;
	} catch {
		return `Portal ${index}`;
	}
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

// Portal wire shape is identical across V4 / V6 (vpu::Vector3 + 4 bytes
// structural pad + boundary-line pointer + linkSection u16). Re-declared as
// a V6-named record so the registry contains a single canonical definition
// per variant — keeps the schema-coverage walker self-contained per file.
const LegacyPortalV6: RecordSchema = {
	name: 'LegacyPortalV6',
	description: 'V6 prototype portal — connection between two AI sections. The on-disk vpu::Vector3 has 4 bytes of structural padding, so the model stores it as a Vector4 with the 4th float preserved verbatim.',
	fields: {
		midPosition: vec4(),
		boundaryLines: recordList('BoundaryLine', boundaryLineLabel),
		linkSection: u16(),
	},
	fieldMetadata: {
		midPosition: {
			label: 'Mid position (xyz + structural pad)',
			description: 'XYZ portal anchor point; the W component is structural padding from vpu::Vector3, typically 0.0 in shipped fixtures. Preserved verbatim for round-trip fidelity.',
		},
		linkSection: {
			label: 'Link section',
			description: 'Index of the V6 AI section this portal leads to.',
		},
	},
	label: (value, index) => legacyPortalLabel(value, index ?? 0),
};

const LegacyAISectionV6: RecordSchema = {
	name: 'LegacyAISectionV6',
	description: 'V6 prototype AI navigation cell. Same inline cornersX[4] + cornersZ[4] layout as V4, plus a StreetData span index and a district enum that V4 lacks. Flag set expanded from V4\'s single speculative bit to IS_IN_AIR / IS_SHORTCUT / IS_JUNCTION.',
	fields: {
		portals: recordList('LegacyPortalV6', legacyPortalLabel),
		noGoLines: recordList('BoundaryLine', boundaryLineLabel),
		// Inline corners — parallel f32[4] arrays, same as V4.
		cornersX: fixedList(f32(), 4),
		cornersZ: fixedList(f32(), 4),
		spanIndex: i32(),
		dangerRating: { kind: 'enum', storage: 'u8', values: LEGACY_DANGER_RATING_VALUES },
		district: { kind: 'enum', storage: 'u8', values: LEGACY_DISTRICT_VALUES },
		flags: { kind: 'flags', storage: 'u8', bits: LEGACY_V6_FLAG_BITS },
	},
	fieldMetadata: {
		cornersX: {
			label: 'Corner X (f32[4])',
			description: 'X coordinates of the four section corners on the XZ plane. Parallel to cornersZ — index i is the i-th corner.',
		},
		cornersZ: {
			label: 'Corner Z (f32[4])',
			description: 'Z coordinates of the four section corners on the XZ plane. Parallel to cornersX.',
		},
		spanIndex: {
			label: 'Span index',
			description: 'Index into the StreetData span table this section is anchored to. -1 means no associated street span.',
		},
		dangerRating: {
			label: 'Danger rating',
			description: 'BrnAI::AISection::DangerRating — Freeway / Normal / Dangerous. V12 retail replaced this enum with the per-speed `speed` enum.',
		},
		district: {
			label: 'District',
			description: 'BrnAI::EDistrict — Suburbs / Industrial / Country / City / Airport. Always 0 in shipping retail data; the V6 prototype is the only place we have non-zero values documented.',
		},
		flags: {
			label: 'Flags',
			description: 'V6 added IS_SHORTCUT and IS_JUNCTION on top of V4\'s speculative bit-0 (now labelled IS_IN_AIR).',
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['spanIndex', 'dangerRating', 'district', 'flags'] },
		{ title: 'Portals', properties: ['portals'] },
		{ title: 'NoGo Lines', properties: ['noGoLines'] },
		{ title: 'Corners', properties: ['cornersX', 'cornersZ'] },
	],
	label: (value, index) => legacyV6SectionLabel(value, index ?? 0),
};

// Inner payload — `ParsedAISectionsV6.legacy`. Mirrors `LegacyAISectionsData`,
// declaring both the structural `version` (always 6 here) and the
// preservation-only `headerVersion` so the schema-coverage walker doesn't
// flag the captured on-disk muVersion as undeclared.
const LegacyAISectionsDataV6: RecordSchema = {
	name: 'LegacyAISectionsDataV6',
	description: 'Inner V6 payload — the actual section list, the structural version (6), and the on-disk muVersion (preserved verbatim because the prototype writes 4 there even though the sections are V6 layout).',
	fields: {
		version: u32(),
		headerVersion: u32(),
		sections: recordList('LegacyAISectionV6', legacyV6SectionLabel),
	},
	fieldMetadata: {
		version: {
			description: 'Structural section-layout version. Always 6 for V6 prototype payloads.',
		},
		headerVersion: {
			label: 'Header muVersion (on-disk)',
			description: 'The literal integer the prototype build wrote to the AISectionsData.muVersion field on disk. The V6 build wrote 4 here even though its section layout is V6 — preserved verbatim so the writer can echo it back for byte-exact round-trip.',
		},
	},
	propertyGroups: [
		{ title: 'Header', properties: ['version', 'headerVersion'] },
		{ title: 'Sections', properties: ['sections'] },
	],
};

const ParsedAISectionsV6Root: RecordSchema = {
	name: 'ParsedAISectionsV6',
	description: 'Root record for the AI Sections resource (0x10001) — V6 prototype variant (Burnout 5 2007-02-22 X360 build). All fields are read-only; the editor profile freezes the schema via freezeSchema().',
	fields: {
		// Discriminator — always 'v6' on this schema. Hidden + read-only for
		// the same reason as on V4/V12: structural tag, not user-editable.
		// Declared so the schema-coverage walker doesn't flag it as undeclared
		// (ADR-0008).
		kind: { kind: 'string' },
		version: u32(),
		legacy: { kind: 'record', type: 'LegacyAISectionsDataV6' },
	},
	fieldMetadata: {
		kind: { hidden: true, readOnly: true },
		version: {
			label: 'Wrapper version',
			description: 'Mirrors `legacy.version` — always 6 on V6 payloads. Surfaced on the wrapper for cheap discrimination without descending into `legacy`.',
		},
		legacy: {
			label: 'Payload',
			description: 'The actual V6 section data parsed from disk.',
		},
	},
	propertyGroups: [
		{ title: 'Header', properties: ['version'] },
		{ title: 'Payload', properties: ['legacy'] },
	],
};

// ---------------------------------------------------------------------------
// Exported resource (raw — frozen for read-only via freezeSchema in the
// editor profile, not here, so the schema definition stays single-sourced)
// ---------------------------------------------------------------------------

const v6Registry: SchemaRegistry = {
	ParsedAISectionsV6: ParsedAISectionsV6Root,
	LegacyAISectionsDataV6,
	LegacyAISectionV6,
	LegacyPortalV6,
	BoundaryLine,
};

export const aiSectionsV6ResourceSchema: ResourceSchema = {
	key: 'aiSections',
	name: 'AI Sections',
	rootType: 'ParsedAISectionsV6',
	registry: v6Registry,
};

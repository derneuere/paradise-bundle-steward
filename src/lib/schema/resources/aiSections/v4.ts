// V4 prototype AI Sections schema (Burnout 5 2006-11-13 X360 dev build).
//
// Backs `ParsedAISectionsV4`:
//
//   { kind: 'v4', version: number, legacy: LegacyAISectionsData }
//
// The `legacy` field nests the actual V4 payload — that's where every
// section, portal, and noGo line lives. The wrapper exists so the
// discriminated union can be narrowed once at the editor-registry boundary
// (see ADR-0008); the schema mirrors that nesting one-to-one so the walker
// finds every parsed field.
//
// Format reference: `src/lib/core/aiSectionsLegacy.ts`. V4 differs from V12
// (and V6) in three load-bearing ways: there's no per-speed min/max table
// and no reset-pair table at the header; sections store their corners
// inline as parallel `cornersX[4]` / `cornersZ[4]` f32 arrays instead of
// pointing at a shared `Vector2[4]` buffer; and only one flag bit (0x01)
// has been observed in the wild — labelled "?" on the wiki since its
// runtime use isn't pinned down. Portals carry a `Vector4` `midPosition`
// because the on-disk shape is `vpu::Vector3` (xyz + 4 bytes of structural
// padding); the 4th float is preserved verbatim for round-trip fidelity.

import type {
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../../types';
import {
	BoundaryLine,
	LEGACY_DANGER_RATING_VALUES,
	LEGACY_V4_FLAG_BITS,
	DANGER_SHORT,
	boundaryLineLabel,
	f32,
	fixedList,
	recordList,
	u8,
	u16,
	u32,
	vec4,
} from './shared';

// ---------------------------------------------------------------------------
// Tree-label helpers — V4 sections have no `id` and no `speed`, so we lean
// on the dangerRating + section-index for a recognisable row label.
// ---------------------------------------------------------------------------

function legacyV4SectionLabel(sec: unknown, index: number): string {
	try {
		if (!sec || typeof sec !== 'object') return `#${index}`;
		const s = sec as { dangerRating?: number; portals?: unknown[] };
		const danger = s.dangerRating != null ? (DANGER_SHORT[s.dangerRating] ?? `${s.dangerRating}`) : '?';
		const ports = s.portals?.length ?? 0;
		return `#${index} · ${danger}${ports > 0 ? ` · ${ports} portals` : ''}`;
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

const LegacyPortalV4: RecordSchema = {
	name: 'LegacyPortalV4',
	description: 'V4 prototype portal — connection between two AI sections. The on-disk vpu::Vector3 has 4 bytes of structural padding, so the model stores it as a Vector4 with the 4th float preserved verbatim.',
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
			description: 'Index of the V4 AI section this portal leads to.',
		},
	},
	label: (value, index) => legacyPortalLabel(value, index ?? 0),
};

const LegacyAISectionV4: RecordSchema = {
	name: 'LegacyAISectionV4',
	description: 'V4 prototype AI navigation cell. Corners are stored inline as parallel cornersX[4] + cornersZ[4] f32 arrays (V12 stores them via a Vector2[4] pointer instead). No per-section `id` or `speed` enum yet — the dangerRating field plays both roles.',
	fields: {
		portals: recordList('LegacyPortalV4', legacyPortalLabel),
		noGoLines: recordList('BoundaryLine', boundaryLineLabel),
		// Inline corners — parallel f32[4] arrays instead of V12's Vector2[4].
		cornersX: fixedList(f32(), 4),
		cornersZ: fixedList(f32(), 4),
		dangerRating: { kind: 'enum', storage: 'u8', values: LEGACY_DANGER_RATING_VALUES },
		flags: { kind: 'flags', storage: 'u8', bits: LEGACY_V4_FLAG_BITS },
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
		dangerRating: {
			label: 'Danger rating',
			description: 'BrnAI::AISection::DangerRating — Freeway / Normal / Dangerous. V12 retail replaced this enum with the per-speed `speed` enum.',
		},
		flags: {
			label: 'Flags',
			description: 'V4 only ever uses bit 0x01. Wiki documents it as "?" — likely the precursor to V6\'s IS_IN_AIR.',
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['dangerRating', 'flags'] },
		{ title: 'Portals', properties: ['portals'] },
		{ title: 'NoGo Lines', properties: ['noGoLines'] },
		{ title: 'Corners', properties: ['cornersX', 'cornersZ'] },
	],
	label: (value, index) => legacyV4SectionLabel(value, index ?? 0),
};

// Inner payload — `ParsedAISectionsV4.legacy`. Mirrors `LegacyAISectionsData`.
const LegacyAISectionsDataV4: RecordSchema = {
	name: 'LegacyAISectionsDataV4',
	description: 'Inner V4 payload — the actual section list and on-disk version number, before the discriminated-union wrapper.',
	fields: {
		version: u32(),
		sections: recordList('LegacyAISectionV4', legacyV4SectionLabel),
	},
	fieldMetadata: {
		version: {
			description: 'On-the-wire muVersion. Always 4 for V4 prototype payloads.',
		},
	},
	propertyGroups: [
		{ title: 'Header', properties: ['version'] },
		{ title: 'Sections', properties: ['sections'] },
	],
};

const ParsedAISectionsV4Root: RecordSchema = {
	name: 'ParsedAISectionsV4',
	description: 'Root record for the AI Sections resource (0x10001) — V4 prototype variant (Burnout 5 2006-11-13 X360 dev build). All fields are read-only; the editor profile freezes the schema via freezeSchema().',
	fields: {
		// Discriminator on the runtime model — always 'v4' on this schema.
		// Hidden + read-only for the same reason as on V12: it's a structural
		// tag, not a user-editable field. Declared so the schema-coverage
		// walker doesn't flag it as undeclared (ADR-0008).
		kind: { kind: 'string' },
		version: u32(),
		legacy: { kind: 'record', type: 'LegacyAISectionsDataV4' },
	},
	fieldMetadata: {
		kind: { hidden: true, readOnly: true },
		version: {
			label: 'Wrapper version',
			description: 'Mirrors `legacy.version` — always 4 on V4 payloads. Surfaced on the wrapper for cheap discrimination without descending into `legacy`.',
		},
		legacy: {
			label: 'Payload',
			description: 'The actual V4 section data parsed from disk.',
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

const v4Registry: SchemaRegistry = {
	ParsedAISectionsV4: ParsedAISectionsV4Root,
	LegacyAISectionsDataV4,
	LegacyAISectionV4,
	LegacyPortalV4,
	BoundaryLine,
};

export const aiSectionsV4ResourceSchema: ResourceSchema = {
	key: 'aiSections',
	name: 'AI Sections',
	rootType: 'ParsedAISectionsV4',
	registry: v4Registry,
};

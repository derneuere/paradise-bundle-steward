// V12 retail AI Sections schema. Relocated from the old single-file schema
// during issue #33 — the only structural difference is module location.
// Records / enums / labels live in `./shared.ts`.

import type {
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../../types';
import {
	BoundaryLine,
	SECTION_SPEED_VALUES,
	AI_SECTION_FLAG_BITS,
	RESET_SPEED_VALUES,
	SPEED_SHORT,
	RESET_SHORT,
	boundaryLineLabel,
	f32,
	fixedList,
	i16,
	recordList,
	u8,
	u16,
	u32,
	vec2,
	vec3,
} from './shared';

// ---------------------------------------------------------------------------
// Tree-label helpers (V12-specific — read fields that only exist on V12)
// ---------------------------------------------------------------------------

function sectionLabel(sec: unknown, index: number): string {
	try {
		if (!sec || typeof sec !== 'object') return `#${index}`;
		const s = sec as { id?: number; speed?: number };
		const idHex = s.id != null ? `0x${(s.id >>> 0).toString(16).toUpperCase()}` : '?';
		const speed = s.speed != null ? (SPEED_SHORT[s.speed] ?? `${s.speed}`) : '?';
		return `#${index} · ${idHex} · ${speed}`;
	} catch {
		return `#${index}`;
	}
}

function resetPairLabel(pair: unknown, index: number): string {
	try {
		if (!pair || typeof pair !== 'object') return `#${index}`;
		const p = pair as { resetSpeed?: number; startSectionIndex?: number; resetSectionIndex?: number };
		const speed = p.resetSpeed != null ? (RESET_SHORT[p.resetSpeed] ?? `${p.resetSpeed}`) : '?';
		const start = p.startSectionIndex ?? '?';
		const reset = p.resetSectionIndex ?? '?';
		return `#${index} · ${speed} · ${start}→${reset}`;
	} catch {
		return `#${index}`;
	}
}

function portalLabel(portal: unknown, index: number): string {
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
// V12 record schemas
// ---------------------------------------------------------------------------

const Portal: RecordSchema = {
	name: 'Portal',
	description: 'Connection between two AI sections — a 3D anchor point plus a list of boundary lines bounding the portal opening.',
	fields: {
		position: vec3(),
		boundaryLines: recordList('BoundaryLine', boundaryLineLabel),
		linkSection: u16(),
	},
	fieldMetadata: {
		position: {
			label: 'Position',
			description: '3D anchor point of the portal in world space (Y-up display).',
			swapYZ: true,
			// Full 3D translate: dragging the parent section on the XZ plane
			// shifts the portal anchor along with it. The gizmo passes
			// `dy = 0`, so vertical position is preserved.
			spatial: 'vec3',
		},
		linkSection: { description: 'Index of the section this portal leads to.' },
	},
	label: (value, index) => portalLabel(value, index ?? 0),
};

const AISection: RecordSchema = {
	name: 'AISection',
	description: 'One AI navigation cell — a polygon of corners on the XZ plane, with portals to neighbours, optional no-go lines, and speed/flag metadata.',
	fields: {
		portals: recordList('Portal', portalLabel),
		noGoLines: recordList('BoundaryLine', boundaryLineLabel),
		// Retail data always has exactly 4 corners per section.
		corners: fixedList(vec2(), 4),
		id: u32(),
		spanIndex: i16(),
		speed: { kind: 'enum', storage: 'u8', values: SECTION_SPEED_VALUES },
		district: u8(),
		flags: { kind: 'flags', storage: 'u8', bits: AI_SECTION_FLAG_BITS },
	},
	fieldMetadata: {
		id: {
			label: 'Section ID',
			description: 'AISectionId — typically a GameDB hash. Displayed as a decimal in default forms; editors usually show it as hex.',
		},
		spanIndex: {
			label: 'Span index',
			description: 'Signed i16. -1 means "no span".',
		},
		district: {
			label: 'District',
			description: 'u8 — always 0 in retail data. Preserved for round-trip fidelity.',
		},
		flags: { label: 'Flags' },
		corners: {
			label: 'Corners (Vector2[4])',
			description: 'Four 2D points on the XZ plane forming the section polygon. Always 4 in retail data.',
			// Each Vector2 stores `(worldX, worldZ)`. The translate walker
			// shifts every corner by the gizmo's XZ delta.
			spatial: 'vec2-xz',
		},
	},
	propertyGroups: [
		{
			title: 'Identity',
			properties: ['id', 'spanIndex', 'speed', 'district', 'flags'],
		},
		{
			title: 'Portals',
			properties: ['portals'],
		},
		{
			title: 'NoGo Lines',
			properties: ['noGoLines'],
		},
		{
			title: 'Corners',
			properties: ['corners'],
		},
		{
			// Derived view of the polygon's edges. The renderer offers a
			// right-click action to duplicate the section through any edge
			// and auto-wire a mirrored portal pair — see
			// `aiSectionsOps.duplicateSectionThroughEdge`.
			title: 'Edges',
			component: 'AISectionEdges',
		},
	],
	label: (value, index) => sectionLabel(value, index ?? 0),
};

const SectionResetPair: RecordSchema = {
	name: 'SectionResetPair',
	description: 'A mapping from a start-section to the section the AI should reset to, with a reset-speed hint.',
	fields: {
		resetSpeed: { kind: 'enum', storage: 'u32', values: RESET_SPEED_VALUES },
		startSectionIndex: u16(),
		resetSectionIndex: u16(),
	},
	fieldMetadata: {
		resetSpeed: { label: 'Reset speed' },
		startSectionIndex: { label: 'Start section' },
		resetSectionIndex: { label: 'Reset section' },
	},
	label: (value, index) => resetPairLabel(value, index ?? 0),
};

// Root-level tabs. "Overview" reuses the existing overview tab as an
// extension; the three other tabs list the root's primitive / list fields,
// which the default form already knows how to render (the `sections` and
// `sectionResetPairs` lists then fall back to their customRenderer settings).
const AI_SECTIONS_GROUPS = [
	{ title: 'Overview', component: 'AISectionsOverview' },
	{ title: 'Header', properties: ['version', 'sectionMinSpeeds', 'sectionMaxSpeeds'] },
	{ title: 'Sections', properties: ['sections'] },
	{ title: 'Reset Pairs', properties: ['sectionResetPairs'] },
];

const ParsedAISections: RecordSchema = {
	name: 'ParsedAISections',
	description: 'Root record for the AI Sections resource (0x10001) — V12 retail variant. Contains the section polygons, per-speed limits, and the reset-pair table.',
	fields: {
		// Discriminator on the runtime model — always 'v12' on this schema.
		// Hidden + read-only because it's a structural tag the parser writes
		// and the writer ignores; users have no business editing it. Listed
		// in `fields` only so the schema-coverage walker doesn't flag it as
		// an undeclared field on the parsed model (ADR-0008).
		kind: { kind: 'string' },
		version: u32(),
		sectionMinSpeeds: fixedList(f32(), 5),
		sectionMaxSpeeds: fixedList(f32(), 5),
		sections: recordList('AISection', sectionLabel, 'AISectionsList'),
		sectionResetPairs: recordList('SectionResetPair', resetPairLabel, 'AISectionsResetPairs'),
	},
	fieldMetadata: {
		kind: { hidden: true, readOnly: true },
		version: { description: 'Always 12 in retail.' },
		sectionMinSpeeds: {
			label: 'Min speeds (m/s)',
			description: 'One entry per SectionSpeed enum value (Very Slow, Slow, Normal, Fast, Very Fast).',
		},
		sectionMaxSpeeds: {
			label: 'Max speeds (m/s)',
			description: 'One entry per SectionSpeed enum value. Parallel to sectionMinSpeeds.',
		},
	},
	propertyGroups: AI_SECTIONS_GROUPS,
};

// ---------------------------------------------------------------------------
// Exported resource
// ---------------------------------------------------------------------------

const v12Registry: SchemaRegistry = {
	ParsedAISections,
	AISection,
	Portal,
	BoundaryLine,
	SectionResetPair,
};

export const aiSectionsV12ResourceSchema: ResourceSchema = {
	key: 'aiSections',
	name: 'AI Sections',
	rootType: 'ParsedAISections',
	registry: v12Registry,
};

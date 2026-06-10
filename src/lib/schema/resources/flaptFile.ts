// Hand-written schema for ParsedFlaptFile (resource type 0x10020).
//
// Mirrors the types in `src/lib/core/flaptFile.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here, or the schema walker reports it as drift.
//
// Domain: Flapt is the in-game HUD, a Flash-derived GUI compiled flat. Every
// pointer in the payload is an absolute offset — including pointers inside
// the un-decoded timeline data — so the writer never moves bytes; it patches
// fixed-width fields in place. That makes the editable surface narrow and
// explicit: frame time, vertices, font colour/height, and texture-import
// retargets. Everything pointer-bearing (strings, components, clip structure)
// is read-only, and every list is fixed-length.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Local helpers (mirroring aptData.ts)
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const str = (): FieldSchema => ({ kind: 'string' });
const vec2 = (): FieldSchema => ({ kind: 'vec2' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

const fixedList = (item: FieldSchema, itemLabel?: (item: unknown, index: number) => string): FieldSchema => ({
	kind: 'list',
	item,
	addable: false,
	removable: false,
	...(itemLabel ? { itemLabel } : {}),
});

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function clipLabel(clip: unknown, index: number): string {
	try {
		if (!clip || typeof clip !== 'object') return `#${index}`;
		const c = clip as { componentName?: string | null; muNumFramesInTimeline?: number; muNumChildren?: number };
		const name = c.componentName ?? '(anonymous)';
		return `#${index} · ${name} · ${c.muNumFramesInTimeline ?? '?'}f · ${c.muNumChildren ?? '?'}ch`;
	} catch {
		return `#${index}`;
	}
}

function textureLabel(tex: unknown, index: number): string {
	try {
		if (!tex || typeof tex !== 'object') return `#${index}`;
		const t = tex as { resourceId?: bigint | null };
		return t.resourceId != null
			? `#${index} · 0x${t.resourceId.toString(16).toUpperCase()}`
			: `#${index} · special (by name)`;
	} catch {
		return `#${index}`;
	}
}

function vertexLabel(vert: unknown, index: number): string {
	try {
		if (!vert || typeof vert !== 'object') return `#${index}`;
		const v = vert as { mv2Pos?: { x?: number; y?: number }; mColour?: number };
		const x = v.mv2Pos?.x != null ? v.mv2Pos.x.toFixed(1) : '?';
		const y = v.mv2Pos?.y != null ? v.mv2Pos.y.toFixed(1) : '?';
		const c = v.mColour != null ? v.mColour.toString(16).toUpperCase().padStart(8, '0') : '?';
		return `#${index} · (${x}, ${y}) · #${c}`;
	} catch {
		return `#${index}`;
	}
}

function fontLabel(font: unknown, index: number): string {
	try {
		if (!font || typeof font !== 'object') return `#${index}`;
		const f = font as { fontName?: string; mfFontHeight?: number };
		return `#${index} · ${f.fontName ?? '?'} · ${f.mfFontHeight ?? '?'} px`;
	} catch {
		return `#${index}`;
	}
}

function componentLabel(comp: unknown, index: number): string {
	try {
		if (!comp || typeof comp !== 'object') return `#${index}`;
		const c = comp as { debugName?: string; pathIndices?: number[] };
		return `#${index} · ${c.debugName ?? '?'} · [${(c.pathIndices ?? []).join('.')}]`;
	} catch {
		return `#${index}`;
	}
}

function triggerLabel(trig: unknown, index: number): string {
	try {
		if (!trig || typeof trig !== 'object') return `#${index}`;
		const t = trig as { parameter0?: string | null; parameter1?: string | null; parameter2?: string | null };
		const parts = [t.parameter0, t.parameter1, t.parameter2].filter((p) => p != null);
		return parts.length > 0 ? `#${index} · ${parts.join(' · ')}` : `#${index}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const FlaptGuiVertex: RecordSchema = {
	name: 'FlaptGuiVertex',
	description: 'One Basic2dColouredTexturedVertex (0x14 bytes) — 2D HUD-space position, packed RGBA8 colour, and UV into the mesh\'s texture page. Patched in place on write.',
	fields: {
		mv2Pos: vec2(),
		mColour: u32(),
		mv2Tex0UV: vec2(),
	},
	fieldMetadata: {
		mv2Pos: {
			label: 'Position',
			description: '2D position in HUD screen space (pixels; origin at the element anchor).',
		},
		mColour: {
			label: 'Colour',
			description: 'Packed RGBA8 vertex colour (renderengine::RGBA8). 0xFFFFFFFF = untinted.',
		},
		mv2Tex0UV: {
			label: 'UV',
			description: 'Texture coordinates (0..1) into the texture page this mesh samples.',
		},
	},
	label: (value, index) => vertexLabel(value, index ?? 0),
};

const FlaptFontStyle: RecordSchema = {
	name: 'FlaptFontStyle',
	description: 'One BrnFlapt::FontStyle (0xC bytes) — font face, colour, and height for HUD text fields. Colour and height are patched in place; the name is a pooled-string pointer and stays read-only.',
	fields: {
		fontName: str(),
		muColour: u32(),
		mfFontHeight: f32(),
	},
	fieldMetadata: {
		fontName: {
			label: 'Font',
			description: 'Font face name (e.g. B5EAConDisSDrop). Read-only: the name lives in a shared string pool the writer never moves.',
			readOnly: true,
		},
		muColour: {
			label: 'Colour',
			description: 'Packed RGBA8 text colour. 0xFFFFFFFF (untinted white) throughout retail.',
		},
		mfFontHeight: {
			label: 'Height',
			description: 'Glyph height in pixels.',
		},
	},
	label: (value, index) => fontLabel(value, index ?? 0),
};

const FlaptTexture: RecordSchema = {
	name: 'FlaptTexture',
	description: 'One mpapTextures slot. Imported slots carry the sibling Texture (0x0) resource id from the inline BND2 import table — retargeting within the bundle is safe. Slots without an import entry are "special": the game resolves them by name at runtime (see Special texture names), and the writer rejects giving them a resource id.',
	fields: {
		resourceId: { kind: 'bigint', bytes: 8, hex: true },
	},
	fieldMetadata: {
		resourceId: {
			label: 'Texture resource',
			description: 'Resource id of the sibling Texture this slot binds, written into the inline import table. null on special slots (resolved by name at runtime) — null-ness cannot be toggled because the import-entry count is fixed.',
		},
	},
	label: (value, index) => textureLabel(value, index ?? 0),
};

const FlaptComponent: RecordSchema = {
	name: 'FlaptComponent',
	description: 'One addressable HUD component: the language hash game code looks it up by, the debug name the hash came from, and the IndexPath of child indices walked from the root movie clip to reach it.',
	fields: {
		muHash: u32(),
		debugName: str(),
		pathIndices: fixedList(u8()),
	},
	fieldMetadata: {
		muHash: {
			label: 'Name hash',
			description: 'Language hash of the component name (burnout.wiki/wiki/Language_hash). Read-only — game code addresses the component by this value.',
			readOnly: true,
		},
		debugName: {
			label: 'Name',
			description: 'Debug string the hash was computed from (e.g. SatNavIcon0_Icon). Read-only pooled string.',
			readOnly: true,
		},
		pathIndices: {
			label: 'Index path',
			description: 'Child indices from the root clip down to this component (max depth 32 on disk; deepest retail path is 10).',
			readOnly: true,
		},
	},
	label: (value, index) => componentLabel(value, index ?? 0),
};

const FlaptTriggerParameters: RecordSchema = {
	name: 'FlaptTriggerParameters',
	description: 'One BrnFlapt::TriggerParameters — four optional pooled strings. Retail rows read like (component, event, target), e.g. RaceMainHUD · ON_ENTER · EasyDriveEntry.',
	fields: {
		parameter0: str(),
		parameter1: str(),
		parameter2: str(),
		parameter3: str(),
	},
	fieldMetadata: {
		parameter0: { label: 'Parameter 0', readOnly: true },
		parameter1: { label: 'Parameter 1', readOnly: true },
		parameter2: { label: 'Parameter 2', readOnly: true },
		parameter3: { label: 'Parameter 3', readOnly: true },
	},
	label: (value, index) => triggerLabel(value, index ?? 0),
};

const FlaptMovieClip: RecordSchema = {
	name: 'FlaptMovieClip',
	description: 'Scalar header of one BrnFlapt::MovieClip (0x44 bytes on disk). The clip\'s timeline data (frame maps, render layers, keyframe anims, FScript) is reached through absolute pointers steward preserves verbatim, so everything here is read-only.',
	fields: {
		mxFlags: u8(),
		muNumChildren: u8(),
		muNumMeshes: u8(),
		muNumTextFields: u8(),
		muNumRenderLayers: u8(),
		muNumLabelledFrames: u8(),
		muNumFScriptCommands: u8(),
		muNumFramesInTimeline: u16(),
		muNumKeyFrames: u16(),
		componentName: str(),
	},
	fieldMetadata: {
		mxFlags: { label: 'Flags', readOnly: true },
		muNumChildren: { label: 'Children', description: 'Child movie clip count.', readOnly: true },
		muNumMeshes: { label: 'Meshes', readOnly: true },
		muNumTextFields: { label: 'Text fields', readOnly: true },
		muNumRenderLayers: { label: 'Render layers', readOnly: true },
		muNumLabelledFrames: { label: 'Labelled frames', readOnly: true },
		muNumFScriptCommands: { label: 'FScript commands', readOnly: true },
		muNumFramesInTimeline: { label: 'Timeline frames', readOnly: true },
		muNumKeyFrames: { label: 'Key frames', readOnly: true },
		componentName: {
			label: 'Component name',
			description: 'Set on the 50 clips that are addressable components; null on anonymous clips.',
			readOnly: true,
		},
	},
	propertyGroups: [
		{ title: 'Clip', properties: ['componentName', 'mxFlags', 'muNumFramesInTimeline', 'muNumKeyFrames'] },
		{ title: 'Contents', properties: ['muNumChildren', 'muNumMeshes', 'muNumTextFields', 'muNumRenderLayers', 'muNumLabelledFrames', 'muNumFScriptCommands'] },
	],
	label: (value, index) => clipLabel(value, index ?? 0),
};

const ParsedFlaptFile: RecordSchema = {
	name: 'ParsedFlaptFile',
	description: 'Root record for the FlaptFile resource (0x10020): the in-game HUD. The payload is preserved verbatim — edits patch fixed-width fields in place (frame time, vertices, font colour/height, texture retargets); all lists are fixed-length and pointer-bearing data is read-only.',
	fields: {
		muVersion: u8(),
		mfTimePerFrame: f32(),
		movieClips: fixedList(record('FlaptMovieClip'), clipLabel),
		textures: fixedList(record('FlaptTexture'), textureLabel),
		vertices: fixedList(record('FlaptGuiVertex'), vertexLabel),
		fontStyles: fixedList(record('FlaptFontStyle'), fontLabel),
		components: fixedList(record('FlaptComponent'), componentLabel),
		triggerParameters: fixedList(record('FlaptTriggerParameters'), triggerLabel),
		strings: fixedList(str()),
		specialTextureNames: fixedList(str()),
		debugStringCount: u32(),
		_payload: rawBytes(),
	},
	fieldMetadata: {
		muVersion: {
			label: 'Version',
			description: 'Format version — 12 in every retail build; the parser rejects anything else.',
			readOnly: true,
		},
		mfTimePerFrame: {
			label: 'Frame time',
			description: 'Seconds per timeline frame. Retail is 0.0333… (30 fps).',
		},
		movieClips: {
			label: 'Movie clips',
			description: 'All 560 clip headers in file order. Read-only — timeline data behind their pointers is preserved verbatim.',
		},
		textures: {
			label: 'Textures',
			description: 'mpapTextures slots in slot order. Imported slots can be retargeted to another sibling Texture; the un-imported slots are resolved by name at runtime.',
		},
		vertices: {
			label: 'Vertices',
			description: 'The shared GuiVertex pool meshes index into (0x14 bytes each). Freely editable in place; the count is fixed.',
		},
		fontStyles: {
			label: 'Font styles',
			description: 'Text styles referenced by text fields. Colour and height are editable.',
		},
		components: {
			label: 'Components',
			description: 'Addressable HUD components: name hash + index path from the root clip.',
		},
		triggerParameters: {
			label: 'Trigger parameters',
			description: 'Trigger wiring rows (component · event · target), e.g. the EasyDrive entry trigger.',
		},
		strings: {
			label: 'Strings',
			description: 'The CgsUtf8 HUD string table — on-screen text. Read-only: strings live in a pool the writer never moves.',
			readOnly: true,
		},
		specialTextureNames: {
			label: 'Special texture names',
			description: 'Names of textures resolved at runtime instead of imported (retail: CustomComponentTexture.tif).',
			readOnly: true,
		},
		debugStringCount: {
			label: 'Debug strings',
			description: 'FileDebugData.muNumStrings — count of the debug string pool steward does not decode.',
			readOnly: true,
		},
		_payload: {
			label: 'Payload bytes',
			description: 'The verbatim payload including the import-table tail. The writer patches edits into a copy of this; layout never changes.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'File', properties: ['muVersion', 'mfTimePerFrame', 'debugStringCount'] },
		{ title: 'Clips', properties: ['movieClips', 'components', 'triggerParameters'] },
		{ title: 'Render', properties: ['textures', 'specialTextureNames', 'vertices', 'fontStyles'] },
		{ title: 'Text', properties: ['strings'] },
	],
};

// ---------------------------------------------------------------------------
// Registry export
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	ParsedFlaptFile,
	FlaptMovieClip,
	FlaptTexture,
	FlaptGuiVertex,
	FlaptFontStyle,
	FlaptComponent,
	FlaptTriggerParameters,
};

export const flaptFileResourceSchema: ResourceSchema = {
	key: 'flaptFile',
	name: 'Flapt File',
	rootType: 'ParsedFlaptFile',
	registry,
};

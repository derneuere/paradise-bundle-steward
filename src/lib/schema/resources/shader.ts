// Hand-written schema for the Shader resource (type 0x32).
//
// Shader is read-only in the workspace: the inspector surfaces the decoded
// metadata (name, technique list, constant table) while the center pane's
// ShaderViewport renders the translated DXBC programs on a test mesh. The
// rootType matches `ParsedShader` from src/lib/core/shader.ts.
//
// Byte-level bookkeeping fields (`raw`, `totalSize`, `hlslSource`) are declared
// hidden so the parser↔schema drift check stays satisfied without cluttering
// the form. Edits don't round-trip (the writer only patches the fixed-position
// count bytes), so every field is read-only.

import type {
	FieldSchema,
	FieldMetadata,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';

const u8 = (): FieldSchema => ({ kind: 'u8' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const str = (): FieldSchema => ({ kind: 'string' });
const bool = (): FieldSchema => ({ kind: 'bool' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

const ro = (description?: string): FieldMetadata => ({
	readOnly: true,
	...(description ? { description } : {}),
});

const roList = (item: FieldSchema): FieldSchema => ({
	kind: 'list',
	item,
	addable: false,
	removable: false,
});

const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

const ShaderSampler: RecordSchema = {
	name: 'ShaderSampler',
	description: 'One sampler binding declared by a technique: a name (e.g. "DiffuseSampler") and the texture channel it reads.',
	fields: {
		name: str(),
		channel: u8(),
	},
	fieldMetadata: {
		name: ro('Sampler variable name as authored in the shader source.'),
		channel: ro('Texture channel index (miChannel) this sampler reads from.'),
	},
	label: (value) => {
		const v = value as { name?: string; channel?: number } | null;
		return v?.name ? `${v.name} · ch ${v.channel ?? 0}` : 'Sampler';
	},
};

const ShaderTechnique: RecordSchema = {
	name: 'ShaderTechnique',
	description: 'One render technique — a {vertex, pixel} program pair plus its sampler bindings.',
	fields: {
		name: str(),
		vertexName: str(),
		pixelName: str(),
		numSamplers: u8(),
		samplers: roList(record('ShaderSampler')),
	},
	fieldMetadata: {
		name: ro('Technique name (e.g. "Default").'),
		vertexName: ro('Inline vertex-shader name (original PC only; empty on Remastered).'),
		pixelName: ro('Inline pixel-shader name (original PC only; empty on Remastered).'),
		numSamplers: ro('Number of sampler bindings in this technique.'),
		samplers: { ...ro('Sampler → channel bindings.'), label: 'Samplers' },
	},
	label: (value, index) => {
		const v = value as { name?: string } | null;
		return v?.name || `Technique ${index ?? 0}`;
	},
};

const ShaderConstant: RecordSchema = {
	name: 'ShaderConstant',
	description: 'One constant-table slot: a name, its 32-bit name hash, size (in float4s), register index, and optional baked instance-data default.',
	fields: {
		name: str(),
		hash: u32(),
		size: u8(),
		index: u8(),
		instanceData: fixedList(f32(), 4),
	},
	fieldMetadata: {
		name: ro('Constant name as authored (e.g. "g_paintColour").'),
		hash: { ...ro('32-bit name hash, used to resolve the constant at draw time via the shader-constant hash table.'), label: 'Name hash' },
		size: ro('Constant size in float4 units.'),
		index: ro('Register/slot index in the constant table.'),
		instanceData: {
			// Only the first numConstantsWithInstanceData entries are populated;
			// the rest are null. Hidden so the form doesn't choke on the null
			// tail — the baked defaults are an advanced detail the viewport seeds.
			hidden: true,
			readOnly: true,
			description: 'Baked float4 default for this constant (material-provided), or null when engine-supplied.',
		},
	},
	label: (value, index) => {
		const v = value as { name?: string } | null;
		return v?.name || `Constant ${index ?? 0}`;
	},
};

const ParsedShader: RecordSchema = {
	name: 'ParsedShader',
	description: 'A Shader resource (0x32): a named wrapper over a set of technique program-pairs plus a constant table. The Remastered build imports precompiled DXBC via Shader Program Buffer resources; the viewport translates and renders them.',
	fields: {
		name: str(),
		hasInlineHLSL: bool(),
		flags: u8(),
		numTechniques: u8(),
		numConstants: u8(),
		numConstantsWithInstanceData: u8(),
		techniques: roList(record('ShaderTechnique')),
		constants: roList(record('ShaderConstant')),
		hlslSource: str(),
		totalSize: u32(),
		raw: roList(u8()),
	},
	fieldMetadata: {
		name: { ...ro('Decoded shader name (e.g. "Vehicle_Opaque_CarbonFibre_Textured").'), label: 'Name' },
		hasInlineHLSL: ro('True on the original PC build (HLSL source compiled at load). False on Remastered (precompiled DXBC imported via Shader Program Buffer).'),
		flags: ro('Header flags byte (+0x05). 0x44 on original PC, 3 on Remastered.'),
		numTechniques: ro('Number of techniques.'),
		numConstants: ro('Number of constant-table slots.'),
		numConstantsWithInstanceData: ro('How many leading constants carry a baked instance-data default.'),
		techniques: { ...ro('Technique list (each a vertex/pixel program pair).'), label: 'Techniques' },
		constants: { ...ro('Constant table.'), label: 'Constants' },
		hlslSource: { hidden: true, readOnly: true, description: 'Inline HLSL source (original PC only); empty on Remastered.' },
		totalSize: { hidden: true, readOnly: true, description: 'Resource byte length (bookkeeping).' },
		raw: { hidden: true, readOnly: true, description: 'Verbatim resource bytes (bookkeeping; preserved for round-trip).' },
	},
	propertyGroups: [
		{ title: 'Overview', properties: ['name', 'hasInlineHLSL', 'flags', 'numTechniques', 'numConstants', 'numConstantsWithInstanceData'] },
		{ title: 'Techniques', properties: ['techniques'] },
		{ title: 'Constants', properties: ['constants'] },
	],
	label: (value) => {
		const v = value as { name?: string } | null;
		return v?.name || 'Shader';
	},
};

const registry: SchemaRegistry = {
	ParsedShader,
	ShaderTechnique,
	ShaderSampler,
	ShaderConstant,
};

export const shaderResourceSchema: ResourceSchema = {
	key: 'shader',
	name: 'Shader',
	rootType: 'ParsedShader',
	registry,
};

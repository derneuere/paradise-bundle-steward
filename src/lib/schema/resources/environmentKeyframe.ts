// Hand-written schema for ParsedEnvironmentKeyframe (resource type 0x10012).
//
// Mirrors the types in `src/lib/core/environmentSettings.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: a keyframe is a full snapshot of the environment look at one time
// of day (the time lives in the debug name's _HHMM suffix and in the
// EnvironmentTimeLine's schedule, not in this resource). All colour fields
// are LINEAR FLOAT RGB: nominal range 0–1, but sky colours and the lighting
// fills go HDR-overbright in retail (observed max ≈ 3.5 on the down fill) —
// values above 1 are intentional, never clamp them. The post-process tint is
// not stored here either: mColourCubeId references a ColourCube (0x50)
// texture via the resource's inline import table.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const f32 = (): FieldSchema => ({ kind: 'f32' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const vec2 = (): FieldSchema => ({ kind: 'vec2' });
const vec3 = (): FieldSchema => ({ kind: 'vec3' });
const vec4 = (): FieldSchema => ({ kind: 'vec4' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const resourceId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });

const fixedF32Pair = (): FieldSchema => ({
	kind: 'list',
	item: f32(),
	addable: false,
	removable: false,
	minLength: 2,
	maxLength: 2,
});

const cloudLayerColours = (): FieldSchema => ({
	kind: 'list',
	item: vec3(),
	addable: false,
	removable: false,
	minLength: 2,
	maxLength: 2,
	itemLabel: (_item, index) => `layer ${index}`,
});

const RGB_NOTE = 'Linear float RGB — nominal 0–1, HDR values above 1 are valid (do not clamp).';

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const EnvironmentBloomData: RecordSchema = {
	name: 'EnvironmentBloomData',
	description: 'HDR bloom (glow around bright areas) for this time of day.',
	fields: {
		mfLuminance: f32(),
		mfThreshold: f32(),
		mv4Scale: vec4(),
	},
	fieldMetadata: {
		mfLuminance: {
			label: 'Luminance',
			description: 'Scene luminance the bloom adapts around (retail 0.71–3.36).',
		},
		mfThreshold: {
			label: 'Threshold',
			description: 'Brightness above which pixels start blooming (retail 0.05–0.84).',
		},
		mv4Scale: {
			label: 'Bloom scale (RGB + w)',
			description: `Per-channel bloom colour scale, RGB in x/y/z. ${RGB_NOTE} Retail keeps every lane in 0.001–1.`,
		},
	},
};

const EnvironmentVignetteData: RecordSchema = {
	name: 'EnvironmentVignetteData',
	description: 'Screen-edge vignette tint for this time of day.',
	fields: {
		mfAngle: f32(),
		mfSharpness: f32(),
		mv2Amount: vec2(),
		mv2Centre: vec2(),
		mv4InnerColour: vec4(),
		mv4OuterColour: vec4(),
	},
	fieldMetadata: {
		mfAngle: {
			label: 'Angle',
			description: 'Vignette rotation. 0 in every retail keyframe.',
		},
		mfSharpness: {
			label: 'Sharpness',
			description: 'Falloff sharpness from centre to edge (retail 0.24–0.39).',
		},
		mv2Amount: {
			label: 'Amount',
			description: 'Vignette strength (x/y; retail 0.3–1.01).',
		},
		mv2Centre: {
			label: 'Centre',
			description: 'Vignette centre in normalized screen space (retail 0.2–0.7).',
		},
		mv4InnerColour: {
			label: 'Inner colour (RGBA)',
			description: `Colour at the vignette centre. ${RGB_NOTE}`,
		},
		mv4OuterColour: {
			label: 'Outer colour (RGBA)',
			description: `Colour at the screen edges. ${RGB_NOTE}`,
		},
	},
};

const EnvironmentScatteringData: RecordSchema = {
	name: 'EnvironmentScatteringData',
	description: 'Atmospheric model: the sky dome colour ramp (Sky*) and the in-scattering / distance-haze ramp applied to geometry (Scatt*). Each ramp blends a zenith, horizon, and sun-direction colour.',
	fields: {
		mv3SkyTopColour: vec3(),
		mv3SkyHorColour: vec3(),
		mv3SkySunColour: vec3(),
		mfSkyHorPow: f32(),
		mfSkySunPow: f32(),
		mfSkyDrk: f32(),
		mfSkyHorBleedScl: f32(),
		mfSkyHorBleedPow: f32(),
		mfSkySunBleedPow: f32(),
		mv3ScattTopColour: vec3(),
		mv3ScattHorColour: vec3(),
		mv3ScattSunColour: vec3(),
		mfScattHorPow: f32(),
		mfScattSunPow: f32(),
		mfScattDrk: f32(),
		mfScattHorBleedScl: f32(),
		mfScattHorBleedPow: f32(),
		mfScattSunBleedPow: f32(),
		mafScattDist: fixedF32Pair(),
		mfScattPow: f32(),
		mfScattCap: f32(),
	},
	fieldMetadata: {
		mv3SkyTopColour: { label: 'Sky zenith colour (RGB)', description: `Sky colour straight up. ${RGB_NOTE}` },
		mv3SkyHorColour: { label: 'Sky horizon colour (RGB)', description: `Sky colour at the horizon. ${RGB_NOTE} Retail sky colours reach ≈2.19.` },
		mv3SkySunColour: { label: 'Sky sun colour (RGB)', description: `Sky colour around the sun disc. ${RGB_NOTE}` },
		mfSkyHorPow: { label: 'Sky horizon power', description: 'Zenith→horizon blend exponent (retail 0.2–10).' },
		mfSkySunPow: { label: 'Sky sun power', description: 'Sun-glow concentration exponent — higher = tighter glow (retail 1.8–50).' },
		mfSkyDrk: { label: 'Sky darkening', description: 'Sky darkening factor.' },
		mfSkyHorBleedScl: { label: 'Sky horizon bleed scale', description: 'How far the horizon colour bleeds up the dome.' },
		mfSkyHorBleedPow: { label: 'Sky horizon bleed power', description: 'Bleed falloff exponent.' },
		mfSkySunBleedPow: { label: 'Sky sun bleed power', description: 'Sun-colour bleed falloff exponent.' },
		mv3ScattTopColour: { label: 'Scattering zenith colour (RGB)', description: `In-scattering colour for upward view. ${RGB_NOTE}` },
		mv3ScattHorColour: { label: 'Scattering horizon colour (RGB)', description: `In-scattering (haze) colour toward the horizon. ${RGB_NOTE}` },
		mv3ScattSunColour: { label: 'Scattering sun colour (RGB)', description: `In-scattering colour toward the sun. ${RGB_NOTE}` },
		mfScattHorPow: { label: 'Scattering horizon power', description: 'Scattering ramp blend exponent.' },
		mfScattSunPow: { label: 'Scattering sun power', description: 'Sun-direction scattering exponent.' },
		mfScattDrk: { label: 'Scattering darkening', description: 'Scattering darkening factor.' },
		mfScattHorBleedScl: { label: 'Scattering horizon bleed scale', description: 'Horizon-colour bleed distance for the scattering ramp.' },
		mfScattHorBleedPow: { label: 'Scattering horizon bleed power', description: 'Bleed falloff exponent.' },
		mfScattSunBleedPow: { label: 'Scattering sun bleed power', description: 'Sun-colour bleed falloff exponent.' },
		mafScattDist: { label: 'Scattering distances', description: 'Near/far in-scattering fog distances in world units/metres (retail 1–2000).' },
		mfScattPow: { label: 'Scattering power', description: 'Overall distance-fog curve exponent.' },
		mfScattCap: { label: 'Scattering cap', description: 'Maximum scattering opacity, 0–1 (retail ≤ 0.93) — keeps distant geometry from fogging out completely.' },
	},
	propertyGroups: [
		{ title: 'Sky dome', properties: ['mv3SkyTopColour', 'mv3SkyHorColour', 'mv3SkySunColour', 'mfSkyHorPow', 'mfSkySunPow', 'mfSkyDrk', 'mfSkyHorBleedScl', 'mfSkyHorBleedPow', 'mfSkySunBleedPow'] },
		{ title: 'In-scattering', properties: ['mv3ScattTopColour', 'mv3ScattHorColour', 'mv3ScattSunColour', 'mfScattHorPow', 'mfScattSunPow', 'mfScattDrk', 'mfScattHorBleedScl', 'mfScattHorBleedPow', 'mfScattSunBleedPow', 'mafScattDist', 'mfScattPow', 'mfScattCap'] },
	],
};

const EnvironmentLightingData: RecordSchema = {
	name: 'EnvironmentLightingData',
	description: 'The world light rig: key light + specular plus a six-direction ambient fill cube (right/left/up/down and key/shadow side). This is what makes noon look different from dusk on geometry.',
	fields: {
		mv3KeyLightColour: vec3(),
		mv3SpecularColour: vec3(),
		mv3KeyFillColour: vec3(),
		mv3ShadowFillColour: vec3(),
		mv3RightFillColour: vec3(),
		mv3LeftFillColour: vec3(),
		mv3UpFillColour: vec3(),
		mv3DownFillColour: vec3(),
		mfAmbientIrradianceScale: f32(),
	},
	fieldMetadata: {
		mv3KeyLightColour: { label: 'Key light colour (RGB)', description: `Directional sun/moon light colour. ${RGB_NOTE}` },
		mv3SpecularColour: { label: 'Specular colour (RGB)', description: `Specular highlight tint. ${RGB_NOTE}` },
		mv3KeyFillColour: { label: 'Key-side fill (RGB)', description: `Ambient fill from the key-light direction. ${RGB_NOTE} Retail fills reach ≈3.5.` },
		mv3ShadowFillColour: { label: 'Shadow-side fill (RGB)', description: `Ambient fill opposite the key light. ${RGB_NOTE}` },
		mv3RightFillColour: { label: 'Right fill (RGB)', description: `Ambient fill from +X. ${RGB_NOTE}` },
		mv3LeftFillColour: { label: 'Left fill (RGB)', description: `Ambient fill from -X. ${RGB_NOTE}` },
		mv3UpFillColour: { label: 'Up fill (RGB)', description: `Ambient fill from above (sky bounce). ${RGB_NOTE}` },
		mv3DownFillColour: { label: 'Down fill (RGB)', description: `Ambient fill from below (ground bounce — the brightest fill in retail, up to ≈3.5). ${RGB_NOTE}` },
		mfAmbientIrradianceScale: { label: 'Ambient irradiance scale', description: 'Master scale on the fill cube (retail 0.11–0.58).' },
	},
	propertyGroups: [
		{ title: 'Direct light', properties: ['mv3KeyLightColour', 'mv3SpecularColour'] },
		{ title: 'Ambient fill cube', properties: ['mv3KeyFillColour', 'mv3ShadowFillColour', 'mv3RightFillColour', 'mv3LeftFillColour', 'mv3UpFillColour', 'mv3DownFillColour', 'mfAmbientIrradianceScale'] },
	],
};

const EnvironmentCloudsData: RecordSchema = {
	name: 'EnvironmentCloudsData',
	description: 'Two scrolling cloud layers. Every array here is fixed at 2 entries — index 0 is layer 0, index 1 is layer 1 (a season can disable a layer by zeroing its opacity/colours).',
	fields: {
		mav3LayerLiteColour: cloudLayerColours(),
		mav3LayerDarkColour: cloudLayerColours(),
		mafLayerDensity: fixedF32Pair(),
		mafLayerFeathering: fixedF32Pair(),
		mafLayerOpacity: fixedF32Pair(),
		mafLayerSpeed: fixedF32Pair(),
		mafLayerScale: fixedF32Pair(),
		mfDirectionAngle: f32(),
	},
	fieldMetadata: {
		mav3LayerLiteColour: { label: 'Lit colour per layer (RGB)', description: `Sun-facing cloud colour for layers 0/1. ${RGB_NOTE}` },
		mav3LayerDarkColour: { label: 'Dark colour per layer (RGB)', description: `Shadowed cloud colour for layers 0/1. ${RGB_NOTE}` },
		mafLayerDensity: { label: 'Density per layer', description: 'Cloud coverage 0–1 per layer.' },
		mafLayerFeathering: { label: 'Feathering per layer', description: 'Edge softness per layer (retail 0.1–1.1).' },
		mafLayerOpacity: { label: 'Opacity per layer', description: 'Layer opacity 0–1; 0 disables the layer.' },
		mafLayerSpeed: { label: 'Speed per layer', description: 'Scroll speed per layer (retail 3–30).' },
		mafLayerScale: { label: 'Scale per layer', description: 'Texture scale per layer (retail 1–7000).' },
		mfDirectionAngle: { label: 'Drift direction', description: 'Cloud drift direction in degrees (retail 0–100).' },
	},
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedEnvironmentKeyframe: RecordSchema = {
	name: 'ParsedEnvironmentKeyframe',
	description: 'Root record for the Environment Keyframe resource (0x10012): the complete environment look at one time of day. The EnvironmentTimeLine (0x10013) in the same bundle schedules and interpolates between these.',
	fields: {
		muVersion: u32(),
		mColourCubeId: resourceId(),
		mBloomData: record('EnvironmentBloomData'),
		mVignetteData: record('EnvironmentVignetteData'),
		mScatteringData: record('EnvironmentScatteringData'),
		mLightingData: record('EnvironmentLightingData'),
		mCloudsData: record('EnvironmentCloudsData'),
	},
	fieldMetadata: {
		muVersion: {
			label: 'Version',
			description: 'Format version — 8 in every retail resource; the writer rejects anything else.',
			readOnly: true,
		},
		mColourCubeId: {
			label: 'Colour cube',
			description: 'Resource id of the ColourCube (0x50) post-process tint texture, referenced via the inline import table (the on-disk TintData pointer is 0 until load). Ids are crc32 of the lowercased debug name; the cube lives in the season\'s ColourCubes bundle, not this one.',
		},
		mBloomData: { label: 'Bloom' },
		mVignetteData: { label: 'Vignette' },
		mScatteringData: { label: 'Sky & scattering' },
		mLightingData: { label: 'Lighting rig' },
		mCloudsData: { label: 'Cloud layers' },
	},
	propertyGroups: [
		{ title: 'Post-processing', properties: ['mBloomData', 'mVignetteData', 'mColourCubeId'] },
		{ title: 'Atmosphere', properties: ['mScatteringData', 'mCloudsData'] },
		{ title: 'Lighting', properties: ['mLightingData'] },
		{ title: 'Format', properties: ['muVersion'] },
	],
};

const registry: SchemaRegistry = {
	ParsedEnvironmentKeyframe,
	EnvironmentBloomData,
	EnvironmentVignetteData,
	EnvironmentScatteringData,
	EnvironmentLightingData,
	EnvironmentCloudsData,
};

export const environmentKeyframeResourceSchema: ResourceSchema = {
	key: 'environmentKeyframe',
	name: 'Environment Keyframe',
	rootType: 'ParsedEnvironmentKeyframe',
	registry,
};

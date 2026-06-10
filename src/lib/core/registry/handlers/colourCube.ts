// ColourCube registry handler — thin wrapper around parseColourCube /
// writeColourCube in src/lib/core/colourCube.ts.
//
// Every ENVIRONMENTSETTINGS/COLOURCUBES bundle carries exactly one 0x2B
// resource, so no picker config. All four retail DLC24HR fixtures hold the
// SAME byte-identical payload (the 1.6-update "default RGB CLUT") — the
// stress scenarios below are therefore the only thing exercising non-default
// cube contents until a graded fixture shows up.

import {
	parseColourCube,
	writeColourCube,
	colourCubeTexel,
	setColourCubeTexel,
	type ParsedColourCube,
} from '../../colourCube';
import type { ResourceHandler } from '../handler';

// A texel value no retail ramp produces (the default CLUT is separable, so
// any cross-channel value proves the mutation actually landed).
const STRESS_RGB = { r: 12, g: 200, b: 34 };

export const colourCubeHandler: ResourceHandler<ParsedColourCube> = {
	typeId: 0x2b,
	key: 'colourCube',
	name: 'Colour Cube',
	description: 'A 3D colour look-up table (CLUT) that grades and tone-maps the whole frame — EnvironmentSettings / PostFX feed each rendered pixel\'s RGB through it (R indexes X, G indexes Y, B indexes Z); 32×32×32 RGB24 texels in retail',
	category: 'Graphics',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Colour_Cube',

	parseRaw(raw, ctx) {
		return parseColourCube(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeColourCube(model, ctx.littleEndian);
	},
	describe(model) {
		return `${model.mSize}x${model.mSize}x${model.mSize} RGB24 CLUT, ${model.pixels.byteLength} texel bytes`;
	},

	fixtures: [
		// All four payloads are byte-identical (verified by sha256 in the gold
		// suite) — kept anyway so a regression in any one bundle's container
		// (compression, debug data) still surfaces per-file.
		{ bundle: 'example/ENVIRONMENTSETTINGS/COLOURCUBES/000_DLC24HR_FOG_A.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/ENVIRONMENTSETTINGS/COLOURCUBES/000_DLC24HR_JUNKYARDT.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/ENVIRONMENTSETTINGS/COLOURCUBES/000_DLC24HR_OC_A.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/ENVIRONMENTSETTINGS/COLOURCUBES/000_DLC24HR_SUN_A.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.mSize !== before.mSize) problems.push(`mSize ${after.mSize} != ${before.mSize}`);
				if (after.pixels.byteLength !== before.pixels.byteLength) {
					problems.push(`pixel bytes ${after.pixels.byteLength} != ${before.pixels.byteLength}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-texel',
			description: 'recolour one interior texel and verify it survives round-trip without disturbing a far corner',
			mutate: (m) => {
				setColourCubeTexel(m, 1, 2, 3, STRESS_RGB);
				return m;
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const got = colourCubeTexel(afterReparse, 1, 2, 3);
				if (got.r !== STRESS_RGB.r || got.g !== STRESS_RGB.g || got.b !== STRESS_RGB.b) {
					problems.push(`texel (1,2,3) = (${got.r},${got.g},${got.b}), expected (${STRESS_RGB.r},${STRESS_RGB.g},${STRESS_RGB.b})`);
				}
				const s = afterMutate.mSize - 1;
				const far = colourCubeTexel(afterReparse, s, s, s);
				const farBefore = colourCubeTexel(afterMutate, s, s, s);
				if (far.r !== farBefore.r || far.g !== farBefore.g || far.b !== farBefore.b) {
					problems.push(`far corner texel changed to (${far.r},${far.g},${far.b})`);
				}
				return problems;
			},
		},
		{
			name: 'invert-red-channel',
			description: 'invert every texel\'s red output (a real-world grading edit) and verify a sample texel',
			mutate: (m) => {
				for (let i = 0; i < m.pixels.byteLength; i += 3) m.pixels[i] = 255 - m.pixels[i];
				return m;
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const s = afterReparse.mSize - 1;
				for (const [x, y, z] of [[0, 0, 0], [s, 0, 0], [s, s, s]] as const) {
					const want = colourCubeTexel(afterMutate, x, y, z);
					const got = colourCubeTexel(afterReparse, x, y, z);
					if (got.r !== want.r || got.g !== want.g || got.b !== want.b) {
						problems.push(`texel (${x},${y},${z}) = (${got.r},${got.g},${got.b}), expected (${want.r},${want.g},${want.b})`);
					}
				}
				return problems;
			},
		},
		{
			name: 'neutralize-to-linear-identity',
			description: 'overwrite the cube with a linear identity CLUT (texel = linearly scaled coordinate) and verify the corners come back pure',
			mutate: (m) => {
				const s = m.mSize;
				const ramp = (i: number) => Math.round((i * 255) / (s - 1));
				for (let z = 0; z < s; z++) {
					for (let y = 0; y < s; y++) {
						for (let x = 0; x < s; x++) {
							setColourCubeTexel(m, x, y, z, { r: ramp(x), g: ramp(y), b: ramp(z) });
						}
					}
				}
				return m;
			},
			verify: (_afterMutate, afterReparse) => {
				const problems: string[] = [];
				const s = afterReparse.mSize - 1;
				const expectCorner = (x: number, y: number, z: number, want: [number, number, number]) => {
					const got = colourCubeTexel(afterReparse, x, y, z);
					if (got.r !== want[0] || got.g !== want[1] || got.b !== want[2]) {
						problems.push(`corner (${x},${y},${z}) = (${got.r},${got.g},${got.b}), expected (${want.join(',')})`);
					}
				};
				expectCorner(0, 0, 0, [0, 0, 0]);
				expectCorner(s, 0, 0, [255, 0, 0]);
				expectCorner(0, s, 0, [0, 255, 0]);
				expectCorner(0, 0, s, [0, 0, 255]);
				expectCorner(s, s, s, [255, 255, 255]);
				return problems;
			},
		},
	],
};

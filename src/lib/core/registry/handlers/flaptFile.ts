// FlaptFile registry handler — thin wrapper around parseFlaptFile /
// writeFlaptFile in src/lib/core/flaptFile.ts.
//
// FLAPTHUD.BUNDLE carries exactly one 0x10020 resource (the whole in-game
// HUD), so no picker config. The payload is preserved verbatim and writes are
// in-place patches — see the core file's header for why pointers buried in
// the un-decoded timeline data forbid layout shifts. The inline import table
// binds mpapTextures slots to the bundle's 52 sibling Texture (0x0) pages.

import {
	parseFlaptFile,
	writeFlaptFile,
	flaptFileImportTable,
	countFlaptTextureImports,
	type ParsedFlaptFile,
} from '../../flaptFile';
import type { ResourceHandler } from '../handler';

function firstImportedSlot(model: ParsedFlaptFile): number {
	return model.textures.findIndex((t) => t.resourceId != null);
}

export const flaptFileHandler: ResourceHandler<ParsedFlaptFile> = {
	typeId: 0x10020,
	key: 'flaptFile',
	name: 'Flapt File',
	description: 'The in-game HUD — a Flash-derived GUI ("Friends List Apt") with movie clips, 2D vertices, font styles, the HUD string table, component index paths, and texture-slot imports binding the bundle\'s sibling Texture resources',
	category: 'Graphics',
	caps: { read: true, write: true },
	// Reads decode the header arrays (clips, verts, fonts, strings, components,
	// triggers, imports) but not the 1.2 MB of timeline sub-data the clip
	// pointers reach into. Writes are honest-but-narrow: fixed-width in-place
	// patches only (frame time, vertices, font colour/height, texture
	// retargets) — anything that would move bytes is rejected.
	capabilityOverrides: { read: 'partial', write: 'partial' },
	wikiUrl: 'https://burnout.wiki/wiki/Flapt_File',
	notes: 'Every pointer is a payload-absolute offset (including inside un-decoded timeline data), so the payload is preserved verbatim and writes patch fixed-width fields in place. Strings, clip structure, and counts are read-only.',

	parseRaw(raw, ctx) {
		return parseFlaptFile(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeFlaptFile(model, ctx.littleEndian);
	},
	importTable(payload, ctx) {
		return flaptFileImportTable(payload, ctx.littleEndian);
	},
	describe(model) {
		const named = model.movieClips.filter((c) => c.componentName != null).length;
		return `${model.movieClips.length} movie clips (${named} named), ${model.vertices.length} verts, `
			+ `${model.fontStyles.length} font styles, ${model.strings.length} strings, `
			+ `${countFlaptTextureImports(model)} texture imports (+${model.specialTextureNames.length} special), `
			+ `${model.components.length} components @ ${(1 / model.mfTimePerFrame).toFixed(0)} fps`;
	},

	// Random structural mutations legitimately violate the patch-writer's
	// fixed-count invariants; those rejections are expected, not crashes. The
	// `_payload missing` pattern covers the CLI's JSON-based clone, which
	// cannot preserve a Uint8Array field.
	fuzz: {
		tolerateErrors: [
			/length \d+ != payload's \d+/,
			/_payload missing/,
			/resourceId is null/,
			/cannot carry a resourceId/,
		],
	},

	fixtures: [
		{ bundle: 'example/FLAPTHUD.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the patch-writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.movieClips.length !== before.movieClips.length) {
					problems.push(`clip count ${after.movieClips.length} != ${before.movieClips.length}`);
				}
				if (countFlaptTextureImports(after) !== countFlaptTextureImports(before)) {
					problems.push(`import count ${countFlaptTextureImports(after)} != ${countFlaptTextureImports(before)}`);
				}
				if (after.strings.length !== before.strings.length) {
					problems.push(`string count ${after.strings.length} != ${before.strings.length}`);
				}
				return problems;
			},
		},
		{
			name: 'retime',
			description: 'change the global frame time to 60 fps',
			mutate: (m) => ({ ...m, mfTimePerFrame: Math.fround(1 / 60) }),
			verify: (afterMutate, afterReparse) =>
				afterReparse.mfTimePerFrame === afterMutate.mfTimePerFrame
					? []
					: [`mfTimePerFrame ${afterReparse.mfTimePerFrame}, expected ${afterMutate.mfTimePerFrame}`],
		},
		{
			name: 'move-vertex',
			description: 'translate the first vertex and tint it',
			mutate: (m) => {
				const v = m.vertices[0];
				v.mv2Pos = { x: v.mv2Pos.x + 5, y: v.mv2Pos.y + 7 };
				v.mColour = 0x12345678;
				return m;
			},
			verify: (afterMutate, afterReparse) => {
				const a = afterMutate.vertices[0];
				const b = afterReparse.vertices[0];
				const problems: string[] = [];
				if (a.mv2Pos.x !== b.mv2Pos.x || a.mv2Pos.y !== b.mv2Pos.y) {
					problems.push(`vertex pos (${b.mv2Pos.x}, ${b.mv2Pos.y}), expected (${a.mv2Pos.x}, ${a.mv2Pos.y})`);
				}
				if (b.mColour !== 0x12345678) problems.push(`mColour 0x${b.mColour.toString(16)}, expected 0x12345678`);
				return problems;
			},
		},
		{
			name: 'recolour-font',
			description: 'tint the first font style and bump its height',
			mutate: (m) => {
				m.fontStyles[0].muColour = 0xdeadbeef;
				m.fontStyles[0].mfFontHeight = 42;
				return m;
			},
			verify: (afterMutate, afterReparse) => {
				const got = afterReparse.fontStyles[0];
				const problems: string[] = [];
				if (got.muColour !== 0xdeadbeef) problems.push(`muColour 0x${got.muColour.toString(16)}, expected 0xdeadbeef`);
				if (got.mfFontHeight !== 42) problems.push(`mfFontHeight ${got.mfFontHeight}, expected 42`);
				if (got.fontName !== afterMutate.fontStyles[0].fontName) problems.push(`fontName drifted to '${got.fontName}'`);
				return problems;
			},
		},
		{
			name: 'retarget-texture-import',
			description: 'point the first imported texture slot at a different resource id',
			mutate: (m) => {
				const slot = firstImportedSlot(m);
				if (slot >= 0) m.textures[slot].resourceId = 0xdeadbeefn;
				return m;
			},
			verify: (afterMutate, afterReparse) => {
				const slot = firstImportedSlot(afterMutate);
				if (slot < 0) return [];
				const got = afterReparse.textures[slot].resourceId;
				return got === 0xdeadbeefn ? [] : [`textures[${slot}].resourceId 0x${got?.toString(16)}, expected 0xdeadbeef`];
			},
		},
	],
};

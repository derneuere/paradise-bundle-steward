// AptData registry handler — thin wrapper around parseAptData / writeAptData
// in src/lib/core/aptData.ts.
//
// Each GUIAPT bundle carries exactly one AptData resource (391 in retail), so
// no picker config. The Apt movie itself (characters, frames, ActionScript)
// is preserved as a verbatim blob — see the core file's header for the
// structural layer this handler does decode, and how the inline import table
// binds textured meshes to the bundle's sibling Texture (0x0) resources.

import {
	parseAptData,
	writeAptData,
	aptDataImportTable,
	countAptTextureImports,
	APT_TEXTURE_MODE_VECTOR,
	type ParsedAptData,
	type AptGuiMesh,
} from '../../aptData';
import type { ResourceHandler } from '../handler';

function firstMeshPath(model: ParsedAptData): { f: number; m: number } | null {
	for (let f = 0; f < model.geometryFiles.length; f++) {
		if (model.geometryFiles[f].meshes.length > 0) return { f, m: 0 };
	}
	return null;
}

function firstTexturedMesh(model: ParsedAptData): AptGuiMesh | null {
	for (const file of model.geometryFiles) {
		for (const mesh of file.meshes) {
			if (mesh.miTextureMode !== APT_TEXTURE_MODE_VECTOR) return mesh;
		}
	}
	return null;
}

export const aptDataHandler: ResourceHandler<ParsedAptData> = {
	typeId: 0x1e,
	key: 'aptData',
	name: 'Apt Data',
	description: 'EA\'s Flash-derived UI movie (Apt 2.03.00) — component names, the opaque Apt character/ActionScript blob, the constant file, and the 2D render geometry whose textured meshes import the bundle\'s sibling Texture resources',
	category: 'Graphics',
	caps: { read: true, write: true },
	// The structural layer (header, names, constants, geometry, imports) is
	// fully decoded; the Apt movie itself stays a verbatim blob, so reads are
	// honest-but-partial. Writes are safe: every offset is recomputed and the
	// blob's internal pointers are section-relative.
	capabilityOverrides: { read: 'partial' },
	wikiUrl: 'https://burnout.wiki/wiki/Apt_Data',
	notes: 'The Apt movie (display list + ActionScript bytecode) is preserved verbatim, not decoded — edit names, geometry vertices, and texture retargets; use Apt Player for movie authoring.',

	parseRaw(raw, ctx) {
		return parseAptData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeAptData(model, ctx.littleEndian);
	},
	importTable(payload, ctx) {
		return aptDataImportTable(payload, ctx.littleEndian);
	},
	describe(model) {
		const meshes = model.geometryFiles.reduce((n, f) => n + f.meshes.length, 0);
		return `'${model.movieName}', ${model.geometryFiles.length} geometry files, ${meshes} meshes (${countAptTextureImports(model)} textured), apt movie ${model._aptData.length} bytes`;
	},

	fixtures: [
		// B5ALWAYSAVAILABLECONTAINER is the geometry-less shape (0 files, 0
		// imports, 256-byte payload); the mesh/texture scenarios below no-op on
		// it by design. B5BIKEICONS is the only fixture whose base component
		// name ('B5CarsIcon') differs from its movie name.
		{ bundle: 'example/GUIAPT/B5ACHIEVEMENTICONS.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/GUIAPT/B5ACHIEVEMENTPOPUPCOMPONENT.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/GUIAPT/B5ALWAYSAVAILABLECONTAINER.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/GUIAPT/B5BIKEICONS.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.movieName !== before.movieName) problems.push(`movieName '${after.movieName}' != '${before.movieName}'`);
				if (after.geometryFiles.length !== before.geometryFiles.length) {
					problems.push(`geometry file count ${after.geometryFiles.length} != ${before.geometryFiles.length}`);
				}
				if (countAptTextureImports(after) !== countAptTextureImports(before)) {
					problems.push(`import count ${countAptTextureImports(after)} != ${countAptTextureImports(before)}`);
				}
				return problems;
			},
		},
		{
			name: 'rename-movie',
			description: 'lengthen the movie name — every later section and pointer must shift and survive re-parse',
			mutate: (m) => ({ ...m, movieName: m.movieName + '_RENAMED' }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.movieName !== afterMutate.movieName) {
					problems.push(`movieName '${afterReparse.movieName}', expected '${afterMutate.movieName}'`);
				}
				if (afterReparse.baseName !== afterMutate.baseName) problems.push(`baseName drifted to '${afterReparse.baseName}'`);
				if (afterReparse._aptData.length !== afterMutate._aptData.length) {
					problems.push(`apt blob ${afterReparse._aptData.length} bytes != ${afterMutate._aptData.length}`);
				}
				if (countAptTextureImports(afterReparse) !== countAptTextureImports(afterMutate)) {
					problems.push('textured-mesh/import pairing broke across the rename');
				}
				return problems;
			},
		},
		{
			name: 'edit-vertex-position',
			description: 'translate the first mesh\'s first vertex; no-ops on geometry-less movies',
			mutate: (m) => {
				const at = firstMeshPath(m);
				if (!at) return m;
				const v = m.geometryFiles[at.f].meshes[at.m].vertices[0];
				v.mv2Pos = { x: v.mv2Pos.x + 5, y: v.mv2Pos.y + 7 };
				return m;
			},
			verify: (afterMutate, afterReparse) => {
				const at = firstMeshPath(afterMutate);
				if (!at) return [];
				const a = afterMutate.geometryFiles[at.f].meshes[at.m].vertices[0].mv2Pos;
				const b = afterReparse.geometryFiles[at.f].meshes[at.m].vertices[0].mv2Pos;
				return a.x === b.x && a.y === b.y ? [] : [`vertex pos (${b.x}, ${b.y}), expected (${a.x}, ${a.y})`];
			},
		},
		{
			name: 'recolour-vertex',
			description: 'set the first vertex colour to a sentinel RGBA8; no-ops on geometry-less movies',
			mutate: (m) => {
				const at = firstMeshPath(m);
				if (!at) return m;
				m.geometryFiles[at.f].meshes[at.m].vertices[0].mColour = 0x12345678;
				return m;
			},
			verify: (afterMutate, afterReparse) => {
				const at = firstMeshPath(afterMutate);
				if (!at) return [];
				const got = afterReparse.geometryFiles[at.f].meshes[at.m].vertices[0].mColour;
				return got === 0x12345678 ? [] : [`mColour 0x${got.toString(16)}, expected 0x12345678`];
			},
		},
		{
			name: 'retarget-texture-import',
			description: 'point the first textured mesh at a different texture id and verify it lands in the inline import entry; no-ops on untextured movies',
			mutate: (m) => {
				const mesh = firstTexturedMesh(m);
				if (mesh) mesh.textureResourceId = 0xdeadbeefn;
				return m;
			},
			verify: (afterMutate, afterReparse) => {
				if (!firstTexturedMesh(afterMutate)) return [];
				const got = firstTexturedMesh(afterReparse)?.textureResourceId;
				return got === 0xdeadbeefn ? [] : [`textureResourceId 0x${got?.toString(16)}, expected 0xdeadbeef`];
			},
		},
	],
};

// TextureNameMap registry handler — thin wrapper around parseTextureNameMap /
// writeTextureNameMap in src/lib/core/textureNameMap.ts.
//
// One map per particles bundle (no picker needed). It carries no imports —
// the string table is self-contained, so there is no importTable() hook. The
// hash field of each entry is derived from the GDB URI (FNV-1a of the bare
// texture name, lowercased); mutations must keep the pair in sync, which the
// schema layer does via a derive hook.

import {
	parseTextureNameMap,
	writeTextureNameMap,
	hashLionTextureName,
	lionTextureName,
	type ParsedTextureNameMap,
} from '../../textureNameMap';
import type { ResourceHandler } from '../handler';

// Long enough to force the string into a bigger 16-byte slot than any retail
// entry occupies, so 'rename-texture' provably moves every later string.
const STRESS_RENAME_URI =
	'gamedb://burnout5/Burnout/Effects/Textures/StewardStressRenameTexture_WithALongerNameThanRetail.TextureConfig2d?ID=999999';

export const textureNameMapHandler: ResourceHandler<ParsedTextureNameMap> = {
	typeId: 0x1000b,
	key: 'textureNameMap',
	name: 'Texture Name Map',
	description: 'The particles bundle\'s texture string table — maps the FNV-1a hash of a Lion texture name (how particle materials reference textures) to the full gamedb TextureConfig2d URI the engine loads',
	category: 'Graphics',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Texture_Name_Map',
	notes: 'Each entry\'s hash is FNV-1a (lowercased) of the URI\'s bare basename — "SparkBlast.TextureConfig2d?ID=245985" hashes as "sparkblast". The editor re-derives it when the URI is edited.',

	parseRaw(raw, ctx) {
		return parseTextureNameMap(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeTextureNameMap(model, ctx.littleEndian);
	},
	describe(model) {
		return `${model.entries.length} texture name${model.entries.length === 1 ? '' : 's'}`;
	},

	fixtures: [
		// The hash↔name derivation across all 50 retail entries is pinned in
		// __tests__/textureNameMap.test.ts.
		{ bundle: 'example/PARTICLES.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) =>
				after.entries.length === before.entries.length
					? []
					: [`entry count ${after.entries.length} != ${before.entries.length}`],
		},
		{
			name: 'rename-texture',
			description: 'replace entry 0\'s URI with a longer one (hash kept in sync) — every later string slot must shift and reparse cleanly',
			mutate: (m) => {
				const entries = m.entries.slice();
				entries[0] = {
					mGDBTextureName: STRESS_RENAME_URI,
					muHashedLionTextureName: hashLionTextureName(STRESS_RENAME_URI),
				};
				return { ...m, entries };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const got = afterReparse.entries[0];
				if (got.mGDBTextureName !== STRESS_RENAME_URI) {
					problems.push(`renamed URI did not survive: "${got.mGDBTextureName}"`);
				}
				if (got.muHashedLionTextureName !== hashLionTextureName(STRESS_RENAME_URI)) {
					problems.push(`hash 0x${got.muHashedLionTextureName.toString(16)} is not FNV-1a("${lionTextureName(STRESS_RENAME_URI)}")`);
				}
				const last = afterReparse.entries[afterReparse.entries.length - 1];
				const wantLast = afterMutate.entries[afterMutate.entries.length - 1];
				if (last.mGDBTextureName !== wantLast.mGDBTextureName) {
					problems.push('final entry\'s string was corrupted by the slot shift');
				}
				return problems;
			},
		},
		{
			name: 'append-entry',
			description: 'append a hash-consistent entry; counts and the new string must survive the round-trip',
			mutate: (m) => ({
				...m,
				entries: [
					...m.entries,
					{ mGDBTextureName: STRESS_RENAME_URI, muHashedLionTextureName: hashLionTextureName(STRESS_RENAME_URI) },
				],
			}),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.entries.length !== afterMutate.entries.length) {
					problems.push(`entry count ${afterReparse.entries.length} != ${afterMutate.entries.length}`);
				}
				const last = afterReparse.entries[afterReparse.entries.length - 1];
				if (last.mGDBTextureName !== STRESS_RENAME_URI) {
					problems.push(`appended URI did not survive: "${last.mGDBTextureName}"`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-entry',
			// Removing from the FRONT would also work, but the tail is the only
			// position whose removal leaves every other slot offset unchanged —
			// a cleaner probe for off-by-one slot math.
			description: 'drop the final entry; the string region must shrink consistently',
			mutate: (m) => ({ ...m, entries: m.entries.slice(0, -1) }),
			verify: (afterMutate, afterReparse) =>
				afterReparse.entries.length === afterMutate.entries.length
					? []
					: [`entry count ${afterReparse.entries.length} != ${afterMutate.entries.length}`],
		},
	],
};

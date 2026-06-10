// Registry (0xA000) handler — thin wrapper around parseRegistry /
// writeRegistry in src/lib/core/soundRegistry.ts. (The core file avoids the
// name registry.ts because `src/lib/core/registry` is this folder; the
// handler key stays 'registry', matching the wiki type name.)
//
// Retail bundles can carry many registries — SOUND/AEMS/CSIS.BUNDLE packs 30
// (a *CsisEntityReg / *CsisVoiceReg / *CsisFactoryReg trio per AEMS effect
// group: Boost, Traffic, Skids, Horns, …) — so a picker config is included.
// The fixture harness only exercises the first resource per bundle; the gold
// suite in __tests__/soundRegistry.test.ts sweeps all 30.

import {
	makeEmptyRegistryEntity,
	parseRegistry,
	writeRegistry,
	soundHash,
	REGISTRY_TYPE_HASHES,
	REGISTRY_TYPE_LABELS,
	type ParsedRegistry,
	type RegistryEntity,
} from '../../soundRegistry';
import type { PickerEntry, ResourceHandler } from '../handler';

function kindHistogram(entities: RegistryEntity[]): string {
	const counts = new Map<string, number>();
	for (const e of entities) {
		const label = REGISTRY_TYPE_LABELS[e.mTypeName] ?? `0x${e.mTypeName.toString(16)}`;
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return [...counts.entries()].map(([k, n]) => `${n} ${k}`).join(', ');
}

function compareByName(a: PickerEntry<ParsedRegistry>, b: PickerEntry<ParsedRegistry>): number {
	return a.ctx.name.localeCompare(b.ctx.name, undefined, { numeric: true });
}

export const registryHandler: ResourceHandler<ParsedRegistry> = {
	typeId: 0xa000,
	key: 'registry',
	name: 'Registry',
	description: 'Sound entity registry (CgsSound::Playback::Registry) — a name-hash table mapping sound entities to content classes/types, voice slots, parameter/feature schemas, and RWAC DSP feature implementations',
	category: 'Audio',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Registry',
	notes: 'All nine retail entity kinds decode (validated against PLAYBACKREGISTRY, RWACFEATUREREGISTRY, SOUNDENTITY, and the 30 registries in SOUND/AEMS/CSIS.BUNDLE); any still-unknown type name round-trips as a verbatim payload blob.',

	parseRaw(raw, ctx) {
		return parseRegistry(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeRegistry(model, ctx.littleEndian);
	},
	describe(model) {
		return `${model.entities.length} entities (${kindHistogram(model.entities)}), ${model.strings.length} strings`;
	},

	picker: {
		labelOf(model, { name }) {
			if (model == null) {
				return {
					primary: name,
					secondary: 'parse failed',
					badges: [{ label: 'parse failed', tone: 'warn' }],
				};
			}
			if (model.entities.length === 0) {
				return { primary: name, secondary: 'no entities', badges: [{ label: 'empty', tone: 'muted' }] };
			}
			return {
				primary: name,
				secondary: `${model.entities.length} entit${model.entities.length === 1 ? 'y' : 'ies'} · ${model.strings.length} strings`,
			};
		},
		sortKeys: [
			{ id: 'name', label: 'Name (A→Z)', compare: compareByName },
			{ id: 'index', label: 'Bundle order', compare: (a, b) => a.ctx.index - b.ctx.index },
			{
				id: 'entities-desc',
				label: 'Entity count (high→low)',
				compare: (a, b) => (b.model?.entities.length ?? -1) - (a.model?.entities.length ?? -1),
			},
		],
		defaultSort: 'name',
	},

	fixtures: [
		// Deliberately different shapes: PLAYBACK mixes five payload kinds;
		// RWAC is all GenericRwacFeatureImplementation with 0xCD uninitialised
		// fills that must survive verbatim; SOUNDENTITY adds the string-
		// carrying ContentSpec plus VoiceSchema/VoiceSpec; CSIS adds the
		// wiki-undocumented AemsVoiceCsisClass. Per-kind payload edits live in
		// __tests__/soundRegistry.test.ts — the scenarios below only mutate
		// shapes every fixture supports (names, entity list, string pool).
		{ bundle: 'example/PLAYBACKREGISTRY.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/RWACFEATUREREGISTRY.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/SOUND/SOUNDENTITY.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/SOUND/AEMS/CSIS.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.entities.length !== before.entities.length) {
					problems.push(`entity count ${after.entities.length} != ${before.entities.length}`);
				}
				if (after.strings.length !== before.strings.length) {
					problems.push(`string count ${after.strings.length} != ${before.strings.length}`);
				}
				return problems;
			},
		},
		{
			name: 'rename-first-entity',
			description: 'change entities[0].mName — the hash table must be rebuilt around the new home slot',
			mutate: (m) => {
				const entities = m.entities.slice();
				entities[0] = { ...entities[0], mName: soundHash('StewardStressName') };
				return { ...m, entities };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.entities[0]?.mName !== soundHash('StewardStressName')) {
					problems.push(`entities[0].mName = 0x${afterReparse.entities[0]?.mName.toString(16)}`);
				}
				if (afterReparse.entities.length !== afterMutate.entities.length) {
					problems.push(`entity count ${afterReparse.entities.length} != ${afterMutate.entities.length}`);
				}
				return problems;
			},
		},
		{
			name: 'add-content-class',
			description: 'append a payload-less ContentClass entity — counts, sizes, and the slot table are re-derived',
			mutate: (m) => ({
				...m,
				entities: [...m.entities, {
					...makeEmptyRegistryEntity(),
					mName: soundHash('StewardStressClass'),
					mTypeName: REGISTRY_TYPE_HASHES.CONTENT_CLASS,
				}],
				strings: [...m.strings, 'StewardStressClass'],
			}),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const last = afterReparse.entities[afterReparse.entities.length - 1];
				if (last?.mName !== soundHash('StewardStressClass')) {
					problems.push('appended entity did not survive round-trip');
				}
				if (afterReparse.strings[afterReparse.strings.length - 1] !== 'StewardStressClass') {
					problems.push('appended string did not survive round-trip');
				}
				return problems;
			},
		},
		{
			name: 'add-content-spec',
			description: 'append a ContentSpec with an odd-length path — exercises the inline string, derived u16 length, and the recomputed 0xCD pad to 4-byte alignment',
			mutate: (m) => ({
				...m,
				entities: [...m.entities, {
					...makeEmptyRegistryEntity(),
					mName: soundHash('StewardStressSpec'),
					mTypeName: REGISTRY_TYPE_HASHES.CONTENT_SPEC,
					contentSpec: {
						mpContentType: soundHash('~GenericRwacWaveContent::SK_WAVE_DATA_CONTENT_TYPE~'),
						mu8LoadMethod: 1,
						mu8LoadTime: 1,
						path: 'gamedb://steward/Stress1.wav', // 28 chars + NUL → 3 pad bytes
						_padTail: new Uint8Array(0),
					},
				}],
				strings: [...m.strings, 'StewardStressSpec'],
			}),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const last = afterReparse.entities[afterReparse.entities.length - 1];
				if (last?.contentSpec?.path !== 'gamedb://steward/Stress1.wav') {
					problems.push('appended ContentSpec path did not survive round-trip');
				}
				if (last?.contentSpec != null
					&& (last.contentSpec._padTail.byteLength !== 3 || [...last.contentSpec._padTail].some((b) => b !== 0xcd))) {
					problems.push('recomputed pad is not 3 bytes of 0xCD fill');
				}
				return problems;
			},
		},
		{
			name: 'remove-last-entity',
			description: 'drop the final entity — data size, table, and pointers must all re-derive cleanly',
			mutate: (m) => ({ ...m, entities: m.entities.slice(0, -1) }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.entities.length !== afterMutate.entities.length) {
					problems.push(`entity count ${afterReparse.entities.length} != ${afterMutate.entities.length}`);
				}
				return problems;
			},
		},
		{
			name: 'add-string',
			description: 'append a debug string — string-table size and the 16-byte trailing pad are re-derived',
			mutate: (m) => ({ ...m, strings: [...m.strings, 'StewardStressString'] }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.strings[afterReparse.strings.length - 1] !== 'StewardStressString') {
					problems.push('appended string did not survive round-trip');
				}
				return problems;
			},
		},
	],
};

// CommsToolListDefinition registry handler — thin wrapper around
// parseCommsToolListDefinition / writeCommsToolListDefinition in
// src/lib/core/commsToolListDefinition.ts.
//
// Retail ships one definition per bundle (DOWNLOADED/GAMEPLAY.BIN carries
// exactly the 'Gameplay' definition), so no picker config is needed.

import {
	parseCommsToolListDefinition,
	writeCommsToolListDefinition,
	COMMS_VERSION_HASH_NOTES,
	type ParsedCommsToolListDefinition,
} from '../../commsToolListDefinition';
import { resolveCommsToolName } from '../../commsToolNames';
import { languageHash } from '../../languageHash';
import type { ResourceHandler } from '../handler';

function definitionLabel(model: ParsedCommsToolListDefinition): string {
	return resolveCommsToolName(model.mDefinitionNameHash)
		?? `0x${model.mDefinitionNameHash.toString(16).padStart(8, '0')}`;
}

export const commsToolListDefinitionHandler: ResourceHandler<ParsedCommsToolListDefinition> = {
	typeId: 0x45,
	key: 'commsToolListDefinition',
	name: 'Comms Tool List Definition',
	description: 'Comms Database field schema — declares the named tuning values and their byte offsets inside the Comms Tool List (0x46) payloads that reference it. The server-pushed DOWNLOADED bundles use it for live gameplay tuning',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Comms_Tool_List_Definition',
	notes: 'Field/category names are Language hashes (JAMCRC) of strings in the executable; steward resolves the wiki-catalogued ones (all 205 Gameplay fields resolve). Editing the field table desyncs sibling Comms Tool List resources, which live in other bundles.',

	parseRaw(raw, ctx) {
		return parseCommsToolListDefinition(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeCommsToolListDefinition(model, ctx.littleEndian);
	},
	describe(model) {
		const version = COMMS_VERSION_HASH_NOTES[model.mVersionHash] ?? `0x${model.mVersionHash.toString(16)}`;
		return `"${definitionLabel(model)}" definition: ${model.fields.length} fields over a ${model.mListDataLength}-byte list payload, version ${version}`;
	},

	fixtures: [
		{ bundle: 'example/DOWNLOADED/GAMEPLAY.BIN', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.fields.length !== before.fields.length) {
					problems.push(`field count ${after.fields.length} != ${before.fields.length}`);
				}
				if (after.mDefinitionNameHash !== before.mDefinitionNameHash) {
					problems.push(`definition name hash changed to 0x${after.mDefinitionNameHash.toString(16)}`);
				}
				return problems;
			},
		},
		{
			name: 'rename-field',
			description: "re-hash fields[0]'s name the way a field rename would; the hash must survive untouched neighbours",
			mutate: (m) => {
				const fields = m.fields.slice();
				fields[0] = { ...fields[0], mFieldNameHash: languageHash('STRESS_FIELD') };
				return { ...m, fields };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.fields[0].mFieldNameHash !== languageHash('STRESS_FIELD')) {
					problems.push(`fields[0] name hash 0x${afterReparse.fields[0].mFieldNameHash.toString(16)} != languageHash('STRESS_FIELD')`);
				}
				// The four chunks are parallel arrays — editing one lane must not
				// perturb the others.
				if (afterReparse.fields[0].mUnknownHash !== afterMutate.fields[0].mUnknownHash) {
					problems.push('fields[0] unknown hash changed');
				}
				if (afterReparse.fields[0].mOffset !== afterMutate.fields[0].mOffset) {
					problems.push('fields[0] offset changed');
				}
				return problems;
			},
		},
		{
			name: 'append-field',
			description: 'append a field at the payload tail and grow the list length — all four chunk pointers and both lengths are recomputed',
			mutate: (m) => ({
				...m,
				mListDataLength: m.mListDataLength + 4,
				fields: [
					...m.fields,
					{
						mUnknownHash: 0xdeadbeef,
						mCategoryNameHash: languageHash('ServerControls'),
						mFieldNameHash: languageHash('STRESS_FIELD'),
						mOffset: m.mListDataLength,
					},
				],
			}),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.fields.length !== afterMutate.fields.length) {
					problems.push(`field count ${afterReparse.fields.length} != ${afterMutate.fields.length}`);
				}
				const last = afterReparse.fields[afterReparse.fields.length - 1];
				if (last.mUnknownHash !== 0xdeadbeef) problems.push(`appended unknown hash 0x${last.mUnknownHash.toString(16)}`);
				if (last.mOffset !== afterMutate.mListDataLength - 4) problems.push(`appended offset 0x${last.mOffset.toString(16)}`);
				if (afterReparse.mListDataLength !== afterMutate.mListDataLength) {
					problems.push(`list data length ${afterReparse.mListDataLength} != ${afterMutate.mListDataLength}`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-field',
			description: 'drop the final field — chunk pointers shrink and the survivors stay aligned',
			mutate: (m) => ({ ...m, fields: m.fields.slice(0, -1) }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.fields.length !== afterMutate.fields.length) {
					problems.push(`field count ${afterReparse.fields.length} != ${afterMutate.fields.length}`);
				}
				const last = afterReparse.fields[afterReparse.fields.length - 1];
				const expected = afterMutate.fields[afterMutate.fields.length - 1];
				if (last.mFieldNameHash !== expected.mFieldNameHash || last.mOffset !== expected.mOffset) {
					problems.push('surviving final field drifted after the removal');
				}
				return problems;
			},
		},
		{
			name: 'edit-offset',
			description: "move fields[1]'s payload offset; the new value must survive and stay within the payload",
			mutate: (m) => {
				const fields = m.fields.slice();
				fields[1] = { ...fields[1], mOffset: m.mListDataLength - 1 };
				return { ...m, fields };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.fields[1].mOffset !== afterMutate.mListDataLength - 1) {
					problems.push(`fields[1] offset 0x${afterReparse.fields[1].mOffset.toString(16)} != 0x${(afterMutate.mListDataLength - 1).toString(16)}`);
				}
				return problems;
			},
		},
	],
};

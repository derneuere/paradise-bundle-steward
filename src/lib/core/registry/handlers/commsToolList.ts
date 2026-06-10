// CommsToolList registry handler — thin wrapper around parseCommsToolList /
// writeCommsToolList in src/lib/core/commsToolList.ts.
//
// The payload is opaque without the sibling CommsToolListDefinition (0x45),
// which lives in a DIFFERENT bundle (GAMEPLAYDATA.BIN's data is keyed by
// GAMEPLAY.BIN's definition) — so this handler round-trips the bytes
// verbatim and decodeCommsToolListData() in the core file is the documented
// cross-resource decode mechanism. Retail ships one list per bundle, so no
// picker config is needed.

import {
	parseCommsToolList,
	writeCommsToolList,
	type ParsedCommsToolList,
} from '../../commsToolList';
import { COMMS_VERSION_HASH_NOTES } from '../../commsToolListDefinition';
import { resolveCommsToolName } from '../../commsToolNames';
import type { ResourceHandler } from '../handler';

export const commsToolListHandler: ResourceHandler<ParsedCommsToolList> = {
	typeId: 0x46,
	key: 'commsToolList',
	name: 'Comms Tool List',
	description: 'Comms Database value payload — the actual server-pushed gameplay-tuning numbers, stored as opaque bytes whose field names/offsets live in the Comms Tool List Definition (0x45) it references by hash',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Comms_Tool_List',
	notes: 'The definition lives in a separate bundle (e.g. DOWNLOADED/GAMEPLAY.BIN for GAMEPLAYDATA.BIN), so the payload is shown raw; decodeCommsToolListData() pairs the two models for a field-level view.',

	parseRaw(raw, ctx) {
		return parseCommsToolList(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeCommsToolList(model, ctx.littleEndian);
	},
	describe(model) {
		const name = resolveCommsToolName(model.mNameHash) ?? `0x${model.mNameHash.toString(16).padStart(8, '0')}`;
		const version = COMMS_VERSION_HASH_NOTES[model.mVersionHash] ?? `0x${model.mVersionHash.toString(16)}`;
		return `"${name}" list: ${model.data.byteLength}-byte payload, version ${version}`;
	},

	fixtures: [
		{ bundle: 'example/DOWNLOADED/GAMEPLAYDATA.BIN', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.data.byteLength !== before.data.byteLength) {
					problems.push(`payload length ${after.data.byteLength} != ${before.data.byteLength}`);
				}
				if (after.mNameHash !== before.mNameHash) {
					problems.push(`name hash changed to 0x${after.mNameHash.toString(16)}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-payload-value',
			description: 'tune a value: write f32 1.5 into the first four payload bytes and verify the bytes survive',
			mutate: (m) => {
				const data = new Uint8Array(m.data);
				new DataView(data.buffer).setFloat32(0, 1.5, true);
				return { ...m, data };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				const v = new DataView(after.data.buffer, after.data.byteOffset).getFloat32(0, true);
				if (v !== 1.5) problems.push(`payload f32 at 0 reparsed as ${v}, expected 1.5`);
				return problems;
			},
		},
		{
			name: 'grow-payload',
			description: 'append 4 bytes to the payload — data length, resource size, and the trailing pad are recomputed',
			mutate: (m) => {
				const data = new Uint8Array(m.data.byteLength + 4);
				data.set(m.data);
				data.set([0xaa, 0xbb, 0xcc, 0xdd], m.data.byteLength);
				return { ...m, data };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.data.byteLength !== afterMutate.data.byteLength) {
					problems.push(`payload length ${afterReparse.data.byteLength} != ${afterMutate.data.byteLength}`);
				}
				if (afterReparse.data[afterReparse.data.byteLength - 1] !== 0xdd) {
					problems.push('appended bytes did not survive the round-trip');
				}
				return problems;
			},
		},
		{
			name: 'shrink-payload',
			description: 'truncate the payload to its first 16 bytes — sizes shrink consistently',
			mutate: (m) => ({ ...m, data: new Uint8Array(m.data.subarray(0, 16)) }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.data.byteLength !== afterMutate.data.byteLength) {
					problems.push(`payload length ${afterReparse.data.byteLength} != ${afterMutate.data.byteLength}`);
				}
				return problems;
			},
		},
		{
			name: 'retarget-definition',
			description: 'repoint the name/version hashes at a different definition — both must survive',
			mutate: (m) => ({ ...m, mNameHash: 0xb08f5f82, mVersionHash: 0xd7a6f29e }),
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.mNameHash !== 0xb08f5f82) problems.push(`name hash 0x${after.mNameHash.toString(16)} != 0xb08f5f82 (Car)`);
				if (after.mVersionHash !== 0xd7a6f29e) problems.push(`version hash 0x${after.mVersionHash.toString(16)} != 0xd7a6f29e`);
				return problems;
			},
		},
	],
};

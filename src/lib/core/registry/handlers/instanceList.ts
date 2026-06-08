// InstanceList registry handler — thin wrapper around parseInstanceList /
// writeInstanceList in src/lib/core/instanceList.ts.
//
// The low-level parser/writer live outside the registry so the registry never
// imports from src/lib/core/bundle/index.ts (which could create a cycle).

import {
	parseInstanceList,
	writeInstanceList,
	INSTANCE_LIST_TYPE_ID,
	type ParsedInstanceList,
} from '../../instanceList';
import type { ResourceHandler } from '../handler';

export const instanceListHandler: ResourceHandler<ParsedInstanceList> = {
	typeId: INSTANCE_LIST_TYPE_ID,
	key: 'instanceList',
	name: 'Instance List',
	description: 'Track-unit model placements — Models positioned in the world by a per-instance transform',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Instance_List',

	parseRaw(raw, ctx) {
		return parseInstanceList(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeInstanceList(model, ctx.littleEndian);
	},
	describe(model) {
		return `instances ${model.instances.length} (${model.muNumInstances} complete), v${model.muVersionNumber}`;
	},

	fixtures: [
		{ bundle: 'example/TRK_UNIT9_GR.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/TRK_UNIT10_GR.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
		},
		{
			name: 'edit-version',
			description: 'muVersionNumber is preserved verbatim — bump it and verify it survives untouched',
			mutate: (m) => ({ ...m, muVersionNumber: m.muVersionNumber + 7 }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.muVersionNumber !== afterMutate.muVersionNumber) {
					problems.push(`muVersionNumber ${afterReparse.muVersionNumber} != ${afterMutate.muVersionNumber}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-instance-transform',
			description: 'translate instances[0] by editing transform indices 12/13/14 (world X,Y,Z)',
			mutate: (m) => {
				const instances = m.instances.slice();
				const t = instances[0].mWorldTransform.slice();
				t[12] = 1234.5;
				t[13] = -678.25;
				t[14] = 90.125;
				instances[0] = { ...instances[0], mWorldTransform: t };
				return { ...m, instances };
			},
			verify: (_afterMutate, afterReparse) => {
				const problems: string[] = [];
				const t = afterReparse.instances[0].mWorldTransform;
				// f32 round-trip is exact for these literals (representable in binary32).
				if (t[12] !== 1234.5) problems.push(`transform[12] = ${t[12]}`);
				if (t[13] !== -678.25) problems.push(`transform[13] = ${t[13]}`);
				if (t[14] !== 90.125) problems.push(`transform[14] = ${t[14]}`);
				return problems;
			},
		},
		{
			name: 'edit-backdrop-zone',
			description: 'set instances[0].mi16BackdropZoneID to a non-sentinel zone and verify it survives',
			mutate: (m) => {
				const instances = m.instances.slice();
				instances[0] = { ...instances[0], mi16BackdropZoneID: 42 };
				return { ...m, instances };
			},
			verify: (_afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.instances[0].mi16BackdropZoneID !== 42) {
					problems.push(`mi16BackdropZoneID = ${afterReparse.instances[0].mi16BackdropZoneID}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-max-visible-distance',
			description: 'set instances[0].mfMaxVisibleDistanceSquared and verify the f32 survives',
			mutate: (m) => {
				const instances = m.instances.slice();
				instances[0] = { ...instances[0], mfMaxVisibleDistanceSquared: 65536 };
				return { ...m, instances };
			},
			verify: (_afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.instances[0].mfMaxVisibleDistanceSquared !== 65536) {
					problems.push(`mfMaxVisibleDistanceSquared = ${afterReparse.instances[0].mfMaxVisibleDistanceSquared}`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-instance',
			description: 'drop the final entry — muArraySize is recomputed from instances.length, so the count shrinks',
			mutate: (m) => ({ ...m, instances: m.instances.slice(0, -1) }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.instances.length !== afterMutate.instances.length) {
					problems.push(`instances.length ${afterReparse.instances.length} != ${afterMutate.instances.length}`);
				}
				return problems;
			},
		},
	],
};

// PropInstanceData registry handler — thin wrapper around
// parsePropInstanceData / writePropInstanceData in
// src/lib/core/propInstanceData.ts.
//
// The low-level parser/writer live outside the registry so the registry never
// imports from src/lib/core/bundle/index.ts (which could create a cycle).

import {
	parsePropInstanceData,
	writePropInstanceData,
	PROP_INSTANCE_FLAGS,
	type ParsedPropInstanceData,
} from '../../propInstanceData';
import type { ResourceHandler } from '../handler';

// A prop-type index known to exist in PROP_TYPES (247 entries) and distinct from
// any low index the fixtures happen to start with, so 'change-prop-type' actually
// changes the value. Stays well within the 26-bit type-id field.
const STRESS_TYPE_ID = 100;
// An alternative-type index used by 'set-alternative-type'. A real index (not the
// 0xFFFF "none" sentinel) so the round-trip proves a non-trivial value survives.
const STRESS_ALT_TYPE = 42;

export const propInstanceDataHandler: ResourceHandler<ParsedPropInstanceData> = {
	typeId: 0x10011,
	key: 'propInstanceData',
	name: 'Prop Instance Data',
	description: 'Props (signs, lampposts, cones, collectibles) placed into a track unit, partitioned into spatial cells for streaming',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Prop_Instance_Data',

	parseRaw(raw, ctx) {
		return parsePropInstanceData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writePropInstanceData(model, ctx.littleEndian);
	},
	describe(model) {
		return `zone ${model.muZoneId}, instances ${model.instances.length}, cells ${model.cells.length}`;
	},

	fixtures: [
		{ bundle: 'example/TRK_UNIT9_GR.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/TRK_UNIT10_GR.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
		// The empty-prop-zone shape (~40% of track units: no props, no cells,
		// null pointers) is covered by a self-contained unit test in
		// __tests__/propInstanceData.test.ts — it can't be a fixture here because
		// the stress scenarios below edit instances[0] / the last cell, which an
		// empty zone doesn't have.
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.instances.length !== before.instances.length) {
					problems.push(`instance count ${after.instances.length} != ${before.instances.length}`);
				}
				if (after.cells.length !== before.cells.length) {
					problems.push(`cell count ${after.cells.length} != ${before.cells.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-zone-id',
			description: 'change muZoneId to a marker and verify it survives round-trip',
			mutate: (m) => ({ ...m, muZoneId: 4242 }),
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.muZoneId !== 4242) {
					problems.push(`muZoneId = ${after.muZoneId}, expected 4242`);
				}
				return problems;
			},
		},
		{
			name: 'edit-instance-position',
			description: 'translate instances[0] world position (transform indices 12,13,14) and verify the new coords survive',
			mutate: (m) => {
				const instances = m.instances.slice();
				const t = instances[0].mWorldTransform.slice();
				t[12] += 100;
				t[13] += 200;
				t[14] += 300;
				instances[0] = { ...instances[0], mWorldTransform: t };
				return { ...m, instances };
			},
			verify: (before, after) => {
				const problems: string[] = [];
				const b = before.instances[0].mWorldTransform;
				const a = after.instances[0].mWorldTransform;
				// f32 is exact for these integer deltas, but compare with a tiny
				// epsilon to stay robust against round-trip float quantisation.
				if (Math.abs(a[12] - (b[12])) > 1e-3) problems.push(`pos.x = ${a[12]} (mutated to ${b[12]})`);
				if (Math.abs(a[13] - (b[13])) > 1e-3) problems.push(`pos.y = ${a[13]} (mutated to ${b[13]})`);
				if (Math.abs(a[14] - (b[14])) > 1e-3) problems.push(`pos.z = ${a[14]} (mutated to ${b[14]})`);
				return problems;
			},
		},
		{
			name: 'change-prop-type',
			description: 'set instances[0].typeId to a different valid PROP_TYPES index and verify typeId + the recombined muTypeIdAndFlags survive',
			mutate: (m) => {
				const instances = m.instances.slice();
				instances[0] = { ...instances[0], typeId: STRESS_TYPE_ID };
				return { ...m, instances };
			},
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.instances[0].typeId !== STRESS_TYPE_ID) {
					problems.push(`typeId = ${after.instances[0].typeId}, expected ${STRESS_TYPE_ID}`);
				}
				// Changing only typeId must not perturb the 6-bit flags field that
				// shares muTypeIdAndFlags — the writer recombines both.
				if (after.instances[0].flags !== before.instances[0].flags) {
					problems.push(`flags changed to 0x${after.instances[0].flags.toString(16)} (was 0x${before.instances[0].flags.toString(16)})`);
				}
				return problems;
			},
		},
		{
			name: 'toggle-disable-physics',
			description: 'set instances[0].flags |= DISABLE_PHYSICS and verify the flag bit survives in the recombined field',
			mutate: (m) => {
				const instances = m.instances.slice();
				instances[0] = {
					...instances[0],
					flags: instances[0].flags | PROP_INSTANCE_FLAGS.DISABLE_PHYSICS,
				};
				return { ...m, instances };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if ((after.instances[0].flags & PROP_INSTANCE_FLAGS.DISABLE_PHYSICS) === 0) {
					problems.push(`DISABLE_PHYSICS bit missing; flags = 0x${after.instances[0].flags.toString(16)}`);
				}
				// typeId must be untouched — it shares the packed word with flags.
				if (after.instances[0].typeId !== _before.instances[0].typeId) {
					problems.push(`typeId changed to ${after.instances[0].typeId} (was ${_before.instances[0].typeId})`);
				}
				return problems;
			},
		},
		{
			name: 'set-alternative-type',
			description: 'set instances[0].muAlternativeType to a valid PROP_TYPES index and verify it survives',
			mutate: (m) => {
				const instances = m.instances.slice();
				instances[0] = { ...instances[0], muAlternativeType: STRESS_ALT_TYPE };
				return { ...m, instances };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.instances[0].muAlternativeType !== STRESS_ALT_TYPE) {
					problems.push(`muAlternativeType = ${after.instances[0].muAlternativeType}, expected ${STRESS_ALT_TYPE}`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-instance-in-last-cell',
			description: 'drop the final instance and decrement the last cell muCount by 1 (sum(muCount) stays == instances.length)',
			mutate: (m) => {
				const instances = m.instances.slice(0, -1);
				const cells = m.cells.slice();
				const last = cells.length - 1;
				cells[last] = { ...cells[last], muCount: cells[last].muCount - 1 };
				return { ...m, instances, cells };
			},
			// The runner passes (afterMutate, afterReparse): both already carry the
			// dropped instance + decremented cell, so they must AGREE — the check
			// is that the structural mutation survived the round-trip, not that a
			// delta was re-applied.
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.instances.length !== afterMutate.instances.length) {
					problems.push(`instance count ${afterReparse.instances.length} != ${afterMutate.instances.length}`);
				}
				const lastMutate = afterMutate.cells[afterMutate.cells.length - 1];
				const lastReparse = afterReparse.cells[afterReparse.cells.length - 1];
				if (lastReparse.muCount !== lastMutate.muCount) {
					problems.push(`last cell muCount ${lastReparse.muCount} != ${lastMutate.muCount}`);
				}
				// Partition must stay contiguous and total to instances.length.
				let runningStart = 0;
				for (let i = 0; i < afterReparse.cells.length; i++) {
					if (afterReparse.cells[i].muStartIndex !== runningStart) {
						problems.push(`cell[${i}].muStartIndex ${afterReparse.cells[i].muStartIndex} != ${runningStart}`);
						break;
					}
					runningStart += afterReparse.cells[i].muCount;
				}
				if (runningStart !== afterReparse.instances.length) {
					problems.push(`sum(muCount) ${runningStart} != instances.length ${afterReparse.instances.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-cell-partition-verbatim',
			description: 'set the first cell muStartIndex / muCount to markers that disagree with the running sum and verify the writer keeps them verbatim (the partition is editable, not derived)',
			mutate: (m) => {
				if (m.cells.length === 0) return m;
				const cells = m.cells.slice();
				cells[0] = { ...cells[0], muStartIndex: 4321, muCount: 9 };
				return { ...m, cells };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.cells.length === 0) return problems;
				if (after.cells[0].muStartIndex !== 4321) {
					problems.push(`cell[0].muStartIndex = ${after.cells[0].muStartIndex}, expected 4321 (verbatim)`);
				}
				if (after.cells[0].muCount !== 9) {
					problems.push(`cell[0].muCount = ${after.cells[0].muCount}, expected 9 (verbatim)`);
				}
				return problems;
			},
		},
		{
			name: 'append-instance-to-last-cell',
			description: 'clone instances[last], push it, and increment the last cell muCount; verify the new instance and recomputed partition survive',
			mutate: (m) => {
				const lastInst = m.instances[m.instances.length - 1];
				const clone = {
					...lastInst,
					mWorldTransform: lastInst.mWorldTransform.slice(),
					muInstanceID: 0x0BADF00D,
					_pad4D: [...lastInst._pad4D] as [number, number, number],
				};
				const instances = [...m.instances, clone];
				const cells = m.cells.slice();
				const last = cells.length - 1;
				cells[last] = { ...cells[last], muCount: cells[last].muCount + 1 };
				return { ...m, instances, cells };
			},
			// The runner passes (afterMutate, afterReparse): both already carry the
			// cloned instance + incremented cell, so they must AGREE.
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.instances.length !== afterMutate.instances.length) {
					problems.push(`instance count ${afterReparse.instances.length} != ${afterMutate.instances.length}`);
				}
				const added = afterReparse.instances[afterReparse.instances.length - 1];
				if (added.muInstanceID !== 0x0BADF00D) {
					problems.push(`appended muInstanceID = 0x${added.muInstanceID.toString(16)}`);
				}
				const lastMutate = afterMutate.cells[afterMutate.cells.length - 1];
				const lastReparse = afterReparse.cells[afterReparse.cells.length - 1];
				if (lastReparse.muCount !== lastMutate.muCount) {
					problems.push(`last cell muCount ${lastReparse.muCount} != ${lastMutate.muCount}`);
				}
				// The appended instance belongs to the last cell — its recomputed
				// run [muStartIndex, muStartIndex+muCount) must cover the new index.
				if (lastReparse.muStartIndex + lastReparse.muCount !== afterReparse.instances.length) {
					problems.push(`last cell end ${lastReparse.muStartIndex + lastReparse.muCount} != ${afterReparse.instances.length}`);
				}
				let runningStart = 0;
				for (let i = 0; i < afterReparse.cells.length; i++) {
					if (afterReparse.cells[i].muStartIndex !== runningStart) {
						problems.push(`cell[${i}].muStartIndex ${afterReparse.cells[i].muStartIndex} != ${runningStart}`);
						break;
					}
					runningStart += afterReparse.cells[i].muCount;
				}
				if (runningStart !== afterReparse.instances.length) {
					problems.push(`sum(muCount) ${runningStart} != instances.length ${afterReparse.instances.length}`);
				}
				return problems;
			},
		},
	],
};

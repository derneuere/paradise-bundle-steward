// PropGraphicsList registry handler — thin wrapper around
// parsePropGraphicsList / writePropGraphicsList in
// src/lib/core/propGraphicsList.ts.
//
// The low-level parser/writer live outside the registry so the registry never
// imports from src/lib/core/bundle/index.ts (which could create a cycle).

import {
	parsePropGraphicsList,
	writePropGraphicsList,
	propGraphicsListImportTable,
	PROP_GRAPHICS_LIST_TYPE_ID,
	type ParsedPropGraphicsList,
} from '../../propGraphicsList';
import type { ResourceHandler } from '../handler';

// A prop-type id distinct from any low index the fixtures start with, so
// 'edit-prop-type' actually changes the stored value.
const STRESS_PROP_TYPE = 0x123;
// A high, almost-certainly-unique prop type for the add-part scenario, so the
// re-stamped part run can't collide with another prop's type on reparse.
const STRESS_UNIQUE_TYPE = 0x765;
// A part id distinct from the low sequential ids parts carry on disk.
const STRESS_PART_ID = 0x77;
// A Model resource id marker for the import-table edit/add scenarios.
const STRESS_MODEL_ID = 0xCAFEF00DBABEn;

/** Total parts across all props — the flat on-disk PropPartGraphics count. */
function totalParts(m: ParsedPropGraphicsList): number {
	return m.props.reduce((n, p) => n + p.parts.length, 0);
}

export const propGraphicsListHandler: ResourceHandler<ParsedPropGraphicsList> = {
	typeId: PROP_GRAPHICS_LIST_TYPE_ID,
	key: 'propGraphicsList',
	name: 'Prop Graphics List',
	description: 'Per-track-unit catalogue mapping each prop type (and its destructible parts) to its Model resource',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Prop_Graphics_List',
	notes: 'Model references live in the resource\'s inline import table — one entry per prop + per part. Parts are nested under their owning prop (grouped by type id on disk). Adding/removing props or parts resizes the table; the bundle envelope recomputes its import metadata via importTable() on export.',

	parseRaw(raw, ctx) {
		return parsePropGraphicsList(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writePropGraphicsList(model, ctx.littleEndian);
	},
	importTable(payload, ctx) {
		// One import per prop + per part, after the structural arrays. Read the
		// header counts the writer emitted (muSizeInBytes is the structural end).
		return propGraphicsListImportTable(payload, ctx.littleEndian);
	},
	describe(model) {
		return `zone ${model.muZoneNumber}, props ${model.props.length}, parts ${totalParts(model)}`;
	},

	fixtures: [
		{ bundle: 'example/TRK_UNIT9_GR.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/TRK_UNIT10_GR.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
		// The empty-list shape (172/427 track units: no props, no parts, null
		// pointers, 32-byte payload) is covered by a self-contained unit test in
		// __tests__/propGraphicsList.test.ts — it can't be a fixture here because
		// the stress scenarios below edit props[0] / a prop's parts, which an empty
		// list doesn't have.
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.props.length !== before.props.length) {
					problems.push(`prop count ${after.props.length} != ${before.props.length}`);
				}
				if (totalParts(after) !== totalParts(before)) {
					problems.push(`part count ${totalParts(after)} != ${totalParts(before)}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-zone-number',
			description: 'change muZoneNumber to a marker and verify it survives round-trip',
			mutate: (m) => ({ ...m, muZoneNumber: 4242 }),
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.muZoneNumber !== 4242) problems.push(`muZoneNumber = ${after.muZoneNumber}, expected 4242`);
				return problems;
			},
		},
		{
			name: 'edit-prop-model-id',
			description: 'set props[0].mpModelId to a marker resource id and verify the rebuilt import table preserves it',
			mutate: (m) => {
				const props = m.props.slice();
				props[0] = { ...props[0], mpModelId: STRESS_MODEL_ID };
				return { ...m, props };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.props[0].mpModelId !== STRESS_MODEL_ID) {
					problems.push(`props[0].mpModelId = 0x${after.props[0].mpModelId.toString(16)}, expected 0x${STRESS_MODEL_ID.toString(16)}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-prop-type',
			description: 'set the LAST prop muTypeId to a marker and verify it survives (its part run, if any, follows the new type)',
			mutate: (m) => {
				const props = m.props.slice();
				const i = props.length - 1;
				props[i] = { ...props[i], muTypeId: STRESS_PROP_TYPE };
				return { ...m, props };
			},
			verify: (before, after) => {
				const problems: string[] = [];
				const i = after.props.length - 1;
				if (after.props[i].muTypeId !== STRESS_PROP_TYPE) {
					problems.push(`props[last].muTypeId = ${after.props[i].muTypeId}, expected ${STRESS_PROP_TYPE}`);
				}
				if (after.props[i].mpModelId !== before.props[i].mpModelId) {
					problems.push(`props[last].mpModelId changed to 0x${after.props[i].mpModelId.toString(16)}`);
				}
				if (after.props[i].parts.length !== before.props[i].parts.length) {
					problems.push(`props[last].parts count changed to ${after.props[i].parts.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-part-id-and-model',
			description: 'edit the first part of the first parts-bearing prop and verify it survives',
			mutate: (m) => {
				const idx = m.props.findIndex((p) => p.parts.length > 0);
				if (idx < 0) return m;
				const props = m.props.map((p) => ({ ...p, parts: p.parts.slice() }));
				props[idx].parts[0] = { muPartId: STRESS_PART_ID, mpModelId: STRESS_MODEL_ID };
				return { ...m, props };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const idx = afterMutate.props.findIndex((p) => p.parts.length > 0);
				if (idx < 0) return problems; // no parts to edit
				const p = afterReparse.props[idx].parts[0];
				if (p.muPartId !== STRESS_PART_ID) problems.push(`part muPartId = ${p.muPartId}, expected ${STRESS_PART_ID}`);
				if (p.mpModelId !== STRESS_MODEL_ID) problems.push(`part mpModelId = 0x${p.mpModelId.toString(16)}`);
				return problems;
			},
		},
		{
			name: 'add-part-to-prop',
			description: 'give the last prop a fresh unique type and append a part to it; verify the new part + rebuilt import table survive and the total part count grows',
			mutate: (m) => {
				const props = m.props.map((p) => ({ ...p, parts: p.parts.slice() }));
				const i = props.length - 1;
				props[i] = {
					...props[i],
					muTypeId: STRESS_UNIQUE_TYPE,
					parts: [...props[i].parts, { muPartId: STRESS_PART_ID, mpModelId: STRESS_MODEL_ID }],
				};
				return { ...m, props };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (totalParts(afterReparse) !== totalParts(afterMutate)) {
					problems.push(`part count ${totalParts(afterReparse)} != ${totalParts(afterMutate)}`);
				}
				const i = afterReparse.props.length - 1;
				const lp = afterReparse.props[i];
				if (lp.muTypeId !== STRESS_UNIQUE_TYPE) problems.push(`last prop type = ${lp.muTypeId}`);
				const added = lp.parts[lp.parts.length - 1];
				if (!added || added.muPartId !== STRESS_PART_ID) problems.push(`appended part muPartId = ${added?.muPartId}`);
				if (!added || added.mpModelId !== STRESS_MODEL_ID) problems.push(`appended part mpModelId = 0x${added?.mpModelId.toString(16)}`);
				return problems;
			},
		},
		{
			name: 'remove-part-from-prop',
			description: 'drop the last part of the first parts-bearing prop and verify the total part count shrinks',
			mutate: (m) => {
				const idx = m.props.findIndex((p) => p.parts.length > 0);
				if (idx < 0) return m;
				const props = m.props.map((p) => ({ ...p, parts: p.parts.slice() }));
				props[idx].parts.pop();
				return { ...m, props };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (totalParts(afterReparse) !== totalParts(afterMutate)) {
					problems.push(`part count ${totalParts(afterReparse)} != ${totalParts(afterMutate)}`);
				}
				return problems;
			},
		},
		{
			name: 'add-prop-entry',
			description: 'append a new partless PropGraphics (a prop type that was not catalogued) with a Model id, and verify the new entry + rebuilt import table survive while existing entries are untouched',
			mutate: (m) => {
				const props = [
					...m.props,
					{ muTypeId: STRESS_UNIQUE_TYPE, mpModelId: STRESS_MODEL_ID, parts: [], _mpPartsRaw: 0 },
				];
				return { ...m, props };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.props.length !== afterMutate.props.length) {
					problems.push(`prop count ${afterReparse.props.length} != ${afterMutate.props.length}`);
				}
				const added = afterReparse.props[afterReparse.props.length - 1];
				if (added.muTypeId !== STRESS_UNIQUE_TYPE) problems.push(`added muTypeId = ${added.muTypeId}`);
				if (added.mpModelId !== STRESS_MODEL_ID) problems.push(`added mpModelId = 0x${added.mpModelId.toString(16)}`);
				if (added.parts.length !== 0) problems.push(`added prop has ${added.parts.length} parts, expected 0`);
				// Adding a prop shifts the part array; existing part Model ids must survive.
				if (totalParts(afterReparse) !== totalParts(afterMutate)) {
					problems.push(`total part count changed to ${totalParts(afterReparse)}`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-prop-entry',
			description: 'drop the final PropGraphics entry and verify the count shrinks and the import table is rebuilt for the remaining entries',
			mutate: (m) => ({ ...m, props: m.props.slice(0, -1) }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.props.length !== afterMutate.props.length) {
					problems.push(`prop count ${afterReparse.props.length} != ${afterMutate.props.length}`);
				}
				for (let i = 0; i < afterMutate.props.length; i++) {
					if (afterReparse.props[i].mpModelId !== afterMutate.props[i].mpModelId) {
						problems.push(`props[${i}].mpModelId drifted after remove`);
						break;
					}
				}
				return problems;
			},
		},
	],
};

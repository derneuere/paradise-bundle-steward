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
// A part id distinct from the low sequential ids parts carry on disk.
const STRESS_PART_ID = 0x77;
// A Model resource id marker for the import-table edit/add scenarios.
const STRESS_MODEL_ID = 0xCAFEF00DBABEn;

export const propGraphicsListHandler: ResourceHandler<ParsedPropGraphicsList> = {
	typeId: PROP_GRAPHICS_LIST_TYPE_ID,
	key: 'propGraphicsList',
	name: 'Prop Graphics List',
	description: 'Per-track-unit catalogue mapping each prop type (and destructible part) to its Model resource',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Prop_Graphics_List',
	notes: 'Model references live in the resource\'s inline import table — one entry per prop + per part. Adding/removing entries resizes the table; the bundle envelope recomputes its import metadata via importTable() on export.',

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
		return `zone ${model.muZoneNumber}, props ${model.props.length}, parts ${model.parts.length}`;
	},

	fixtures: [
		{ bundle: 'example/TRK_UNIT9_GR.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/TRK_UNIT10_GR.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
		// The empty-list shape (172/427 track units: no props, no parts, null
		// pointers, 32-byte payload) is covered by a self-contained unit test in
		// __tests__/propGraphicsList.test.ts — it can't be a fixture here because
		// the stress scenarios below edit props[0] / parts[0], which an empty list
		// doesn't have.
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
				if (after.parts.length !== before.parts.length) {
					problems.push(`part count ${after.parts.length} != ${before.parts.length}`);
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
			name: 'edit-prop-type',
			description: 'set props[0].muTypeId to a marker and verify it survives without perturbing the Model id / parts pointer',
			mutate: (m) => {
				const props = m.props.slice();
				props[0] = { ...props[0], muTypeId: STRESS_PROP_TYPE };
				return { ...m, props };
			},
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.props[0].muTypeId !== STRESS_PROP_TYPE) {
					problems.push(`props[0].muTypeId = ${after.props[0].muTypeId}, expected ${STRESS_PROP_TYPE}`);
				}
				// The Model id and the parts pointer share the record and must be
				// preserved when only the type changes.
				if (after.props[0].mpModelId !== before.props[0].mpModelId) {
					problems.push(`props[0].mpModelId changed to 0x${after.props[0].mpModelId.toString(16)}`);
				}
				if (after.props[0].firstPartIndex !== before.props[0].firstPartIndex) {
					problems.push(`props[0].firstPartIndex changed to ${after.props[0].firstPartIndex}`);
				}
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
			name: 'edit-part-type-and-id',
			description: 'set parts[0].muTypeId / muPartId to markers and verify they survive',
			mutate: (m) => {
				if (m.parts.length === 0) return m;
				const parts = m.parts.slice();
				parts[0] = { ...parts[0], muTypeId: STRESS_PROP_TYPE, muPartId: STRESS_PART_ID };
				return { ...m, parts };
			},
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.parts.length === 0) return problems; // nothing to check on a parts-less list
				if (after.parts[0].muTypeId !== STRESS_PROP_TYPE) {
					problems.push(`parts[0].muTypeId = ${after.parts[0].muTypeId}, expected ${STRESS_PROP_TYPE}`);
				}
				if (after.parts[0].muPartId !== STRESS_PART_ID) {
					problems.push(`parts[0].muPartId = ${after.parts[0].muPartId}, expected ${STRESS_PART_ID}`);
				}
				if (after.parts[0].mpModelId !== before.parts[0].mpModelId) {
					problems.push(`parts[0].mpModelId changed to 0x${after.parts[0].mpModelId.toString(16)}`);
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
					{ muTypeId: STRESS_PROP_TYPE, mpModelId: STRESS_MODEL_ID, firstPartIndex: null },
				];
				return { ...m, props };
			},
			// The runner passes (afterMutate, afterReparse): both already carry the
			// appended prop, so they must AGREE.
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.props.length !== afterMutate.props.length) {
					problems.push(`prop count ${afterReparse.props.length} != ${afterMutate.props.length}`);
				}
				const added = afterReparse.props[afterReparse.props.length - 1];
				if (added.muTypeId !== STRESS_PROP_TYPE) problems.push(`added muTypeId = ${added.muTypeId}`);
				if (added.mpModelId !== STRESS_MODEL_ID) problems.push(`added mpModelId = 0x${added.mpModelId.toString(16)}`);
				if (added.firstPartIndex !== null) problems.push(`added firstPartIndex = ${added.firstPartIndex}, expected null`);
				// Adding a prop shifts the part array; existing part Model ids and
				// the parts-pointer indices must survive the relocation intact.
				if (afterReparse.parts.length !== afterMutate.parts.length) {
					problems.push(`part count changed to ${afterReparse.parts.length}`);
				}
				for (let i = 0; i < afterMutate.parts.length; i++) {
					if (afterReparse.parts[i].mpModelId !== afterMutate.parts[i].mpModelId) {
						problems.push(`parts[${i}].mpModelId drifted after add`);
						break;
					}
				}
				if (afterMutate.props[0].firstPartIndex !== afterReparse.props[0].firstPartIndex) {
					problems.push(`props[0].firstPartIndex drifted after add`);
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
				// Surviving props keep their Model ids.
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

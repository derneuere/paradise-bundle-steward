// PropGraphicsList registry handler — thin wrapper around
// parsePropGraphicsList / writePropGraphicsList in
// src/lib/core/propGraphicsList.ts.
//
// The low-level parser/writer live outside the registry so the registry never
// imports from src/lib/core/bundle/index.ts (which could create a cycle).

import {
	parsePropGraphicsList,
	writePropGraphicsList,
	PROP_GRAPHICS_LIST_TYPE_ID,
	type ParsedPropGraphicsList,
} from '../../propGraphicsList';
import type { ResourceHandler } from '../handler';

// A prop-type id distinct from any low index the fixtures start with, so
// 'edit-prop-type' actually changes the stored value.
const STRESS_PROP_TYPE = 0x123;
// A part id distinct from the low sequential ids parts carry on disk.
const STRESS_PART_ID = 0x77;

export const propGraphicsListHandler: ResourceHandler<ParsedPropGraphicsList> = {
	typeId: PROP_GRAPHICS_LIST_TYPE_ID,
	key: 'propGraphicsList',
	name: 'Prop Graphics List',
	description: 'Per-track-unit catalogue mapping each prop type (and destructible part) to its Model resource',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Prop_Graphics_List',

	parseRaw(raw, ctx) {
		return parsePropGraphicsList(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writePropGraphicsList(model, ctx.littleEndian);
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
			description: 'set props[0].muTypeId to a marker and verify it survives without perturbing the import pointers',
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
				// mpPropModel (0 on disk) and mpParts must be untouched — they share
				// the record and are preserved verbatim.
				if (after.props[0].mpPropModel !== before.props[0].mpPropModel) {
					problems.push(`props[0].mpPropModel changed to ${after.props[0].mpPropModel}`);
				}
				if (after.props[0].mpParts !== before.props[0].mpParts) {
					problems.push(`props[0].mpParts changed to ${after.props[0].mpParts}`);
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
				if (after.parts[0].mpPropModel !== before.parts[0].mpPropModel) {
					problems.push(`parts[0].mpPropModel changed to ${after.parts[0].mpPropModel}`);
				}
				return problems;
			},
		},
	],
};

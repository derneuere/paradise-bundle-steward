// TrafficData registry handler — thin wrapper around parseTrafficDataData /
// writeTrafficDataData in src/lib/core/trafficData.ts.

import {
	parseTrafficDataData,
	writeTrafficDataData,
	type ParsedTrafficData,
	type TrafficHull,
	type TrafficFlowType,
} from '../../trafficData';
import { HANDLER_PLATFORM, type ResourceHandler } from '../handler';

export const trafficDataHandler: ResourceHandler<ParsedTrafficData> = {
	typeId: 0x10002,
	key: 'trafficData',
	name: 'Traffic Data',
	description: 'Traffic patterns, hulls, sections, junctions, traffic lights, flow types, kill zones, and vehicle data',
	category: 'Data',
	caps: {
		read: true,
		write: true,
		// Layout is 32-bit on every shipping platform; the parser/writer flips
		// endianness via ctx.littleEndian so PC (LE), X360 and PS3 (BE) all
		// share the same field offsets. Burnout 5 prototype data versions
		// (e.g. v22) are not supported and the parser rejects them.
		writePlatforms: [HANDLER_PLATFORM.PC, HANDLER_PLATFORM.XBOX360, HANDLER_PLATFORM.PS3],
	},

	parseRaw(raw, ctx) {
		return parseTrafficDataData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeTrafficDataData(model, ctx.littleEndian);
	},
	describe(model) {
		if (model.v22Raw) {
			const v = model.v22Raw;
			return `v${model.muDataVersion} (read-only structural), hulls ${v.hullPointers.length}, ` +
				`pvs cells ${v.pvs.muNumCells} (${v.pvs.muNumCells_X}×${v.pvs.muNumCells_Z}), ` +
				`flowTypes ${v.muNumFlowTypes}, vehicleTypes ${v.muNumVehicleTypes}, ` +
				`tail bytes A=${v.tailABytes.byteLength} B=${v.tailBBytes.byteLength} C=${v.tailCBytes.byteLength} D=${v.tailDBytes.byteLength}`;
		}
		const tlc = model.trafficLights;
		return `v${model.muDataVersion}, hulls ${model.hulls.length}, flowTypes ${model.flowTypes.length}, killZones ${model.killZones.length}, vehicleTypes ${model.vehicleTypes.length}, lights ${tlc.posAndYRotations.length}, paintColours ${model.paintColours.length}`;
	},

	fixtures: [
		// PC (LE) v45 retail bundles.
		{ bundle: 'example/B5TRAFFIC.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/BTTB5TRAFFIC.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
		// PS3 (BE) v44 retail bundle (Paradise v1.0–v1.3 era; bike events
		// don't exist yet so JunctionLogicBox is 4 bytes shorter on the wire).
		{ bundle: 'example/ps3/B5TRAFFIC.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
		// X360 (BE) v22 Burnout 5 prototype dev build. Read-only: header /
		// Pvs / hull pointer table parse cleanly; hull contents and tail
		// regions are captured raw (no spec yet). Round-trip is intentionally
		// not asserted — there's no writer for v22.
		{ bundle: 'example/older builds/B5Traffic.bndl', expect: { parseOk: true } },
	],

	// Structural fuzzing can easily desync paired arrays whose counts share a
	// single header field. The writer rejects those cleanly.
	fuzz: {
		tolerateErrors: [
			/killZoneIds\.length.*must equal killZones\.length/,
			/vehicleTypes\.length.*must equal vehicleTypesUpdate\.length/,
			/TLC light arrays must all have the same length/,
			/coronaTypes\.length.*must equal coronaPositions\.length/,
			// v22 prototype payload is read-only by design.
			/cannot write v22 prototype payload/,
		],
	},

	stressScenarios: [
		// ── baseline ──
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
		},

		// ── hulls: add / remove ──
		{
			name: 'remove-last-hull',
			description: 'pop the last hull',
			mutate: (m) => ({ ...m, hulls: m.hulls.slice(0, -1) }),
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.hulls.length !== before.hulls.length)
					problems.push(`hull count ${after.hulls.length} != ${before.hulls.length}`);
				return problems;
			},
		},
		{
			name: 'remove-first-hull',
			description: 'shift the first hull',
			mutate: (m) => ({ ...m, hulls: m.hulls.slice(1) }),
			verify: (before, after) =>
				after.hulls.length !== before.hulls.length
					? [`hull count ${after.hulls.length} != ${before.hulls.length}`] : [],
		},
		{
			name: 'duplicate-first-hull',
			description: 'clone hulls[0] and append it',
			mutate: (m) => {
				if (m.hulls.length === 0) return m;
				const clone = JSON.parse(JSON.stringify(m.hulls[0])) as TrafficHull;
				return { ...m, hulls: [...m.hulls, clone] };
			},
			verify: (before, after) =>
				after.hulls.length !== before.hulls.length
					? [`hull count ${after.hulls.length} != ${before.hulls.length}`] : [],
		},

		// ── hull sub-arrays: sections ──
		{
			name: 'remove-last-section-from-hull',
			description: 'pop the last section from the first hull that has sections, update counts',
			mutate: (m) => {
				const idx = m.hulls.findIndex(h => h.sections.length > 1);
				if (idx < 0) return m;
				const hulls = m.hulls.slice();
				const h = { ...hulls[idx] };
				h.sections = h.sections.slice(0, -1);
				h.sectionFlows = h.sectionFlows.slice(0, -1);
				// muNumSections is derived from sections.length at write time.
				hulls[idx] = h;
				return { ...m, hulls };
			},
			verify: (before, after) => {
				const idx = before.hulls.findIndex(h => h.sections.length > 1);
				if (idx < 0) return [];
				return after.hulls[idx].sections.length !== before.hulls[idx].sections.length
					? [`sections count mismatch`] : [];
			},
		},

		// ── hull sub-arrays: rungs ──
		{
			name: 'remove-last-rung-from-hull',
			description: 'pop the last rung + cumulative length from the first hull with rungs',
			mutate: (m) => {
				const idx = m.hulls.findIndex(h => h.rungs.length > 1);
				if (idx < 0) return m;
				const hulls = m.hulls.slice();
				const h = { ...hulls[idx] };
				h.rungs = h.rungs.slice(0, -1);
				h.cumulativeRungLengths = h.cumulativeRungLengths.slice(0, -1);
				// muNumRungs is derived from rungs.length at write time.
				hulls[idx] = h;
				return { ...m, hulls };
			},
			verify: (before, after) => {
				const idx = before.hulls.findIndex(h => h.rungs.length > 1);
				if (idx < 0) return [];
				return after.hulls[idx].rungs.length !== before.hulls[idx].rungs.length
					? [`rungs count mismatch`] : [];
			},
		},

		// ── hull sub-arrays: neighbours ──
		{
			name: 'remove-last-neighbour',
			description: 'pop last neighbour from first hull with neighbours',
			mutate: (m) => {
				const idx = m.hulls.findIndex(h => h.neighbours.length > 0);
				if (idx < 0) return m;
				const hulls = m.hulls.slice();
				const h = { ...hulls[idx] };
				h.neighbours = h.neighbours.slice(0, -1);
				// muNumNeighbours is derived from neighbours.length at write time.
				hulls[idx] = h;
				return { ...m, hulls };
			},
		},

		// ── hull sub-arrays: static traffic vehicles ──
		{
			name: 'remove-last-static-vehicle',
			description: 'pop last static vehicle from first hull with static traffic',
			mutate: (m) => {
				const idx = m.hulls.findIndex(h => h.staticTrafficVehicles.length > 0);
				if (idx < 0) return m;
				const hulls = m.hulls.slice();
				const h = { ...hulls[idx] };
				h.staticTrafficVehicles = h.staticTrafficVehicles.slice(0, -1);
				// muNumStaticTraffic is derived from staticTrafficVehicles.length at write time.
				hulls[idx] = h;
				return { ...m, hulls };
			},
		},

		// ── hull sub-arrays: junctions ──
		{
			name: 'remove-last-junction',
			description: 'pop last junction from first hull with junctions',
			mutate: (m) => {
				const idx = m.hulls.findIndex(h => h.junctions.length > 0);
				if (idx < 0) return m;
				const hulls = m.hulls.slice();
				const h = { ...hulls[idx] };
				h.junctions = h.junctions.slice(0, -1);
				// muNumJunctions is derived from junctions.length at write time.
				hulls[idx] = h;
				return { ...m, hulls };
			},
		},

		// ── hull sub-arrays: stop lines ──
		{
			name: 'remove-last-stop-line',
			description: 'pop last stop line from first hull with stop lines',
			mutate: (m) => {
				const idx = m.hulls.findIndex(h => h.stopLines.length > 0);
				if (idx < 0) return m;
				const hulls = m.hulls.slice();
				const h = { ...hulls[idx] };
				h.stopLines = h.stopLines.slice(0, -1);
				// muNumStoplines is derived from stopLines.length at write time.
				hulls[idx] = h;
				return { ...m, hulls };
			},
		},

		// ── hull sub-arrays: light triggers ──
		{
			name: 'remove-last-light-trigger',
			description: 'pop last light trigger + junction lookup from first hull with triggers',
			mutate: (m) => {
				const idx = m.hulls.findIndex(h => h.lightTriggers.length > 0);
				if (idx < 0) return m;
				const hulls = m.hulls.slice();
				const h = { ...hulls[idx] };
				h.lightTriggers = h.lightTriggers.slice(0, -1);
				h.lightTriggerJunctionLookup = h.lightTriggerJunctionLookup.slice(0, -1);
				// muNumLightTriggers is derived from lightTriggers.length at write time.
				hulls[idx] = h;
				return { ...m, hulls };
			},
		},

		// ── hull sub-arrays: light trigger start data ──
		{
			name: 'remove-last-lt-start-data',
			description: 'pop last light trigger start data from first hull with it',
			mutate: (m) => {
				const idx = m.hulls.findIndex(h => h.lightTriggerStartData.length > 0);
				if (idx < 0) return m;
				const hulls = m.hulls.slice();
				const h = { ...hulls[idx] };
				h.lightTriggerStartData = h.lightTriggerStartData.slice(0, -1);
				// muNumLightTriggersStartData is derived from lightTriggerStartData.length at write time.
				hulls[idx] = h;
				return { ...m, hulls };
			},
		},

		// ── hull sub-arrays: section spans ──
		{
			name: 'remove-last-section-span',
			description: 'pop last section span from first hull with spans',
			mutate: (m) => {
				const idx = m.hulls.findIndex(h => h.sectionSpans.length > 1);
				if (idx < 0) return m;
				const hulls = m.hulls.slice();
				const h = { ...hulls[idx] };
				h.sectionSpans = h.sectionSpans.slice(0, -1);
				// muNumSectionSpans is derived from sectionSpans.length at write time.
				hulls[idx] = h;
				return { ...m, hulls };
			},
		},

		// ── flow types: add / remove ──
		{
			name: 'remove-last-flow-type',
			description: 'pop the last flow type',
			mutate: (m) => ({ ...m, flowTypes: m.flowTypes.slice(0, -1) }),
			verify: (before, after) =>
				after.flowTypes.length !== before.flowTypes.length
					? [`flowType count ${after.flowTypes.length} != ${before.flowTypes.length}`] : [],
		},
		{
			name: 'add-flow-type',
			description: 'clone flowTypes[0] and append it',
			mutate: (m) => {
				if (m.flowTypes.length === 0) return m;
				const clone: TrafficFlowType = {
					vehicleTypeIds: [...m.flowTypes[0].vehicleTypeIds],
					cumulativeProbs: [...m.flowTypes[0].cumulativeProbs],
					muNumVehicleTypes: m.flowTypes[0].muNumVehicleTypes,
				};
				return { ...m, flowTypes: [...m.flowTypes, clone] };
			},
			verify: (before, after) =>
				after.flowTypes.length !== before.flowTypes.length
					? [`flowType count ${after.flowTypes.length} != ${before.flowTypes.length}`] : [],
		},

		// ── kill zones ──
		{
			name: 'remove-last-kill-zone',
			description: 'pop the last kill zone and its ID',
			mutate: (m) => ({
				...m,
				killZoneIds: m.killZoneIds.slice(0, -1),
				killZones: m.killZones.slice(0, -1),
			}),
			verify: (before, after) =>
				after.killZones.length !== before.killZones.length
					? [`killZone count ${after.killZones.length} != ${before.killZones.length}`] : [],
		},
		{
			name: 'remove-last-kill-zone-region',
			description: 'pop the last kill zone region',
			mutate: (m) => ({ ...m, killZoneRegions: m.killZoneRegions.slice(0, -1) }),
			verify: (before, after) =>
				after.killZoneRegions.length !== before.killZoneRegions.length
					? [`killZoneRegion count mismatch`] : [],
		},

		// ── vehicle types ──
		{
			name: 'remove-last-vehicle-type',
			description: 'pop last vehicle type and its update data',
			mutate: (m) => ({
				...m,
				vehicleTypes: m.vehicleTypes.slice(0, -1),
				vehicleTypesUpdate: m.vehicleTypesUpdate.slice(0, -1),
			}),
			verify: (before, after) =>
				after.vehicleTypes.length !== before.vehicleTypes.length
					? [`vehicleType count mismatch`] : [],
		},

		// ── vehicle assets ──
		{
			name: 'remove-last-vehicle-asset',
			description: 'pop last vehicle asset',
			mutate: (m) => ({ ...m, vehicleAssets: m.vehicleAssets.slice(0, -1) }),
			verify: (before, after) =>
				after.vehicleAssets.length !== before.vehicleAssets.length
					? [`vehicleAsset count mismatch`] : [],
		},

		// ── vehicle traits ──
		{
			name: 'remove-last-vehicle-trait',
			description: 'pop last vehicle trait',
			mutate: (m) => ({ ...m, vehicleTraits: m.vehicleTraits.slice(0, -1) }),
			verify: (before, after) =>
				after.vehicleTraits.length !== before.vehicleTraits.length
					? [`vehicleTrait count mismatch`] : [],
		},
		{
			name: 'edit-vehicle-trait',
			description: 'set vehicleTraits[0].mfAcceleration to a marker value',
			mutate: (m) => {
				if (m.vehicleTraits.length === 0) return m;
				const vehicleTraits = m.vehicleTraits.slice();
				vehicleTraits[0] = { ...vehicleTraits[0], mfAcceleration: 42.0 };
				return { ...m, vehicleTraits };
			},
			verify: (_before, after) =>
				after.vehicleTraits.length > 0 && after.vehicleTraits[0].mfAcceleration !== 42.0
					? [`vehicleTraits[0].mfAcceleration = ${after.vehicleTraits[0].mfAcceleration}`] : [],
		},

		// ── paint colours ──
		{
			name: 'zero-paint-colours',
			description: 'set all paint colours to zero',
			mutate: (m) => ({
				...m,
				paintColours: m.paintColours.map(() => ({ x: 0, y: 0, z: 0, w: 0 })),
			}),
			verify: (_before, after) => {
				for (let i = 0; i < after.paintColours.length; i++) {
					const c = after.paintColours[i];
					if (c.x !== 0 || c.y !== 0 || c.z !== 0 || c.w !== 0)
						return [`paintColours[${i}] not zero`];
				}
				return [];
			},
		},
		{
			name: 'remove-last-paint-colour',
			description: 'pop the last paint colour',
			mutate: (m) => ({ ...m, paintColours: m.paintColours.slice(0, -1) }),
			verify: (before, after) =>
				after.paintColours.length !== before.paintColours.length
					? [`paintColour count mismatch`] : [],
		},

		// ── traffic lights ──
		{
			name: 'remove-last-traffic-light',
			description: 'pop one traffic light from all TLC arrays',
			mutate: (m) => {
				const tlc = m.trafficLights;
				if (tlc.posAndYRotations.length === 0) return m;
				return {
					...m,
					trafficLights: {
						...tlc,
						posAndYRotations: tlc.posAndYRotations.slice(0, -1),
						instanceIDs: tlc.instanceIDs.slice(0, -1),
						instanceTypes: tlc.instanceTypes.slice(0, -1),
						instanceHashTable: tlc.instanceHashTable.slice(0, -1),
						instanceHashToIndexLookup: tlc.instanceHashToIndexLookup.slice(0, -1),
					},
				};
			},
			verify: (before, after) =>
				after.trafficLights.posAndYRotations.length !== before.trafficLights.posAndYRotations.length
					? [`TLC light count mismatch`] : [],
		},
		{
			name: 'remove-last-corona',
			description: 'pop one corona from TLC corona arrays',
			mutate: (m) => {
				const tlc = m.trafficLights;
				if (tlc.coronaTypes.length === 0) return m;
				return {
					...m,
					trafficLights: {
						...tlc,
						coronaTypes: tlc.coronaTypes.slice(0, -1),
						coronaPositions: tlc.coronaPositions.slice(0, -1),
					},
				};
			},
			verify: (before, after) =>
				after.trafficLights.coronaTypes.length !== before.trafficLights.coronaTypes.length
					? [`TLC corona count mismatch`] : [],
		},
		{
			name: 'remove-last-light-type',
			description: 'pop the last traffic light type',
			mutate: (m) => {
				const tlc = m.trafficLights;
				if (tlc.trafficLightTypes.length === 0) return m;
				return {
					...m,
					trafficLights: {
						...tlc,
						trafficLightTypes: tlc.trafficLightTypes.slice(0, -1),
					},
				};
			},
			verify: (before, after) =>
				after.trafficLights.trafficLightTypes.length !== before.trafficLights.trafficLightTypes.length
					? [`TLC lightType count mismatch`] : [],
		},

		// ── PVS ──
		{
			name: 'edit-pvs-cell-size',
			description: 'double the PVS cell size',
			mutate: (m) => ({
				...m,
				pvs: {
					...m.pvs,
					mCellSize: { x: m.pvs.mCellSize.x * 2, y: m.pvs.mCellSize.y * 2, z: m.pvs.mCellSize.z * 2, w: m.pvs.mCellSize.w },
				},
			}),
			verify: (_before, after) =>
				after.pvs.mCellSize.x === 0 ? [`pvs cell size zero after doubling`] : [],
		},

		// ── bulk: pop every top-level array at once ──
		{
			name: 'bulk-pop-every-array',
			description: 'pop the last entry from every non-empty top-level array',
			mutate: (m) => {
				const tlc = m.trafficLights;
				return {
					...m,
					hulls: m.hulls.length > 0 ? m.hulls.slice(0, -1) : m.hulls,
					flowTypes: m.flowTypes.length > 0 ? m.flowTypes.slice(0, -1) : m.flowTypes,
					killZoneIds: m.killZoneIds.length > 0 ? m.killZoneIds.slice(0, -1) : m.killZoneIds,
					killZones: m.killZones.length > 0 ? m.killZones.slice(0, -1) : m.killZones,
					killZoneRegions: m.killZoneRegions.length > 0 ? m.killZoneRegions.slice(0, -1) : m.killZoneRegions,
					vehicleTypes: m.vehicleTypes.length > 0 ? m.vehicleTypes.slice(0, -1) : m.vehicleTypes,
					vehicleTypesUpdate: m.vehicleTypesUpdate.length > 0 ? m.vehicleTypesUpdate.slice(0, -1) : m.vehicleTypesUpdate,
					vehicleAssets: m.vehicleAssets.length > 0 ? m.vehicleAssets.slice(0, -1) : m.vehicleAssets,
					vehicleTraits: m.vehicleTraits.length > 0 ? m.vehicleTraits.slice(0, -1) : m.vehicleTraits,
					paintColours: m.paintColours.length > 0 ? m.paintColours.slice(0, -1) : m.paintColours,
					trafficLights: {
						...tlc,
						posAndYRotations: tlc.posAndYRotations.length > 0 ? tlc.posAndYRotations.slice(0, -1) : tlc.posAndYRotations,
						instanceIDs: tlc.instanceIDs.length > 0 ? tlc.instanceIDs.slice(0, -1) : tlc.instanceIDs,
						instanceTypes: tlc.instanceTypes.length > 0 ? tlc.instanceTypes.slice(0, -1) : tlc.instanceTypes,
						trafficLightTypes: tlc.trafficLightTypes.length > 0 ? tlc.trafficLightTypes.slice(0, -1) : tlc.trafficLightTypes,
						coronaTypes: tlc.coronaTypes.length > 0 ? tlc.coronaTypes.slice(0, -1) : tlc.coronaTypes,
						coronaPositions: tlc.coronaPositions.length > 0 ? tlc.coronaPositions.slice(0, -1) : tlc.coronaPositions,
						instanceHashTable: tlc.instanceHashTable.length > 0 ? tlc.instanceHashTable.slice(0, -1) : tlc.instanceHashTable,
						instanceHashToIndexLookup: tlc.instanceHashToIndexLookup.length > 0 ? tlc.instanceHashToIndexLookup.slice(0, -1) : tlc.instanceHashToIndexLookup,
					},
				};
			},
		},

		// ── edit: junction position ──
		{
			name: 'edit-junction-position',
			description: 'zero the first junction position found',
			mutate: (m) => {
				const idx = m.hulls.findIndex(h => h.junctions.length > 0);
				if (idx < 0) return m;
				const hulls = m.hulls.slice();
				const h = { ...hulls[idx] };
				const junctions = h.junctions.slice();
				junctions[0] = { ...junctions[0], mPosition: { x: 0, y: 0, z: 0, w: 0 } };
				h.junctions = junctions;
				hulls[idx] = h;
				return { ...m, hulls };
			},
			verify: (_before, after) => {
				const idx = after.hulls.findIndex(h => h.junctions.length > 0);
				if (idx < 0) return [];
				const p = after.hulls[idx].junctions[0].mPosition;
				return (p.x !== 0 || p.y !== 0 || p.z !== 0)
					? [`junction position not zeroed`] : [];
			},
		},

		// ── edit: section speed ──
		{
			name: 'edit-section-speed',
			description: 'set first section speed to a marker value',
			mutate: (m) => {
				const idx = m.hulls.findIndex(h => h.sections.length > 0);
				if (idx < 0) return m;
				const hulls = m.hulls.slice();
				const h = { ...hulls[idx] };
				const sections = h.sections.slice();
				sections[0] = { ...sections[0], mfSpeed: 99.5 };
				h.sections = sections;
				hulls[idx] = h;
				return { ...m, hulls };
			},
			verify: (_before, after) => {
				const idx = after.hulls.findIndex(h => h.sections.length > 0);
				if (idx < 0) return [];
				return after.hulls[idx].sections[0].mfSpeed !== 99.5
					? [`section speed = ${after.hulls[idx].sections[0].mfSpeed}`] : [];
			},
		},

		// ── edit: rung positions ──
		{
			name: 'zero-first-rung',
			description: 'zero the first rung points of the first hull with rungs',
			mutate: (m) => {
				const idx = m.hulls.findIndex(h => h.rungs.length > 0);
				if (idx < 0) return m;
				const hulls = m.hulls.slice();
				const h = { ...hulls[idx] };
				const rungs = h.rungs.slice();
				const z4 = { x: 0, y: 0, z: 0, w: 0 } as const;
				rungs[0] = { maPoints: [z4, z4] };
				h.rungs = rungs;
				hulls[idx] = h;
				return { ...m, hulls };
			},
			verify: (_before, after) => {
				const idx = after.hulls.findIndex(h => h.rungs.length > 0);
				if (idx < 0) return [];
				const p = after.hulls[idx].rungs[0].maPoints[0];
				return (p.x !== 0 || p.y !== 0 || p.z !== 0)
					? [`rung not zeroed`] : [];
			},
		},
	],
};

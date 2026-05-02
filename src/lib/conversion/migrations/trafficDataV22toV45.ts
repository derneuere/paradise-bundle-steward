// TrafficData V22 → V45 migration (issue #45 follow-up).
//
// Converts a Burnout 5 prototype V22 TrafficData payload into the retail
// V45 shape. Pure function — same input → same output, no I/O. The v22
// editor profile registers this on its `conversions.v45` entry so the
// export-dialog UI can surface "Convert to v45 (Paradise PC retail)".
//
// === Investigation findings (see docs/trafficData-v22-migration.md) ===
//
// Verified clean mappings — no semantic loss, just endian-flip + repack:
//
//   - PVS header — pass-through; `mCellSize` synthesised as 1/mRecipCellSize
//     (v22 doesn't store it). hullPvsSets padded to muNumCells_X * Z so
//     retail's "every cell has an entry" convention is satisfied.
//   - flowTypes (27 in fixture) — v22 stores them inline inside tailA
//     bytes as 27-entry pointer table + per-record blocks of
//     {ptr_ids, ptr_probs, count, pad, ids[count] u16, probs[count] u8}.
//     Retail's TrafficFlowType has the same logical record; just decode
//     here and emit one TrafficFlowType per v22 entry.
//   - vehicleAssets (27) — extracted from the first 8 bytes of each v22
//     vehicle-type record in tailB. The CgsID is the base-40 hash of the
//     asset name (see scripts/investigate-traffic-v22-mappings.ts: 27/27
//     verified by comparing tailD names against `encodeCgsId`).
//   - vehicleTypes (27) — bytes 8..15 of each v22 tailB record map
//     field-for-field to TrafficVehicleTypeData (8 B exactly: u16
//     trailerFlowTypeId + 6 × u8 metadata). `muAssetId = i` (1:1 with
//     vehicleAssets in the prototype; no dedup needed).
//   - vehicleTypesUpdate (27) — v22 tailC is 27 × 5×f32, byte-for-byte
//     identical to retail's TrafficVehicleTypeUpdateData. Just endian-flip.
//   - hulls[].sections (48 B/record) — v22 sections decode cleanly under
//     v45's `TrafficSection` layout (verified — see investigation script;
//     mfSpeed, mfLength, mauForwardHulls etc. all decode to plausible
//     values). Migration copies each section verbatim.
//   - hulls[].rungs (32 B/record = 2 × Vec4) — same v45 layout, decoded
//     from each hull body's second sub-array pointer.
//   - hulls[].cumulativeRungLengths (4 B/float, parallel to rungs) — same
//     layout; decoded from the third sub-array pointer.
//
// Synthesised default-empty (Tier 2 — lossy with disclosure):
//
//   - killZones / killZoneIds / killZoneRegions — retail additions; v22
//     has no equivalent table.
//   - vehicleTraits — retail factored vehicle physics into a separate
//     traits table; v22 had per-vehicle hard-coded behavior. We emit one
//     neutral trait at index 0 and point every vehicleType.muTraitsId = 0.
//   - paintColours — retail addition; emit empty.
//   - trafficLights (TLC) — retail addition; emit empty inline TLC (the
//     129-entry mauInstanceHashOffsets is zero-filled).
//
// Lossy at hull level (these v22 hull sub-arrays don't have a confidently
// decoded record layout yet — needs a second v22 fixture or external
// corroboration):
//
//   - hulls[].neighbours
//   - hulls[].sectionSpans
//   - hulls[].staticTrafficVehicles
//   - hulls[].sectionFlows
//
// Confirmed absent in v22 (synthesised empty per-hull):
//
//   - hulls[].junctions / stopLines / lightTriggers /
//     lightTriggerStartData / lightTriggerJunctionLookup
//   - every v22 hull in the fixture has muNumJunctions = muNumStoplines
//     = muNumLightTriggers = 0. These are retail features added between
//     v22 and v44.

import type {
	ParsedTrafficDataV22,
	ParsedTrafficDataV45,
	TrafficFlowType,
	TrafficHull,
	TrafficSection,
	TrafficLaneRung,
	TrafficVehicleTypeData,
	TrafficVehicleTypeUpdateData,
	TrafficVehicleAsset,
	TrafficVehicleTraits,
	TrafficLightCollection,
	Vec4,
	PvsHullSet,
} from '@/lib/core/trafficData';
import type { ConversionResult } from '@/lib/editor/types';

// =============================================================================
// Big-endian primitive readers (v22 X360 fixtures are BE)
// =============================================================================
//
// We decode v22 buffers as bytes here rather than going through BinReader
// because each tail / hull region was already sliced into a Uint8Array at
// parse time. Routing through BinReader would mean re-wrapping each slice
// in an ArrayBuffer with the right offset — same cost without buying us
// anything. Pure index reads are fine for read-only decode.

function be32(buf: Uint8Array, off: number): number {
	return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}
function be16(buf: Uint8Array, off: number): number {
	return (buf[off] << 8) | buf[off + 1];
}
function bef32(buf: Uint8Array, off: number): number {
	const view = new DataView(new ArrayBuffer(4));
	view.setUint32(0, be32(buf, off), false);
	return view.getFloat32(0, false);
}
function be64(buf: Uint8Array, off: number): bigint {
	return (BigInt(be32(buf, off)) << 32n) | BigInt(be32(buf, off + 4));
}

// =============================================================================
// PVS migration
// =============================================================================

function migratePvs(v22: ParsedTrafficDataV22, defaulted: Set<string>) {
	const recip = v22.pvs.mRecipCellSize;
	// Synthesise mCellSize from 1 / mRecipCellSize, guarding against
	// divide-by-zero (the y / w axes are typically zero in v22).
	const mCellSize: Vec4 = {
		x: recip.x !== 0 ? 1 / recip.x : 0,
		y: recip.y !== 0 ? 1 / recip.y : 0,
		z: recip.z !== 0 ? 1 / recip.z : 0,
		w: 0,
	};
	defaulted.add('pvs.mCellSize');

	// v22 stores muNumCells = the count of populated hullPvsSets. Retail
	// treats muNumCells as muNumCells_X * muNumCells_Z (every grid cell has
	// an entry, including empty). Re-derive Z from the populated count and
	// pad the sets list to the full grid size so the retail invariant
	// (sets.length === muNumCells) holds.
	const cellsX = Math.max(1, v22.pvs.muNumCells_X);
	const muNumCells_Z = Math.max(1, Math.ceil(v22.pvs.muNumCells / cellsX));
	const muNumCells = cellsX * muNumCells_Z;
	defaulted.add('pvs.muNumCells_Z');

	const hullPvsSets: PvsHullSet[] = [...v22.pvs.hullPvsSets];
	while (hullPvsSets.length < muNumCells) {
		hullPvsSets.push({ mauItems: [0, 0, 0, 0, 0, 0, 0, 0], muCount: 0 });
	}

	return {
		mGridMin: { ...v22.pvs.mGridMin },
		mCellSize,
		mRecipCellSize: { ...recip },
		muNumCells_X: cellsX,
		muNumCells_Z,
		muNumCells,
		hullPvsSets,
	};
}

// =============================================================================
// Hull body decode (sections + rungs + cumulativeRungLengths)
// =============================================================================
//
// v22 hull layout (verified against fixture):
//
//   +0x00  muNumSections    : u8        ← mirrors v45
//   +0x01  muNumSectionSpans: u8
//   +0x02  muNumJunctions   : u8        ← always 0 in v22
//   +0x03  muNumStoplines   : u8        ← always 0
//   +0x04  muNumNeighbours  : u8
//   +0x05  muNumStaticTraffic: u8
//   +0x06  muNumVehicleAssets: u8
//   +0x07  pad              : u8
//   +0x08  ptr[0]           : u32 (file offset → sections[])
//   +0x0C  ptr[1]           : u32 (file offset → rungs[])
//   +0x10  ptr[2]           : u32 (file offset → cumulativeRungLengths[])
//   +0x14  ptr[3]           : u32 (likely neighbours/sectionSpans — unverified)
//   +0x18  ptr[4]           : u32 (unverified)
//   +0x1C  ptr[5]           : u32 (unverified — usually = end-of-hull sentinel)
//   +0x20  ptr[6]           : u32 (unverified)
//   +0x24  ptr[7]           : u32 (= start of NEXT hull)
//   +0x28  pad              : u8 × 8
//   +0x30  body             : sub-array data
//
// The pointers are absolute file offsets. We don't have access to the
// original raw resource buffer here — only the pre-sliced hull body
// bytes — so we rebase: compute each sub-array's offset relative to the
// hull start.

const V45_TRAFFIC_SECTION_SIZE = 48;
const V45_TRAFFIC_LANE_RUNG_SIZE = 32; // 2 × Vec4

// Sanity gate for a decoded section. A valid v45 section has:
//   - muRungOffset within u32 (the decode reader gives us that for free)
//     AND staying in a reasonable range (we cap at 1e6 because the largest
//     real retail hull has fewer than that many rungs by orders of
//     magnitude — values that overflow this threshold are pretty surely
//     mis-decoded floats / sentinel data).
//   - mfSpeed / mfLength finite and non-negative (no NaN, no Infinity).
//   - 0 ≤ muNumRungs ≤ 1024 (hard cap from section structure)
function isSaneSection(s: TrafficSection): boolean {
	if (s.muRungOffset > 1_000_000) return false;
	if (!Number.isFinite(s.mfSpeed) || s.mfSpeed < 0 || s.mfSpeed > 1_000) return false;
	if (!Number.isFinite(s.mfLength) || s.mfLength < 0 || s.mfLength > 1_000_000) return false;
	if (s.muNumRungs > 1024) return false;
	return true;
}

function decodeSection(body: Uint8Array, off: number): TrafficSection {
	return {
		muRungOffset: be32(body, off + 0),
		muNumRungs: body[off + 4],
		muStopLineOffset: body[off + 5],
		muNumStopLines: body[off + 6],
		muSpanIndex: body[off + 7],
		mauForwardHulls: [be16(body, off + 8), be16(body, off + 10), be16(body, off + 12)],
		mauBackwardHulls: [be16(body, off + 14), be16(body, off + 16), be16(body, off + 18)],
		mauForwardSections: [body[off + 20], body[off + 21], body[off + 22]],
		mauBackwardSections: [body[off + 23], body[off + 24], body[off + 25]],
		muTurnLeftProb: body[off + 26],
		muTurnRightProb: body[off + 27],
		muNeighbourOffset: be16(body, off + 28),
		muLeftNeighbourCount: body[off + 30],
		muRightNeighbourCount: body[off + 31],
		muChangeLeftProb: body[off + 32],
		muChangeRightProb: body[off + 33],
		_pad22: [body[off + 34], body[off + 35]],
		mfSpeed: bef32(body, off + 36),
		mfLength: bef32(body, off + 40),
		_pad2C: [body[off + 44], body[off + 45], body[off + 46], body[off + 47]],
	};
}

function decodeRung(body: Uint8Array, off: number): TrafficLaneRung {
	return {
		maPoints: [
			{
				x: bef32(body, off + 0),
				y: bef32(body, off + 4),
				z: bef32(body, off + 8),
				w: bef32(body, off + 12),
			},
			{
				x: bef32(body, off + 16),
				y: bef32(body, off + 20),
				z: bef32(body, off + 24),
				w: bef32(body, off + 28),
			},
		],
	};
}

function migrateHull(
	hullPtr: number,
	hullBody: Uint8Array,
	defaulted: Set<string>,
	lossy: Set<string>,
): TrafficHull {
	// Empty hull (header-only) → empty retail hull. Fast path; happens for
	// 207 of 342 hulls in the fixture.
	if (hullBody.byteLength <= 0x30) {
		return emptyHull();
	}

	const muNumSections = hullBody[0];
	const muNumSectionSpans = hullBody[1];
	const muNumNeighbours = hullBody[4];
	const muNumStaticTraffic = hullBody[5];
	const muNumVehicleAssets = hullBody[6];

	// Rebase sub-array pointers to local offsets within hullBody. ptr[i]
	// stored on disk is an absolute file offset; subtracting hullPtr gives
	// the offset relative to the start of this hull's body buffer.
	const subPtrLocal = (i: number): number => {
		const abs = be32(hullBody, 8 + i * 4);
		return abs - hullPtr;
	};

	// Pointer to the next sub-array (or end of body) — defines this
	// region's byte length without trusting a count field that may be
	// inconsistent.
	const subEndLocal = (i: number): number => {
		for (let j = i + 1; j < 8; j++) {
			const next = subPtrLocal(j);
			if (next > subPtrLocal(i)) return Math.min(next, hullBody.byteLength);
		}
		return hullBody.byteLength;
	};

	// Decode rungs first — sections are validated against the rung pool size.
	// Rungs — ptr[1]. Rung count isn't in the hull header in v22 (the v45
	// muNumRungs field is at +0x08 in the header but v22 has u32 pointers
	// there). Derive from the region size.
	const rungs: TrafficLaneRung[] = [];
	{
		const start = subPtrLocal(1);
		const end = subEndLocal(1);
		const region = Math.max(0, end - start);
		const count = Math.floor(region / V45_TRAFFIC_LANE_RUNG_SIZE);
		for (let i = 0; i < count; i++) {
			rungs.push(decodeRung(hullBody, start + i * V45_TRAFFIC_LANE_RUNG_SIZE));
		}
	}

	// cumulativeRungLengths — ptr[2], parallel to rungs (4 B per float).
	const cumulativeRungLengths: number[] = [];
	if (rungs.length > 0) {
		const start = subPtrLocal(2);
		for (let i = 0; i < rungs.length; i++) {
			const off = start + i * 4;
			if (off + 4 > hullBody.byteLength) break;
			cumulativeRungLengths.push(bef32(hullBody, off));
		}
	}

	// Sections — ptr[0]. Decoded under the v45 layout, but with a sanity
	// guard: investigation found that some v22 hulls store a "real" first
	// section followed by what appears to be a different-layout slot at
	// section[1] (e.g. hull[22].section[1] decodes muRungOffset to a value
	// that's actually a packed f32, way out of v45's valid range). Without
	// a confirmed v22-section spec we can't tell whether these are
	// sentinels, variant-shape records, or legacy fields the generator
	// left in place. Skip any section whose decoded field values fail a
	// sanity check OR whose rung-pool slice escapes bounds; the result is
	// fewer sections but a sound bundle.
	const sections: TrafficSection[] = [];
	let sectionsSkipped = 0;
	if (muNumSections > 0) {
		const start = subPtrLocal(0);
		for (let i = 0; i < muNumSections; i++) {
			const off = start + i * V45_TRAFFIC_SECTION_SIZE;
			if (off + V45_TRAFFIC_SECTION_SIZE > hullBody.byteLength) break;
			const s = decodeSection(hullBody, off);
			if (!isSaneSection(s) || s.muRungOffset + s.muNumRungs > rungs.length) {
				sectionsSkipped++;
				continue;
			}
			sections.push(s);
		}
	}
	if (sectionsSkipped > 0) {
		lossy.add('hulls[].sections (some entries skipped — v22 layout drift)');
	}

	// ptr[3..6] sub-arrays haven't been triangulated. Default to empty;
	// surface as lossy so the user knows traffic flow / static vehicles /
	// section spans / neighbours have been dropped.
	if (muNumNeighbours > 0) lossy.add('hulls[].neighbours');
	if (muNumSectionSpans > 0) lossy.add('hulls[].sectionSpans');
	if (muNumStaticTraffic > 0) lossy.add('hulls[].staticTrafficVehicles');
	if (muNumSections > 0) lossy.add('hulls[].sectionFlows (default values synthesised)');

	defaulted.add('hulls[].junctions');
	defaulted.add('hulls[].stopLines');
	defaulted.add('hulls[].lightTriggers');
	defaulted.add('hulls[].lightTriggerStartData');
	defaulted.add('hulls[].lightTriggerJunctionLookup');

	// sectionFlows must have one entry per section — the v45 parser reads
	// `muNumSections` of them in parallel with sections, derived from
	// `sections.length`. Without this synthesis the round-trip
	// (write → parse) reads garbage past the empty sectionFlows region.
	// We don't know which flow type each section maps to in v22, so emit
	// flow id = 0 + zero rate; the user can wire real flows later.
	const sectionFlows = sections.map(() => ({ muFlowTypeId: 0, muVehiclesPerMinute: 0 }));

	return {
		muNumSections: sections.length,
		muNumSectionSpans: 0,
		muNumJunctions: 0,
		muNumStoplines: 0,
		muNumNeighbours: 0,
		muNumStaticTraffic: 0,
		muNumVehicleAssets,
		_pad07: 0,
		muNumRungs: rungs.length,
		muFirstTrafficLight: 0xFFFF,
		muLastTrafficLight: 0xFFFF,
		muNumLightTriggers: 0,
		muNumLightTriggersStartData: 0,
		sections,
		rungs,
		cumulativeRungLengths,
		neighbours: [],
		sectionSpans: [],
		staticTrafficVehicles: [],
		sectionFlows,
		junctions: [],
		stopLines: [],
		lightTriggers: [],
		lightTriggerStartData: [],
		lightTriggerJunctionLookup: [],
		mauVehicleAssets: new Array(16).fill(0),
	};
}

function emptyHull(): TrafficHull {
	return {
		muNumSections: 0, muNumSectionSpans: 0, muNumJunctions: 0,
		muNumStoplines: 0, muNumNeighbours: 0, muNumStaticTraffic: 0,
		muNumVehicleAssets: 0, _pad07: 0, muNumRungs: 0,
		muFirstTrafficLight: 0xFFFF, muLastTrafficLight: 0xFFFF,
		muNumLightTriggers: 0, muNumLightTriggersStartData: 0,
		sections: [], rungs: [], cumulativeRungLengths: [],
		neighbours: [], sectionSpans: [], staticTrafficVehicles: [],
		sectionFlows: [], junctions: [], stopLines: [],
		lightTriggers: [], lightTriggerStartData: [],
		lightTriggerJunctionLookup: [],
		mauVehicleAssets: new Array(16).fill(0),
	};
}

// =============================================================================
// Flow-type decode (tailA — pointer table + inline records)
// =============================================================================

function migrateFlowTypes(v22: ParsedTrafficDataV22): TrafficFlowType[] {
	const out: TrafficFlowType[] = [];
	const tailA = v22.tailABytes;
	const tailABase = v22.ptrTailA;
	for (let i = 0; i < v22.muNumFlowTypes; i++) {
		const recAbs = be32(tailA, i * 4);
		const recOff = recAbs - tailABase;
		if (recOff < 0 || recOff + 16 > tailA.byteLength) {
			// Pointer escapes the captured tailA buffer — emit an empty
			// flow type rather than throwing; the user still gets a
			// well-formed migrated bundle.
			out.push({ vehicleTypeIds: [], cumulativeProbs: [], muNumVehicleTypes: 0 });
			continue;
		}
		const ptrIds = be32(tailA, recOff + 0);
		const ptrProbs = be32(tailA, recOff + 4);
		const count = tailA[recOff + 8]; // u32 with high bytes always zero
		const idsOff = ptrIds - tailABase;
		const probsOff = ptrProbs - tailABase;

		const vehicleTypeIds: number[] = [];
		if (idsOff >= 0 && idsOff + count * 2 <= tailA.byteLength) {
			for (let j = 0; j < count; j++) vehicleTypeIds.push(be16(tailA, idsOff + j * 2));
		}
		const cumulativeProbs: number[] = [];
		if (probsOff >= 0 && probsOff + count <= tailA.byteLength) {
			for (let j = 0; j < count; j++) cumulativeProbs.push(tailA[probsOff + j]);
		}
		out.push({ vehicleTypeIds, cumulativeProbs, muNumVehicleTypes: count });
	}
	return out;
}

// =============================================================================
// Vehicle data — tailB (16 B/record: CgsID + 8 B metadata) + tailC (5×f32)
// =============================================================================

function migrateVehicles(v22: ParsedTrafficDataV22): {
	vehicleTypes: TrafficVehicleTypeData[];
	vehicleAssets: TrafficVehicleAsset[];
	vehicleTypesUpdate: TrafficVehicleTypeUpdateData[];
} {
	const vehicleTypes: TrafficVehicleTypeData[] = [];
	const vehicleAssets: TrafficVehicleAsset[] = [];
	const tailB = v22.tailBBytes;
	for (let i = 0; i < v22.muNumVehicleTypes; i++) {
		const o = i * 16;
		if (o + 16 > tailB.byteLength) break;
		// CgsID hash (asset reference) — bytes 0..7
		vehicleAssets.push({ mVehicleId: be64(tailB, o) });
		// Metadata — bytes 8..15. Layout matches v45 TrafficVehicleTypeData
		// minus muAssetId (which we set to i since it's 1:1 with assets in
		// the prototype — no dedup needed).
		vehicleTypes.push({
			muTrailerFlowTypeId: be16(tailB, o + 8),
			mxVehicleFlags: tailB[o + 10],
			muVehicleClass: tailB[o + 11],
			muInitialDirt: tailB[o + 12],
			muAssetId: i & 0xFF,
			muTraitsId: 0, // single neutral trait at index 0 (synthesised; see migrateVehicleTraits)
			_pad07: tailB[o + 15],
		});
	}

	const vehicleTypesUpdate: TrafficVehicleTypeUpdateData[] = [];
	const tailC = v22.tailCBytes;
	for (let i = 0; i < v22.muNumVehicleTypes; i++) {
		const o = i * 20;
		if (o + 20 > tailC.byteLength) break;
		vehicleTypesUpdate.push({
			mfWheelRadius: bef32(tailC, o + 0),
			mfSuspensionRoll: bef32(tailC, o + 4),
			mfSuspensionPitch: bef32(tailC, o + 8),
			mfSuspensionTravel: bef32(tailC, o + 12),
			mfMass: bef32(tailC, o + 16),
		});
	}

	return { vehicleTypes, vehicleAssets, vehicleTypesUpdate };
}

// =============================================================================
// Synthesised retail-only tables
// =============================================================================

function neutralVehicleTrait(): TrafficVehicleTraits {
	// Mid-range "any car" defaults. Better than zeros — a zero
	// `mfAcceleration` would make every traffic vehicle behave like a
	// statue. Real values are 0.0-2.0 in retail; 1.0 is the neutral mid.
	return {
		mfSwervingAmountModifier: 1.0,
		mfAcceleration: 1.0,
		muCuttingUpChance: 0,
		muTailgatingChance: 0,
		muPatience: 128,
		muTantrumAttackCumProb: 0,
		muTantrumStopCumProb: 0,
		_pad0D: [0, 0, 0],
	};
}

function emptyTLC(): TrafficLightCollection {
	return {
		posAndYRotations: [],
		instanceIDs: [],
		instanceTypes: [],
		trafficLightTypes: [],
		coronaTypes: [],
		coronaPositions: [],
		mauInstanceHashOffsets: new Array(129).fill(0),
		instanceHashTable: [],
		instanceHashToIndexLookup: [],
	};
}

// =============================================================================
// Top-level migration entry point
// =============================================================================

/**
 * Convert a Burnout 5 prototype V22 TrafficData payload to the retail V45
 * shape. Pure function — same input always produces the same output.
 *
 * The migration preserves the road graph (PVS, hull sections, lane rungs,
 * flow types, vehicle definitions) and synthesises sensible defaults for
 * retail-only features (kill zones, vehicle traits, paint colours, the
 * traffic-light collection). Hull sub-arrays whose v22 record layout
 * hasn't been triangulated yet (neighbours, sectionSpans,
 * staticTrafficVehicles, sectionFlows) are emitted empty and surfaced in
 * `lossy` so the export UI can warn the user.
 *
 * @param v22 The V22 model to migrate.
 * @returns `result` = a fully-formed V45 model the writer can serialise;
 *          `defaulted` = field paths filled from defaults;
 *          `lossy` = field paths whose V22 source had no V45 equivalent
 *                    (or wasn't decodable yet).
 */
export function migrateV22toV45(
	v22: ParsedTrafficDataV22,
): ConversionResult<ParsedTrafficDataV45> {
	const defaulted = new Set<string>();
	const lossy = new Set<string>();

	const pvs = migratePvs(v22, defaulted);
	const flowTypes = migrateFlowTypes(v22);
	const { vehicleTypes, vehicleAssets, vehicleTypesUpdate } = migrateVehicles(v22);

	const hulls: TrafficHull[] = v22.hullsRaw.map((body, i) =>
		migrateHull(v22.hullPointers[i], body, defaulted, lossy),
	);

	defaulted.add('vehicleTraits');
	defaulted.add('killZones');
	defaulted.add('killZoneIds');
	defaulted.add('killZoneRegions');
	defaulted.add('paintColours');
	defaulted.add('trafficLights');
	// Asset-name debug table from v22 has no retail equivalent.
	lossy.add('vehicleAssetNames (v22 tailD — retail dropped name strings)');

	const result: ParsedTrafficDataV45 = {
		kind: 'v45',
		muDataVersion: 45,
		muSizeInBytes: 0, // patched by writer
		pvs,
		hulls,
		flowTypes,
		killZoneIds: [],
		killZones: [],
		killZoneRegions: [],
		vehicleTypes,
		vehicleTypesUpdate,
		vehicleAssets,
		vehicleTraits: [neutralVehicleTrait()],
		trafficLights: emptyTLC(),
		paintColours: [],
	};

	return {
		result,
		defaulted: [...defaulted].sort(),
		lossy: [...lossy].sort(),
	};
}

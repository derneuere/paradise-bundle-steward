// TrafficData parser and writer (ResourceType 0x10002)
//
// Layout reference: docs/TrafficData.md
//
// Coverage:
//   - 32-bit pointer layout on every shipping platform: PC (LE), X360 (BE),
//     PS3 (BE). Endianness is selected by the `littleEndian` argument; the
//     wire layout itself doesn't otherwise change.
//   - Data versions 44 (Paradise v1.0-v1.3 retail; PS3 build) and 45
//     (Paradise v1.4+ retail; current PC). The two only differ inside
//     `BrnTraffic::JunctionLogicBox` — v45 introduced a 4-byte
//     `miBikeStartDataIndex` field stolen from the trailing padding, so the
//     overall struct size is identical (0x120 bytes) and every other
//     structure is unchanged.
//   - Data version 22 (Burnout 5 prototype, Nov-2006 X360 dev build) has
//     read-only structural parsing — the header, Pvs, and hull pointer
//     table decode cleanly, with hull contents and four trailing regions
//     captured as raw bytes. The writer rejects v22 models since there's
//     no spec for hull internals or the tail regions yet. See the
//     `parseTrafficDataV22Internal` block lower in this file.
// 64-bit pointer layout (Paradise Remastered) is not supported yet.
//
// `ParsedTrafficData` is a discriminated union over `kind`: 'v45' (retail
// PC), 'v44' (retail PS3 era), and 'v22' (Burnout 5 prototype, read-only).
// V44 and V45 share the same retail field shape — only `kind` differs — so
// most consumers narrow once to `ParsedTrafficDataRetail` and treat both
// uniformly. V22 carries a structurally distinct header (no retail tables;
// hull contents + tail regions captured raw) and is rejected by the writer.
// See ADR-0008 for the discriminated-union rationale.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types (mirror the C++ structs from the wiki)
// =============================================================================

export type Vec4 = { x: number; y: number; z: number; w: number };

export type PvsHullSet = {
  mauItems: number[]; // u16[8]
  muCount: number;     // u32
};

export type TrafficPvs = {
  mGridMin: Vec4;
  mCellSize: Vec4;
  mRecipCellSize: Vec4;
  muNumCells_X: number;
  muNumCells_Z: number;
  muNumCells: number;
  hullPvsSets: PvsHullSet[];
};

export type TrafficSection = {
  muRungOffset: number;
  muNumRungs: number;
  muStopLineOffset: number;
  muNumStopLines: number;
  muSpanIndex: number;
  mauForwardHulls: number[];
  mauBackwardHulls: number[];
  mauForwardSections: number[];
  mauBackwardSections: number[];
  muTurnLeftProb: number;
  muTurnRightProb: number;
  muNeighbourOffset: number;
  muLeftNeighbourCount: number;
  muRightNeighbourCount: number;
  muChangeLeftProb: number;
  muChangeRightProb: number;
  _pad22: number[];
  mfSpeed: number;
  mfLength: number;
  _pad2C: number[];
};

export type TrafficLaneRung = {
  maPoints: [Vec4, Vec4];
};

export type TrafficNeighbour = {
  muSection: number;
  muSharedLength: number;
  muOurStartRung: number;
  muTheirStartRung: number;
};

export type TrafficSectionSpan = {
  muMaxVehicles: number;
  _pad02: number[];
  mfMaxVehicleRecip: number;
};

export type TrafficStaticVehicle = {
  mTransform: number[]; // f32[16] (Matrix44Affine)
  mFlowTypeID: number;
  mExistsAtAllChance: number;
  muFlags: number;
  _pad43: number[]; // 12 bytes
};

export type TrafficSectionFlow = {
  muFlowTypeId: number;
  muVehiclesPerMinute: number;
};

export type TrafficLightController = {
  mauTrafficLightIds: number[]; // u16[2]
  mauStopLineIds: number[];     // u8[6]
  mauStopLineHulls: number[];   // u16[6]
  muNumStopLines: number;
  muNumTrafficLights: number;
};

export type TrafficJunctionLogicBox = {
  muID: number;
  mauStateTimings: number[];        // u16[16]
  mauStoppedLightStates: number[];  // u8[16]
  muNumStates: number;
  muNumLights: number;
  _pad36: number[];
  muEventJunctionID: number;
  miOfflineStartDataIndex: number;
  miOnlineStartDataIndex: number;
  miBikeStartDataIndex: number; // v45+ only; reads as -1 in v44 models
  maTrafficLightControllers: TrafficLightController[]; // [8]
  // Trailing padding before mPosition. 8 bytes in v45 (where the bike index
  // ate 4 bytes of the original v44 padding); 12 bytes in v44.
  _pad108: number[];
  mPosition: Vec4;
};

export type TrafficStopLine = {
  muParamFixed: number;
};

export type TrafficLightTrigger = {
  mDimensions: Vec4;
  mPosPlusYRot: Vec4;
};

export type TrafficLightTriggerStartData = {
  maStartingPositions: Vec4[];  // [8]
  maStartingDirections: Vec4[]; // [8]
  maDestinationIDs: bigint[];   // CgsID[16]
  maeDestinationDifficulties: number[]; // u8[16]
  muNumStartingPositions: number;
  muNumDestinations: number;
  muNumLanes: number;
  _pad193: number[]; // 13 bytes
};

export type TrafficHull = {
  muNumSections: number;
  muNumSectionSpans: number;
  muNumJunctions: number;
  muNumStoplines: number;
  muNumNeighbours: number;
  muNumStaticTraffic: number;
  muNumVehicleAssets: number;
  _pad07: number;
  muNumRungs: number;
  muFirstTrafficLight: number;
  muLastTrafficLight: number;
  muNumLightTriggers: number;
  muNumLightTriggersStartData: number;
  sections: TrafficSection[];
  rungs: TrafficLaneRung[];
  cumulativeRungLengths: number[];
  neighbours: TrafficNeighbour[];
  sectionSpans: TrafficSectionSpan[];
  staticTrafficVehicles: TrafficStaticVehicle[];
  sectionFlows: TrafficSectionFlow[];
  junctions: TrafficJunctionLogicBox[];
  stopLines: TrafficStopLine[];
  lightTriggers: TrafficLightTrigger[];
  lightTriggerStartData: TrafficLightTriggerStartData[];
  lightTriggerJunctionLookup: number[];
  mauVehicleAssets: number[]; // u8[16]
};

export type TrafficFlowType = {
  vehicleTypeIds: number[];   // u16[]
  cumulativeProbs: number[];  // u8[]
  muNumVehicleTypes: number;
};

export type TrafficKillZone = {
  muOffset: number;
  muCount: number;
  _pad03: number;
};

export type TrafficKillZoneRegion = {
  muHull: number;
  muSection: number;
  muStartRung: number;
  muEndRung: number;
  _pad05: number;
};

export type TrafficVehicleTypeData = {
  muTrailerFlowTypeId: number;
  mxVehicleFlags: number;
  muVehicleClass: number;
  muInitialDirt: number;
  muAssetId: number;
  muTraitsId: number;
  _pad07: number;
};

export type TrafficVehicleTypeUpdateData = {
  mfWheelRadius: number;
  mfSuspensionRoll: number;
  mfSuspensionPitch: number;
  mfSuspensionTravel: number;
  mfMass: number;
};

export type TrafficVehicleAsset = {
  mVehicleId: bigint;
};

export type TrafficVehicleTraits = {
  mfSwervingAmountModifier: number;
  mfAcceleration: number;
  muCuttingUpChance: number;
  muTailgatingChance: number;
  muPatience: number;
  muTantrumAttackCumProb: number;
  muTantrumStopCumProb: number;
  _pad0D: number[]; // 3 bytes
};

export type TrafficLightType = {
  muCoronaOffset: number;
  muNumCoronas: number;
};

export type TrafficLightCollection = {
  posAndYRotations: Vec4[];
  instanceIDs: number[];
  instanceTypes: number[];
  trafficLightTypes: TrafficLightType[];
  coronaTypes: number[];
  coronaPositions: Vec4[];
  mauInstanceHashOffsets: number[]; // u16[129]
  instanceHashTable: number[];
  instanceHashToIndexLookup: number[];
};

// ─────────────────────────────────────────────────────────────────────────
// v22 prototype layout (Burnout 5 dev builds — Nov 2006 X360 fixture)
// ─────────────────────────────────────────────────────────────────────────
//
// The v22 TrafficData payload predates retail and uses a much smaller
// header (0x30 bytes vs 0x170 in v44/v45) plus a different hull stride
// (0x30 bytes per hull vs 0x50 + tail-arrays in v44/v45). Every retail
// top-level table — KillZones, VehicleTypes/Traits/Assets, the inline
// TrafficLightCollection, paint colours — is absent from the v22 header.
//
// We don't have an external spec for v22, so this side of the parser is
// READ-ONLY and structural-only: it locates the header pointer fields, the
// recognisable `Pvs` block (whose layout we can verify by inspecting the
// hullPvs sets that follow), the hull pointer table, and four tail regions
// that the four "extra" header pointers reference. Everything inside the
// hulls and the tail regions is captured as raw bytes for inspection rather
// than re-interpreted, because confidently labelling those fields would
// need either a v22 spec or several more fixtures to triangulate.
//
// V22 payloads parse into the `kind: 'v22'` branch of the discriminated
// union — a structurally distinct shape from retail. Consumers that only
// know the retail layout (`hulls`, `flowTypes`, …) must narrow on
// `model.kind` first; the editor registry's `pickProfile` call is the
// canonical place to do that.

export type TrafficPvsV22 = {
  // Same Vec4 grid origin convention as retail (x and z populated, y/w 0).
  mGridMin: Vec4;
  // v22 only stores the reciprocal cell size; the forward `mCellSize` Vec4
  // that retail Pvs carries is absent. Cell size can be reconstructed at
  // runtime as `1 / mRecipCellSize` per axis if needed.
  mRecipCellSize: Vec4;
  muNumCells_X: number;
  muNumCells_Z: number;
  // muNumCells is the count of populated `hullPvsSets` — NOT
  // muNumCells_X * muNumCells_Z (retail follows the same convention).
  muNumCells: number;
  ptrHullPvs: number;
  hullPvsSets: PvsHullSet[];
};

// Retail (v44 / v45) shape — every shipping bundle. The two on-disk versions
// differ only in `BrnTraffic::JunctionLogicBox` byte layout (handled by the
// reader/writer dispatch on `muDataVersion`); the parsed model shape is
// identical, so V44 and V45 share this base type and discriminate purely on
// `kind`.
type ParsedTrafficDataRetailFields = {
  muDataVersion: number;
  muSizeInBytes: number;
  pvs: TrafficPvs;
  hulls: TrafficHull[];
  flowTypes: TrafficFlowType[];
  killZoneIds: bigint[];
  killZones: TrafficKillZone[];
  killZoneRegions: TrafficKillZoneRegion[];
  vehicleTypes: TrafficVehicleTypeData[];
  vehicleTypesUpdate: TrafficVehicleTypeUpdateData[];
  vehicleAssets: TrafficVehicleAsset[];
  vehicleTraits: TrafficVehicleTraits[];
  trafficLights: TrafficLightCollection;
  paintColours: Vec4[];
};

export type ParsedTrafficDataV45 = ParsedTrafficDataRetailFields & {
  kind: 'v45';
};

export type ParsedTrafficDataV44 = ParsedTrafficDataRetailFields & {
  kind: 'v44';
};

// V44 and V45 are structurally identical — most consumers (UI tabs, glTF
// pipeline, schema editor extensions) only need to know "this is the retail
// shape" and can ignore which exact retail version produced the bundle. The
// writer re-dispatches on `muDataVersion` for the byte-level junction-layout
// split.
export type ParsedTrafficDataRetail = ParsedTrafficDataV45 | ParsedTrafficDataV44;

// Burnout 5 prototype (v22). Structurally distinct from retail: only the
// header / Pvs / hull pointer table decode cleanly, hull contents are raw
// bytes, four trailing pointer regions are preserved verbatim. No writer.
export type ParsedTrafficDataV22 = {
  kind: 'v22';
  muDataVersion: number; // always 22
  muSizeInBytes: number;
  // Pvs uses the v22 structural variant (no forward `mCellSize` Vec4).
  pvs: TrafficPvsV22;
  // Header pointer fields preserved verbatim (offsets refer to the start of
  // the resource payload). The 4 trailing pointers don't have stable
  // semantic labels yet — we keep raw values + referenced bytes only.
  ptrPvs: number;             // header @0x08
  ptrHulls: number;           // header @0x0C
  ptrTailA: number;           // header @0x10  (likely flow types — 1792 B)
  muNumFlowTypes: number;     // header @0x14
  muNumVehicleTypes: number;  // header @0x16
  ptrTailB: number;           // header @0x18  (~432 B)
  ptrTailC: number;           // header @0x1C  (~544 B)
  ptrTailD: number;           // header @0x20  (~324 B, runs to EOF)
  // Hull pointer table read off `ptrHulls`. Each hull is exactly 0x30 bytes
  // long (uniform stride; adjacent pointers are 0x30 apart). Hull contents
  // themselves are NOT interpreted — we capture each hull's raw 0x30 bytes
  // for inspection.
  hullPointers: number[];
  hullsRaw: Uint8Array[];
  // Bytes referenced by the four trailing header pointers, sized by the
  // distance to the next-higher pointer (or end-of-file for the last one).
  // The "tail" labels are positional and have no semantic claim attached.
  tailABytes: Uint8Array;
  tailBBytes: Uint8Array;
  tailCBytes: Uint8Array;
  tailDBytes: Uint8Array;
};

// Discriminated union: every consumer must narrow on `kind` before reading
// version-specific fields. The editor registry (src/lib/editor/) does this
// once at the profile-pick site so per-profile schemas/extensions/overlays
// are written against a single concrete variant.
export type ParsedTrafficData =
  | ParsedTrafficDataV45
  | ParsedTrafficDataV44
  | ParsedTrafficDataV22;

// =============================================================================
// Constants
// =============================================================================

const SIZEOF_PVS_HULL_SET = 20; // u16[8] items + u32 count

// =============================================================================
// Read Helpers
// =============================================================================

function readVec4(r: BinReader): Vec4 {
  return { x: r.readF32(), y: r.readF32(), z: r.readF32(), w: r.readF32() };
}

function readBytes(r: BinReader, n: number): number[] {
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = r.readU8();
  return out;
}

function readPvsHullSet(r: BinReader): PvsHullSet {
  const mauItems: number[] = [];
  for (let i = 0; i < 8; i++) mauItems.push(r.readU16());
  const muCount = r.readU32();
  return { mauItems, muCount };
}

function readSection(r: BinReader): TrafficSection {
  const muRungOffset = r.readU32();
  const muNumRungs = r.readU8();
  const muStopLineOffset = r.readU8();
  const muNumStopLines = r.readU8();
  const muSpanIndex = r.readU8();
  const mauForwardHulls = [r.readU16(), r.readU16(), r.readU16()];
  const mauBackwardHulls = [r.readU16(), r.readU16(), r.readU16()];
  const mauForwardSections = [r.readU8(), r.readU8(), r.readU8()];
  const mauBackwardSections = [r.readU8(), r.readU8(), r.readU8()];
  const muTurnLeftProb = r.readU8();
  const muTurnRightProb = r.readU8();
  const muNeighbourOffset = r.readU16();
  const muLeftNeighbourCount = r.readU8();
  const muRightNeighbourCount = r.readU8();
  const muChangeLeftProb = r.readU8();
  const muChangeRightProb = r.readU8();
  const _pad22 = readBytes(r, 2);
  const mfSpeed = r.readF32();
  const mfLength = r.readF32();
  const _pad2C = readBytes(r, 4);
  return {
    muRungOffset, muNumRungs, muStopLineOffset, muNumStopLines, muSpanIndex,
    mauForwardHulls, mauBackwardHulls, mauForwardSections, mauBackwardSections,
    muTurnLeftProb, muTurnRightProb, muNeighbourOffset, muLeftNeighbourCount,
    muRightNeighbourCount, muChangeLeftProb, muChangeRightProb, _pad22,
    mfSpeed, mfLength, _pad2C,
  };
}

function readLaneRung(r: BinReader): TrafficLaneRung {
  return { maPoints: [readVec4(r), readVec4(r)] };
}

function readNeighbour(r: BinReader): TrafficNeighbour {
  return {
    muSection: r.readU8(),
    muSharedLength: r.readU8(),
    muOurStartRung: r.readU8(),
    muTheirStartRung: r.readU8(),
  };
}

function readSectionSpan(r: BinReader): TrafficSectionSpan {
  const muMaxVehicles = r.readU16();
  const _pad02 = readBytes(r, 2);
  const mfMaxVehicleRecip = r.readF32();
  return { muMaxVehicles, _pad02, mfMaxVehicleRecip };
}

function readStaticVehicle(r: BinReader): TrafficStaticVehicle {
  const mTransform: number[] = [];
  for (let i = 0; i < 16; i++) mTransform.push(r.readF32());
  const mFlowTypeID = r.readU16();
  const mExistsAtAllChance = r.readU8();
  const muFlags = r.readU8();
  const _pad43 = readBytes(r, 12);
  return { mTransform, mFlowTypeID, mExistsAtAllChance, muFlags, _pad43 };
}

function readSectionFlow(r: BinReader): TrafficSectionFlow {
  return { muFlowTypeId: r.readU16(), muVehiclesPerMinute: r.readU16() };
}

function readLightController(r: BinReader): TrafficLightController {
  const mauTrafficLightIds = [r.readU16(), r.readU16()];
  const mauStopLineIds = readBytes(r, 6);
  const mauStopLineHulls = [r.readU16(), r.readU16(), r.readU16(),
                             r.readU16(), r.readU16(), r.readU16()];
  const muNumStopLines = r.readU8();
  const muNumTrafficLights = r.readU8();
  return { mauTrafficLightIds, mauStopLineIds, mauStopLineHulls, muNumStopLines, muNumTrafficLights };
}

// In v44 the bike-event index doesn't exist and that 4-byte slot is part of
// the struct's trailing padding; v45 carved it out into a real i32 field.
// The total junction size is 0x120 bytes either way.
const JUNCTION_BIKE_INDEX_MIN_VERSION = 45;

function readJunction(r: BinReader, version: number): TrafficJunctionLogicBox {
  const muID = r.readU32();
  const mauStateTimings: number[] = [];
  for (let i = 0; i < 16; i++) mauStateTimings.push(r.readU16());
  const mauStoppedLightStates = readBytes(r, 16);
  const muNumStates = r.readU8();
  const muNumLights = r.readU8();
  const _pad36 = readBytes(r, 2);
  const muEventJunctionID = r.readU32();
  const miOfflineStartDataIndex = r.readI32();
  const miOnlineStartDataIndex = r.readI32();
  const miBikeStartDataIndex =
    version >= JUNCTION_BIKE_INDEX_MIN_VERSION ? r.readI32() : -1;
  const maTrafficLightControllers: TrafficLightController[] = [];
  for (let i = 0; i < 8; i++) maTrafficLightControllers.push(readLightController(r));
  const trailingPadLen = version >= JUNCTION_BIKE_INDEX_MIN_VERSION ? 8 : 12;
  const _pad108 = readBytes(r, trailingPadLen);
  const mPosition = readVec4(r);
  return {
    muID, mauStateTimings, mauStoppedLightStates, muNumStates, muNumLights, _pad36,
    muEventJunctionID, miOfflineStartDataIndex, miOnlineStartDataIndex, miBikeStartDataIndex,
    maTrafficLightControllers, _pad108, mPosition,
  };
}

function readLightTrigger(r: BinReader): TrafficLightTrigger {
  return { mDimensions: readVec4(r), mPosPlusYRot: readVec4(r) };
}

function readLightTriggerStartData(r: BinReader): TrafficLightTriggerStartData {
  const maStartingPositions: Vec4[] = [];
  for (let i = 0; i < 8; i++) maStartingPositions.push(readVec4(r));
  const maStartingDirections: Vec4[] = [];
  for (let i = 0; i < 8; i++) maStartingDirections.push(readVec4(r));
  const maDestinationIDs: bigint[] = [];
  for (let i = 0; i < 16; i++) maDestinationIDs.push(r.readU64());
  const maeDestinationDifficulties = readBytes(r, 16);
  const muNumStartingPositions = r.readU8();
  const muNumDestinations = r.readU8();
  const muNumLanes = r.readU8();
  const _pad193 = readBytes(r, 13);
  return {
    maStartingPositions, maStartingDirections, maDestinationIDs,
    maeDestinationDifficulties, muNumStartingPositions, muNumDestinations,
    muNumLanes, _pad193,
  };
}

function readHull(r: BinReader, version: number): TrafficHull {
  // Header (0x00 - 0x0F)
  const muNumSections = r.readU8();
  const muNumSectionSpans = r.readU8();
  const muNumJunctions = r.readU8();
  const muNumStoplines = r.readU8();
  const muNumNeighbours = r.readU8();
  const muNumStaticTraffic = r.readU8();
  const muNumVehicleAssets = r.readU8();
  const _pad07 = r.readU8();
  const muNumRungs = r.readU16();
  const muFirstTrafficLight = r.readU16();
  const muLastTrafficLight = r.readU16();
  const muNumLightTriggers = r.readU8();
  const muNumLightTriggersStartData = r.readU8();

  // Pointers (0x10 - 0x3F)
  const ptrSections = r.readU32();
  const ptrRungs = r.readU32();
  const ptrCumRungLen = r.readU32();
  const ptrNeighbours = r.readU32();
  const ptrSectionSpans = r.readU32();
  const ptrStaticTraffic = r.readU32();
  const ptrSectionFlows = r.readU32();
  const ptrJunctions = r.readU32();
  const ptrStopLines = r.readU32();
  const ptrLightTriggers = r.readU32();
  const ptrLightTriggerStartData = r.readU32();
  const ptrLightTriggerJunctionLookup = r.readU32();

  // Inline array (0x40 - 0x4F)
  const mauVehicleAssets = readBytes(r, 16);

  // Chase each pointer to read the sub-array
  const sections: TrafficSection[] = [];
  if (muNumSections > 0) {
    r.position = ptrSections;
    for (let i = 0; i < muNumSections; i++) sections.push(readSection(r));
  }

  const rungs: TrafficLaneRung[] = [];
  if (muNumRungs > 0) {
    r.position = ptrRungs;
    for (let i = 0; i < muNumRungs; i++) rungs.push(readLaneRung(r));
  }

  const cumulativeRungLengths: number[] = [];
  if (muNumRungs > 0) {
    r.position = ptrCumRungLen;
    for (let i = 0; i < muNumRungs; i++) cumulativeRungLengths.push(r.readF32());
  }

  const neighbours: TrafficNeighbour[] = [];
  if (muNumNeighbours > 0) {
    r.position = ptrNeighbours;
    for (let i = 0; i < muNumNeighbours; i++) neighbours.push(readNeighbour(r));
  }

  const sectionSpans: TrafficSectionSpan[] = [];
  if (muNumSectionSpans > 0) {
    r.position = ptrSectionSpans;
    for (let i = 0; i < muNumSectionSpans; i++) sectionSpans.push(readSectionSpan(r));
  }

  const staticTrafficVehicles: TrafficStaticVehicle[] = [];
  if (muNumStaticTraffic > 0) {
    r.position = ptrStaticTraffic;
    for (let i = 0; i < muNumStaticTraffic; i++) staticTrafficVehicles.push(readStaticVehicle(r));
  }

  // SectionFlows count = muNumSections (one flow assignment per section)
  const sectionFlows: TrafficSectionFlow[] = [];
  if (muNumSections > 0) {
    r.position = ptrSectionFlows;
    for (let i = 0; i < muNumSections; i++) sectionFlows.push(readSectionFlow(r));
  }

  const junctions: TrafficJunctionLogicBox[] = [];
  if (muNumJunctions > 0) {
    r.position = ptrJunctions;
    for (let i = 0; i < muNumJunctions; i++) junctions.push(readJunction(r, version));
  }

  const stopLines: TrafficStopLine[] = [];
  if (muNumStoplines > 0) {
    r.position = ptrStopLines;
    for (let i = 0; i < muNumStoplines; i++) stopLines.push({ muParamFixed: r.readU16() });
  }

  const lightTriggers: TrafficLightTrigger[] = [];
  if (muNumLightTriggers > 0) {
    r.position = ptrLightTriggers;
    for (let i = 0; i < muNumLightTriggers; i++) lightTriggers.push(readLightTrigger(r));
  }

  const lightTriggerStartData: TrafficLightTriggerStartData[] = [];
  if (muNumLightTriggersStartData > 0) {
    r.position = ptrLightTriggerStartData;
    for (let i = 0; i < muNumLightTriggersStartData; i++) lightTriggerStartData.push(readLightTriggerStartData(r));
  }

  // Junction lookup: one u8 per light trigger
  const lightTriggerJunctionLookup: number[] = [];
  if (muNumLightTriggers > 0) {
    r.position = ptrLightTriggerJunctionLookup;
    for (let i = 0; i < muNumLightTriggers; i++) lightTriggerJunctionLookup.push(r.readU8());
  }

  return {
    muNumSections, muNumSectionSpans, muNumJunctions, muNumStoplines,
    muNumNeighbours, muNumStaticTraffic, muNumVehicleAssets, _pad07,
    muNumRungs, muFirstTrafficLight, muLastTrafficLight,
    muNumLightTriggers, muNumLightTriggersStartData,
    sections, rungs, cumulativeRungLengths, neighbours, sectionSpans,
    staticTrafficVehicles, sectionFlows, junctions, stopLines,
    lightTriggers, lightTriggerStartData, lightTriggerJunctionLookup,
    mauVehicleAssets,
  };
}

function readFlowType(r: BinReader): TrafficFlowType {
  const ptrVehicleTypeIds = r.readU32();
  const ptrCumulativeProbs = r.readU32();
  const muNumVehicleTypes = r.readU8();
  readBytes(r, 3); // padding

  const vehicleTypeIds: number[] = [];
  if (muNumVehicleTypes > 0 && ptrVehicleTypeIds !== 0) {
    r.position = ptrVehicleTypeIds;
    for (let i = 0; i < muNumVehicleTypes; i++) vehicleTypeIds.push(r.readU16());
  }

  const cumulativeProbs: number[] = [];
  if (muNumVehicleTypes > 0 && ptrCumulativeProbs !== 0) {
    r.position = ptrCumulativeProbs;
    for (let i = 0; i < muNumVehicleTypes; i++) cumulativeProbs.push(r.readU8());
  }

  return { vehicleTypeIds, cumulativeProbs, muNumVehicleTypes };
}

function readLightType(r: BinReader): TrafficLightType {
  return { muCoronaOffset: r.readU8(), muNumCoronas: r.readU8() };
}

// =============================================================================
// Parsing
// =============================================================================

// Versions whose `BrnTraffic::TrafficData` outer layout is documented and
// fully supported (parse + write + byte round-trip). v22 has a separate
// read-only structural parser further down — it's deliberately not in
// this set because writeTrafficDataData refuses to emit it.
const SUPPORTED_TRAFFIC_VERSIONS = new Set<number>([44, 45]);
// All versions the parser understands at all (including read-only v22).
const PARSEABLE_TRAFFIC_VERSIONS = new Set<number>([22, 44, 45]);
// Threshold above which the retail header layout (0x170 bytes, full
// kill-zone / vehicle / TLC / paint tables) is in effect.
const RETAIL_MIN_VERSION = 44;

// v22 hull stride observed empirically in the Burnout 5 prototype X360
// fixture — every adjacent pair of hull pointers in the table is exactly
// 0x30 bytes apart. We don't claim to know which fields live inside.
const V22_HULL_STRIDE = 0x30;
// v22 inline header is exactly the bytes from offset 0 up to ptrPvs (0x30
// in the only fixture we have); the trailing 12 bytes (0x24..0x2F) are
// zero in the sample and treated as reserved/padding.
const V22_HEADER_SIZE = 0x30;
// v22 Pvs header is 0x30 bytes (vs 0x40 in retail) — retail's mCellSize
// Vec4 is missing in v22; everything else lines up.
const V22_PVS_HEADER_SIZE = 0x30;

// Read-only structural parser for the v22 prototype TrafficData payload.
// Exported alongside the main `parseTrafficDataData` dispatcher so callers
// who already know they have a v22 payload can skip the version probe and
// pin the result type to `ParsedTrafficDataV22` directly.
export function parseTrafficDataV22(
  data: Uint8Array,
  littleEndian = false,
): ParsedTrafficDataV22 {
  return parseTrafficDataV22Internal(data, littleEndian);
}

// Internal implementation. Returns a `ParsedTrafficDataV22` carrying the
// header + Pvs + hull pointer table that decoded cleanly, plus raw bytes
// for the hull contents and four trailing regions we don't yet interpret.
function parseTrafficDataV22Internal(
  data: Uint8Array,
  littleEndian: boolean,
): ParsedTrafficDataV22 {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const r = new BinReader(buf, littleEndian);

  // --- Header (0x30 bytes) ---
  const muDataVersion = r.readU8();        // 0x00
  /* pad */ r.readU8();                     // 0x01
  const muNumHulls = r.readU16();           // 0x02
  const muSizeInBytes = r.readU32();        // 0x04
  const ptrPvs = r.readU32();               // 0x08
  const ptrHulls = r.readU32();             // 0x0C
  const ptrTailA = r.readU32();             // 0x10
  const muNumFlowTypes = r.readU16();       // 0x14
  const muNumVehicleTypes = r.readU16();    // 0x16
  const ptrTailB = r.readU32();             // 0x18
  const ptrTailC = r.readU32();             // 0x1C
  const ptrTailD = r.readU32();             // 0x20
  // 0x24..0x2F: 12 reserved/padding bytes — skipped.

  // --- Pvs ---
  // The Pvs we observe at ptrPvs has the same conceptual shape as retail
  // minus the forward `mCellSize` Vec4 (only mGridMin + mRecipCellSize +
  // 4 u32s). Verified by walking the hullPvsSets that follow it: when
  // parsed at the v22 stride, the per-cell hull-id arrays decode as
  // sensible u16 indices.
  r.position = ptrPvs;
  const mGridMin = readVec4(r);
  const mRecipCellSize = readVec4(r);
  const muNumCells_X = r.readU32();
  const muNumCells_Z = r.readU32();
  const muNumCells = r.readU32();
  const ptrHullPvs = r.readU32();
  const hullPvsSets: PvsHullSet[] = [];
  if (muNumCells > 0) {
    // The fixture has ptrHullPvs == 0 even though muNumCells > 0 — the
    // sets follow inline immediately after the Pvs header. Use the
    // current cursor when ptrHullPvs is zero.
    r.position = ptrHullPvs !== 0 ? ptrHullPvs : ptrPvs + V22_PVS_HEADER_SIZE;
    for (let i = 0; i < muNumCells; i++) hullPvsSets.push(readPvsHullSet(r));
  }

  // --- Hull pointer table + per-hull raw bytes ---
  const hullPointers: number[] = [];
  if (muNumHulls > 0) {
    r.position = ptrHulls;
    for (let i = 0; i < muNumHulls; i++) hullPointers.push(r.readU32());
  }
  const hullsRaw: Uint8Array[] = hullPointers.map((p) => {
    if (p + V22_HULL_STRIDE > data.byteLength) return new Uint8Array(0);
    return data.slice(p, p + V22_HULL_STRIDE);
  });

  // --- Tail regions ---
  // Slice each tail by the distance to the next-higher header pointer (or
  // end-of-file for the last one). The four tails are positional names
  // only — we don't claim semantics for them yet.
  const tailPtrs = [ptrTailA, ptrTailB, ptrTailC, ptrTailD]
    .filter((p) => p > 0)
    .sort((a, b) => a - b);
  const sliceTail = (p: number): Uint8Array => {
    if (p === 0 || p >= data.byteLength) return new Uint8Array(0);
    const idx = tailPtrs.indexOf(p);
    const end = idx >= 0 && idx + 1 < tailPtrs.length
      ? tailPtrs[idx + 1]
      : Math.min(muSizeInBytes, data.byteLength);
    return data.slice(p, end);
  };

  return {
    kind: 'v22',
    muDataVersion,
    muSizeInBytes,
    pvs: {
      mGridMin,
      mRecipCellSize,
      muNumCells_X,
      muNumCells_Z,
      muNumCells,
      ptrHullPvs,
      hullPvsSets,
    },
    ptrPvs,
    ptrHulls,
    ptrTailA,
    muNumFlowTypes,
    muNumVehicleTypes,
    ptrTailB,
    ptrTailC,
    ptrTailD,
    hullPointers,
    hullsRaw,
    tailABytes: sliceTail(ptrTailA),
    tailBBytes: sliceTail(ptrTailB),
    tailCBytes: sliceTail(ptrTailC),
    tailDBytes: sliceTail(ptrTailD),
  };
}

export function parseTrafficDataData(data: Uint8Array, littleEndian = true): ParsedTrafficData {
  const r = new BinReader(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    littleEndian,
  );

  // --- Version dispatch ---
  // Peek the version byte without advancing past the header.
  const muDataVersion = r.readU8();
  r.position = 0;
  if (!PARSEABLE_TRAFFIC_VERSIONS.has(muDataVersion)) {
    throw new Error(
      `TrafficData.parse: unsupported data version ${muDataVersion} (0x${muDataVersion.toString(16)}). ` +
        `Parseable: ${[...PARSEABLE_TRAFFIC_VERSIONS].join(', ')} ` +
        `(read+write: ${[...SUPPORTED_TRAFFIC_VERSIONS].join(', ')}; read-only structural: 22).`,
    );
  }
  if (muDataVersion < RETAIL_MIN_VERSION) {
    return parseTrafficDataV22Internal(data, littleEndian);
  }
  // Retail (v44/v45) — fall through to the inline parser below. Re-skip
  // the version byte we peeked.
  r.readU8();
  /* pad */ r.readU8();                     // 0x1
  const muNumHulls = r.readU16();           // 0x2
  const muSizeInBytes = r.readU32();        // 0x4
  const ptrPvs = r.readU32();              // 0x8
  const ptrHulls = r.readU32();            // 0xC  (Hull**)
  const ptrFlowTypes = r.readU32();        // 0x10 (FlowType**)
  const muNumFlowTypes = r.readU16();       // 0x14
  const muNumVehicleTypes = r.readU16();    // 0x16
  const muNumVehicleAssets = r.readU8();    // 0x18
  const muNumVehicleTraits = r.readU8();    // 0x19
  const muNumKillZones = r.readU16();       // 0x1A
  const muNumKillZoneRegions = r.readU16(); // 0x1C
  /* pad */ r.readU16();                    // 0x1E
  const ptrKillZoneIds = r.readU32();       // 0x20
  const ptrKillZones = r.readU32();         // 0x24
  const ptrKillZoneRegions = r.readU32();   // 0x28
  const ptrVehicleTypes = r.readU32();      // 0x2C
  const ptrVehicleTypesUpdate = r.readU32();// 0x30
  const ptrVehicleAssets = r.readU32();     // 0x34
  const ptrVehicleTraits = r.readU32();     // 0x38

  // --- Inline TrafficLightCollection at 0x3C (0x12C bytes) ---
  const tlcNumLights = r.readU16();        // 0x3C + 0x0
  const tlcNumLightTypes = r.readU16();    // 0x3C + 0x2
  // muNumCoronas is u16 in v45 but u8 (with 3 bytes trailing pad) in v44.
  // Field width was widened in the v44→v45 transition; this matters for
  // big-endian bundles, where reading the v44 bytes as a v45 u16 would
  // misinterpret a one-byte value of 21 as 0x1500 (5376).
  let tlcNumCoronas: number;
  if (muDataVersion >= 45) {
    tlcNumCoronas = r.readU16();           // 0x3C + 0x4 (u16 + u16 pad)
    /* pad */ r.readU16();                  // 0x3C + 0x6
  } else {
    tlcNumCoronas = r.readU8();            // 0x3C + 0x4 (u8 + 3 pad)
    /* pad */ readBytes(r, 3);              // 0x3C + 0x5..0x7
  }
  const ptrTlcPosYRot = r.readU32();      // 0x3C + 0x8
  const ptrTlcInstanceIDs = r.readU32();   // 0x3C + 0xC
  const ptrTlcInstanceTypes = r.readU32(); // 0x3C + 0x10
  const ptrTlcLightTypes = r.readU32();    // 0x3C + 0x14
  const ptrTlcCoronaTypes = r.readU32();   // 0x3C + 0x18
  const ptrTlcCoronaPos = r.readU32();     // 0x3C + 0x1C
  // mauInstanceHashOffsets[129] at 0x3C + 0x20
  const tlcHashOffsets: number[] = [];
  for (let i = 0; i < 129; i++) tlcHashOffsets.push(r.readU16());
  /* pad */ r.readU16();                    // 0x3C + 0x122
  const ptrTlcHashTable = r.readU32();     // 0x3C + 0x124
  const ptrTlcHashToIndex = r.readU32();   // 0x3C + 0x128

  // --- Remaining header fields ---
  const muNumPaintColours = r.readU8();    // 0x168
  /* pad */ readBytes(r, 3);               // 0x169
  const ptrPaintColours = r.readU32();     // 0x16C
  // r.position is now 0x170

  // --- Chase pointers: Pvs ---
  r.position = ptrPvs;
  const mGridMin = readVec4(r);
  const mCellSize = readVec4(r);
  const mRecipCellSize = readVec4(r);
  const muNumCells_X = r.readU32();
  const muNumCells_Z = r.readU32();
  const muNumCells = r.readU32();
  const ptrHullPvs = r.readU32();
  const hullPvsSets: PvsHullSet[] = [];
  if (muNumCells > 0 && ptrHullPvs !== 0) {
    r.position = ptrHullPvs;
    for (let i = 0; i < muNumCells; i++) hullPvsSets.push(readPvsHullSet(r));
  }
  const pvs: TrafficPvs = {
    mGridMin, mCellSize, mRecipCellSize,
    muNumCells_X, muNumCells_Z, muNumCells, hullPvsSets,
  };

  // --- Chase pointers: Hull pointer table + hulls ---
  const hulls: TrafficHull[] = [];
  if (muNumHulls > 0) {
    r.position = ptrHulls;
    const hullPtrs: number[] = [];
    for (let i = 0; i < muNumHulls; i++) hullPtrs.push(r.readU32());
    for (let i = 0; i < muNumHulls; i++) {
      r.position = hullPtrs[i];
      hulls.push(readHull(r, muDataVersion));
    }
  }

  // --- Chase pointers: FlowType pointer table + flow types ---
  const flowTypes: TrafficFlowType[] = [];
  if (muNumFlowTypes > 0) {
    r.position = ptrFlowTypes;
    const ftPtrs: number[] = [];
    for (let i = 0; i < muNumFlowTypes; i++) ftPtrs.push(r.readU32());
    for (let i = 0; i < muNumFlowTypes; i++) {
      r.position = ftPtrs[i];
      flowTypes.push(readFlowType(r));
    }
  }

  // --- Chase pointers: top-level arrays ---
  const killZoneIds: bigint[] = [];
  if (muNumKillZones > 0) {
    r.position = ptrKillZoneIds;
    for (let i = 0; i < muNumKillZones; i++) killZoneIds.push(r.readU64());
  }

  const killZones: TrafficKillZone[] = [];
  if (muNumKillZones > 0) {
    r.position = ptrKillZones;
    for (let i = 0; i < muNumKillZones; i++) {
      killZones.push({ muOffset: r.readU16(), muCount: r.readU8(), _pad03: r.readU8() });
    }
  }

  const killZoneRegions: TrafficKillZoneRegion[] = [];
  if (muNumKillZoneRegions > 0) {
    r.position = ptrKillZoneRegions;
    for (let i = 0; i < muNumKillZoneRegions; i++) {
      killZoneRegions.push({
        muHull: r.readU16(), muSection: r.readU8(),
        muStartRung: r.readU8(), muEndRung: r.readU8(), _pad05: r.readU8(),
      });
    }
  }

  const vehicleTypes: TrafficVehicleTypeData[] = [];
  if (muNumVehicleTypes > 0) {
    r.position = ptrVehicleTypes;
    for (let i = 0; i < muNumVehicleTypes; i++) {
      vehicleTypes.push({
        muTrailerFlowTypeId: r.readU16(), mxVehicleFlags: r.readU8(),
        muVehicleClass: r.readU8(), muInitialDirt: r.readU8(),
        muAssetId: r.readU8(), muTraitsId: r.readU8(), _pad07: r.readU8(),
      });
    }
  }

  const vehicleTypesUpdate: TrafficVehicleTypeUpdateData[] = [];
  if (muNumVehicleTypes > 0) {
    r.position = ptrVehicleTypesUpdate;
    for (let i = 0; i < muNumVehicleTypes; i++) {
      vehicleTypesUpdate.push({
        mfWheelRadius: r.readF32(), mfSuspensionRoll: r.readF32(),
        mfSuspensionPitch: r.readF32(), mfSuspensionTravel: r.readF32(),
        mfMass: r.readF32(),
      });
    }
  }

  const vehicleAssets: TrafficVehicleAsset[] = [];
  if (muNumVehicleAssets > 0) {
    r.position = ptrVehicleAssets;
    for (let i = 0; i < muNumVehicleAssets; i++) {
      vehicleAssets.push({ mVehicleId: r.readU64() });
    }
  }

  const vehicleTraits: TrafficVehicleTraits[] = [];
  if (muNumVehicleTraits > 0) {
    r.position = ptrVehicleTraits;
    for (let i = 0; i < muNumVehicleTraits; i++) {
      vehicleTraits.push({
        mfSwervingAmountModifier: r.readF32(), mfAcceleration: r.readF32(),
        muCuttingUpChance: r.readU8(), muTailgatingChance: r.readU8(),
        muPatience: r.readU8(), muTantrumAttackCumProb: r.readU8(),
        muTantrumStopCumProb: r.readU8(), _pad0D: readBytes(r, 3),
      });
    }
  }

  // --- Chase pointers: TrafficLightCollection sub-arrays ---
  const tlcPosYRot: Vec4[] = [];
  if (tlcNumLights > 0) {
    r.position = ptrTlcPosYRot;
    for (let i = 0; i < tlcNumLights; i++) tlcPosYRot.push(readVec4(r));
  }

  const tlcInstanceIDs: number[] = [];
  if (tlcNumLights > 0) {
    r.position = ptrTlcInstanceIDs;
    for (let i = 0; i < tlcNumLights; i++) tlcInstanceIDs.push(r.readU32());
  }

  const tlcInstanceTypes: number[] = [];
  if (tlcNumLights > 0) {
    r.position = ptrTlcInstanceTypes;
    for (let i = 0; i < tlcNumLights; i++) tlcInstanceTypes.push(r.readU8());
  }

  const tlcLightTypes: TrafficLightType[] = [];
  if (tlcNumLightTypes > 0) {
    r.position = ptrTlcLightTypes;
    for (let i = 0; i < tlcNumLightTypes; i++) tlcLightTypes.push(readLightType(r));
  }

  const tlcCoronaTypes: number[] = [];
  if (tlcNumCoronas > 0) {
    r.position = ptrTlcCoronaTypes;
    for (let i = 0; i < tlcNumCoronas; i++) tlcCoronaTypes.push(r.readU8());
  }

  const tlcCoronaPos: Vec4[] = [];
  if (tlcNumCoronas > 0) {
    r.position = ptrTlcCoronaPos;
    for (let i = 0; i < tlcNumCoronas; i++) tlcCoronaPos.push(readVec4(r));
  }

  const tlcHashTable: number[] = [];
  if (tlcNumLights > 0 && ptrTlcHashTable !== 0) {
    r.position = ptrTlcHashTable;
    for (let i = 0; i < tlcNumLights; i++) tlcHashTable.push(r.readU32());
  }

  const tlcHashToIndex: number[] = [];
  if (tlcNumLights > 0 && ptrTlcHashToIndex !== 0) {
    r.position = ptrTlcHashToIndex;
    for (let i = 0; i < tlcNumLights; i++) tlcHashToIndex.push(r.readU16());
  }

  // --- Chase pointers: PaintColours ---
  const paintColours: Vec4[] = [];
  if (muNumPaintColours > 0) {
    r.position = ptrPaintColours;
    for (let i = 0; i < muNumPaintColours; i++) paintColours.push(readVec4(r));
  }

  // Discriminate v44 vs v45 by `muDataVersion`. Field shape is identical;
  // only `kind` differs so the editor registry can pick the right profile.
  const kind = muDataVersion >= 45 ? 'v45' as const : 'v44' as const;
  return {
    kind,
    muDataVersion,
    muSizeInBytes,
    pvs,
    hulls,
    flowTypes,
    killZoneIds,
    killZones,
    killZoneRegions,
    vehicleTypes,
    vehicleTypesUpdate,
    vehicleAssets,
    vehicleTraits,
    trafficLights: {
      posAndYRotations: tlcPosYRot,
      instanceIDs: tlcInstanceIDs,
      instanceTypes: tlcInstanceTypes,
      trafficLightTypes: tlcLightTypes,
      coronaTypes: tlcCoronaTypes,
      coronaPositions: tlcCoronaPos,
      mauInstanceHashOffsets: tlcHashOffsets,
      instanceHashTable: tlcHashTable,
      instanceHashToIndexLookup: tlcHashToIndex,
    },
    paintColours,
  };
}

// =============================================================================
// Write Helpers
// =============================================================================

function writeVec4(w: BinWriter, v: Vec4) {
  w.writeF32(v.x); w.writeF32(v.y); w.writeF32(v.z); w.writeF32(v.w);
}

function writeBytes(w: BinWriter, bytes: number[] | undefined, n: number) {
  for (let i = 0; i < n; i++) w.writeU8(bytes?.[i] ?? 0);
}

function writeSection(w: BinWriter, s: TrafficSection) {
  w.writeU32(s.muRungOffset);
  w.writeU8(s.muNumRungs);
  w.writeU8(s.muStopLineOffset);
  w.writeU8(s.muNumStopLines);
  w.writeU8(s.muSpanIndex);
  for (const h of s.mauForwardHulls) w.writeU16(h);
  for (const h of s.mauBackwardHulls) w.writeU16(h);
  for (const sec of s.mauForwardSections) w.writeU8(sec);
  for (const sec of s.mauBackwardSections) w.writeU8(sec);
  w.writeU8(s.muTurnLeftProb);
  w.writeU8(s.muTurnRightProb);
  w.writeU16(s.muNeighbourOffset);
  w.writeU8(s.muLeftNeighbourCount);
  w.writeU8(s.muRightNeighbourCount);
  w.writeU8(s.muChangeLeftProb);
  w.writeU8(s.muChangeRightProb);
  writeBytes(w, s._pad22, 2);
  w.writeF32(s.mfSpeed);
  w.writeF32(s.mfLength);
  writeBytes(w, s._pad2C, 4);
}

function writeLaneRung(w: BinWriter, rung: TrafficLaneRung) {
  writeVec4(w, rung.maPoints[0]);
  writeVec4(w, rung.maPoints[1]);
}

function writeNeighbour(w: BinWriter, n: TrafficNeighbour) {
  w.writeU8(n.muSection);
  w.writeU8(n.muSharedLength);
  w.writeU8(n.muOurStartRung);
  w.writeU8(n.muTheirStartRung);
}

function writeSectionSpan(w: BinWriter, span: TrafficSectionSpan) {
  w.writeU16(span.muMaxVehicles);
  writeBytes(w, span._pad02, 2);
  // mfMaxVehicleRecip is semantically `1 / muMaxVehicles` but retail
  // bundles store values that don't round-trip through JS's `1/N` for
  // non-power-of-2 N (different FP rounding path in the original
  // generator). Pass through verbatim and keep the two in sync at
  // mutation time via the schema-level derive hook — see
  // TrafficSectionSpan in src/lib/schema/resources/trafficData.ts.
  w.writeF32(span.mfMaxVehicleRecip);
}

function writeStaticVehicle(w: BinWriter, sv: TrafficStaticVehicle) {
  for (let i = 0; i < 16; i++) w.writeF32(sv.mTransform[i] ?? 0);
  w.writeU16(sv.mFlowTypeID);
  w.writeU8(sv.mExistsAtAllChance);
  w.writeU8(sv.muFlags);
  writeBytes(w, sv._pad43, 12);
}

function writeSectionFlow(w: BinWriter, sf: TrafficSectionFlow) {
  w.writeU16(sf.muFlowTypeId);
  w.writeU16(sf.muVehiclesPerMinute);
}

function writeLightController(w: BinWriter, lc: TrafficLightController) {
  for (const id of lc.mauTrafficLightIds) w.writeU16(id);
  for (const id of lc.mauStopLineIds) w.writeU8(id);
  for (const hull of lc.mauStopLineHulls) w.writeU16(hull);
  w.writeU8(lc.muNumStopLines);
  w.writeU8(lc.muNumTrafficLights);
}

function writeJunction(w: BinWriter, j: TrafficJunctionLogicBox, version: number) {
  w.writeU32(j.muID);
  for (const t of j.mauStateTimings) w.writeU16(t);
  for (const s of j.mauStoppedLightStates) w.writeU8(s);
  w.writeU8(j.muNumStates);
  w.writeU8(j.muNumLights);
  writeBytes(w, j._pad36, 2);
  w.writeU32(j.muEventJunctionID);
  w.writeI32(j.miOfflineStartDataIndex);
  w.writeI32(j.miOnlineStartDataIndex);
  if (version >= JUNCTION_BIKE_INDEX_MIN_VERSION) {
    w.writeI32(j.miBikeStartDataIndex);
  }
  for (let i = 0; i < 8; i++) {
    writeLightController(w, j.maTrafficLightControllers[i] ?? {
      mauTrafficLightIds: [0, 0], mauStopLineIds: [0, 0, 0, 0, 0, 0],
      mauStopLineHulls: [0, 0, 0, 0, 0, 0], muNumStopLines: 0, muNumTrafficLights: 0,
    });
  }
  const trailingPadLen = version >= JUNCTION_BIKE_INDEX_MIN_VERSION ? 8 : 12;
  writeBytes(w, j._pad108, trailingPadLen);
  writeVec4(w, j.mPosition);
}

function writeLightTrigger(w: BinWriter, lt: TrafficLightTrigger) {
  writeVec4(w, lt.mDimensions);
  writeVec4(w, lt.mPosPlusYRot);
}

function writeLightTriggerStartData(w: BinWriter, ltsd: TrafficLightTriggerStartData) {
  for (let i = 0; i < 8; i++) writeVec4(w, ltsd.maStartingPositions[i] ?? { x: 0, y: 0, z: 0, w: 0 });
  for (let i = 0; i < 8; i++) writeVec4(w, ltsd.maStartingDirections[i] ?? { x: 0, y: 0, z: 0, w: 0 });
  for (let i = 0; i < 16; i++) w.writeU64(ltsd.maDestinationIDs[i] ?? 0n);
  writeBytes(w, ltsd.maeDestinationDifficulties, 16);
  w.writeU8(ltsd.muNumStartingPositions);
  w.writeU8(ltsd.muNumDestinations);
  w.writeU8(ltsd.muNumLanes);
  writeBytes(w, ltsd._pad193, 13);
}

function writePvsHullSet(w: BinWriter, set: PvsHullSet) {
  for (let i = 0; i < 8; i++) w.writeU16(set.mauItems[i] ?? 0);
  w.writeU32(set.muCount);
}

function writeLightType(w: BinWriter, lt: TrafficLightType) {
  w.writeU8(lt.muCoronaOffset);
  w.writeU8(lt.muNumCoronas);
}

/**
 * Write a Hull header (0x50 bytes) + all its sub-arrays, with 16-byte
 * alignment between blocks. Always sets pointers even for empty arrays
 * (matching the original game writer which points them at the next block).
 *
 * Count fields are DERIVED from the actual array lengths — the `muNum*`
 * fields on the parsed model are only used during reading and the writer
 * ignores them. This makes it impossible for an editor to produce a
 * corrupt bundle by mutating arrays without updating the matching count.
 *
 * `muNumVehicleAssets` is preserved as-is: semantically it's "how many of
 * the fixed-16-entry `mauVehicleAssets` slots are populated", not the
 * array length (the array is always 16).
 */
function writeHullBlock(w: BinWriter, hull: TrafficHull, hullOff: number, version: number) {
  // Header (0x00 - 0x0F) — counts derived from array lengths
  w.writeU8(hull.sections.length);
  w.writeU8(hull.sectionSpans.length);
  w.writeU8(hull.junctions.length);
  w.writeU8(hull.stopLines.length);
  w.writeU8(hull.neighbours.length);
  w.writeU8(hull.staticTrafficVehicles.length);
  w.writeU8(hull.muNumVehicleAssets); // NOT derivable — see doc comment above
  w.writeU8(hull._pad07);
  w.writeU16(hull.rungs.length);
  w.writeU16(hull.muFirstTrafficLight);
  w.writeU16(hull.muLastTrafficLight);
  w.writeU8(hull.lightTriggers.length);
  w.writeU8(hull.lightTriggerStartData.length);
  // 12 pointer placeholders (0x10 - 0x3F)
  for (let i = 0; i < 12; i++) w.writeU32(0);
  // Inline vehicle assets (0x40 - 0x4F)
  for (let i = 0; i < 16; i++) w.writeU8(hull.mauVehicleAssets[i] ?? 0);

  // Sub-arrays — always set pointer (even for empty), align16 between blocks.
  // Order matches the original game writer (verified from binary analysis):
  // sections → spans → rungs → cumRL → neighbours → sectionFlows →
  // junctions → stopLines → lightTrig → ltStartData → ltJuncLookup → static

  w.setU32(hullOff + 0x10, w.offset); // sections
  for (const s of hull.sections) writeSection(w, s);

  w.align16();
  w.setU32(hullOff + 0x20, w.offset); // sectionSpans
  for (const span of hull.sectionSpans) writeSectionSpan(w, span);

  w.align16();
  w.setU32(hullOff + 0x14, w.offset); // rungs
  for (const rung of hull.rungs) writeLaneRung(w, rung);

  w.align16();
  w.setU32(hullOff + 0x18, w.offset); // cumulativeRungLengths
  for (const len of hull.cumulativeRungLengths) w.writeF32(len);

  w.align16();
  w.setU32(hullOff + 0x1C, w.offset); // neighbours
  for (const n of hull.neighbours) writeNeighbour(w, n);

  w.align16();
  w.setU32(hullOff + 0x28, w.offset); // sectionFlows
  for (const sf of hull.sectionFlows) writeSectionFlow(w, sf);

  w.align16();
  w.setU32(hullOff + 0x2C, w.offset); // junctions
  for (const j of hull.junctions) writeJunction(w, j, version);

  w.align16();
  w.setU32(hullOff + 0x30, w.offset); // stopLines
  for (const sl of hull.stopLines) w.writeU16(sl.muParamFixed);

  w.align16();
  w.setU32(hullOff + 0x34, w.offset); // lightTriggers
  for (const lt of hull.lightTriggers) writeLightTrigger(w, lt);

  w.align16();
  w.setU32(hullOff + 0x38, w.offset); // lightTriggerStartData
  for (const ltsd of hull.lightTriggerStartData) writeLightTriggerStartData(w, ltsd);

  w.align16();
  w.setU32(hullOff + 0x3C, w.offset); // lightTriggerJunctionLookup
  for (const jl of hull.lightTriggerJunctionLookup) w.writeU8(jl);

  w.align16();
  w.setU32(hullOff + 0x24, w.offset); // staticTrafficVehicles (last!)
  for (const sv of hull.staticTrafficVehicles) writeStaticVehicle(w, sv);
}

/**
 * Write a FlowType header (0xC bytes) + sub-arrays. Original game writes
 * cumulativeProbs before vehicleTypeIds in memory.
 *
 * `muNumVehicleTypes` is derived from `vehicleTypeIds.length` (the parser
 * sets both to the same value, so byte round-trip is preserved). This
 * avoids drift when editors mutate `vehicleTypeIds` without touching the
 * redundant count field.
 */
function writeFlowTypeBlock(w: BinWriter, ft: TrafficFlowType, ftOff: number) {
  const numVehicleTypes = ft.vehicleTypeIds.length;

  // Header (0xC bytes) — pointers as 0
  w.writeU32(0); // mpauVehicleTypeIds
  w.writeU32(0); // mpauCumulativeProb
  w.writeU8(numVehicleTypes);
  w.writeU8(0); w.writeU8(0); w.writeU8(0); // padding

  if (numVehicleTypes > 0) {
    // CumulativeProbs first (offset 0x4 in header)
    w.align16();
    w.setU32(ftOff + 0x4, w.offset);
    for (const prob of ft.cumulativeProbs) w.writeU8(prob);
    // VehicleTypeIds second (offset 0x0 in header)
    w.align16();
    w.setU32(ftOff + 0x0, w.offset);
    for (const id of ft.vehicleTypeIds) w.writeU16(id);
  }
}

// =============================================================================
// Writing
// =============================================================================

export function writeTrafficDataData(model: ParsedTrafficData, littleEndian = true): Uint8Array {
  if (model.kind === 'v22') {
    throw new Error(
      `TrafficData.write: cannot write v22 prototype payload — the parser is read-only ` +
        `for that version (no on-disk spec for hull contents or tail regions).`,
    );
  }
  if (!SUPPORTED_TRAFFIC_VERSIONS.has(model.muDataVersion)) {
    throw new Error(
      `TrafficData.write: unsupported data version ${model.muDataVersion}. ` +
        `Supported: ${[...SUPPORTED_TRAFFIC_VERSIONS].join(', ')}.`,
    );
  }
  const version = model.muDataVersion;
  // Validate paired-array invariants (header stores one count for both)
  if (model.killZoneIds.length !== model.killZones.length) {
    throw new Error(
      `TrafficData.write: killZoneIds.length (${model.killZoneIds.length}) must equal killZones.length (${model.killZones.length}).`,
    );
  }
  if (model.vehicleTypes.length !== model.vehicleTypesUpdate.length) {
    throw new Error(
      `TrafficData.write: vehicleTypes.length (${model.vehicleTypes.length}) must equal vehicleTypesUpdate.length (${model.vehicleTypesUpdate.length}).`,
    );
  }
  const tlc = model.trafficLights;
  const numLights = tlc.posAndYRotations.length;
  if (tlc.instanceIDs.length !== numLights || tlc.instanceTypes.length !== numLights ||
      tlc.instanceHashTable.length !== numLights || tlc.instanceHashToIndexLookup.length !== numLights) {
    throw new Error(
      `TrafficData.write: TLC light arrays must all have the same length (posAndYRotations=${numLights}, ` +
      `instanceIDs=${tlc.instanceIDs.length}, instanceTypes=${tlc.instanceTypes.length}, ` +
      `hashTable=${tlc.instanceHashTable.length}, hashToIndex=${tlc.instanceHashToIndexLookup.length}).`,
    );
  }
  if (tlc.coronaTypes.length !== tlc.coronaPositions.length) {
    throw new Error(
      `TrafficData.write: coronaTypes.length (${tlc.coronaTypes.length}) must equal coronaPositions.length (${tlc.coronaPositions.length}).`,
    );
  }

  const w = new BinWriter(model.muSizeInBytes || 0x100000, littleEndian);

  // ── TrafficData header (0x170 bytes) — pointer fields written as 0 ──
  w.writeU8(model.muDataVersion);            // 0x0
  w.writeU8(0);                               // 0x1 pad
  w.writeU16(model.hulls.length);             // 0x2
  w.writeU32(0);                              // 0x4 muSizeInBytes (patched at end)
  w.writeU32(0);                              // 0x8 mpPvs
  w.writeU32(0);                              // 0xC mpapHulls
  w.writeU32(0);                              // 0x10 mpapFlowTypes
  w.writeU16(model.flowTypes.length);         // 0x14
  w.writeU16(model.vehicleTypes.length);      // 0x16
  w.writeU8(model.vehicleAssets.length);      // 0x18
  w.writeU8(model.vehicleTraits.length);      // 0x19
  w.writeU16(model.killZones.length);         // 0x1A
  w.writeU16(model.killZoneRegions.length);   // 0x1C
  w.writeU16(0);                              // 0x1E pad
  w.writeU32(0);                              // 0x20 mpaKillZoneIds
  w.writeU32(0);                              // 0x24 mpaKillZones
  w.writeU32(0);                              // 0x28 mpaKillZoneRegions
  w.writeU32(0);                              // 0x2C mpaVehicleTypes
  w.writeU32(0);                              // 0x30 mpaVehicleTypesUpdate
  w.writeU32(0);                              // 0x34 mpaVehicleAssets
  w.writeU32(0);                              // 0x38 mpaVehicleTraits
  // Inline TLC (0x3C). v44 stores muNumCoronas as u8 + 3 bytes pad; v45
  // widened it to u16 + u16 pad. See parser comment above for why this
  // matters for big-endian round-trip.
  w.writeU16(tlc.posAndYRotations.length);    // 0x3C muNumTrafficLights
  w.writeU16(tlc.trafficLightTypes.length);   // 0x3E muNumTrafficLightTypes
  if (version >= 45) {
    w.writeU16(tlc.coronaTypes.length);       // 0x40 muNumCoronas (u16)
    w.writeU16(0);                            // 0x42 pad
  } else {
    w.writeU8(tlc.coronaTypes.length);        // 0x40 muNumCoronas (u8)
    w.writeU8(0); w.writeU8(0); w.writeU8(0); // 0x41..0x43 pad
  }
  w.writeU32(0);                              // 0x44 mpaPosAndYRotations
  w.writeU32(0);                              // 0x48 mpaInstanceIDs
  w.writeU32(0);                              // 0x4C mpauInstanceTypes
  w.writeU32(0);                              // 0x50 mpaTrafficLightTypes
  w.writeU32(0);                              // 0x54 mpaCoronaTypes
  w.writeU32(0);                              // 0x58 mpaCoronaPositions
  for (let i = 0; i < 129; i++) w.writeU16(tlc.mauInstanceHashOffsets[i] ?? 0);
  w.writeU16(0);                              // pad after hash offsets
  w.writeU32(0);                              // 0x160 mpauInstanceHashTable
  w.writeU32(0);                              // 0x164 mpauInstanceHashToIndexLookup
  w.writeU8(model.paintColours.length);       // 0x168
  w.writeU8(0); w.writeU8(0); w.writeU8(0);  // 0x169 pad
  w.writeU32(0);                              // 0x16C mpaPaintColours
  // w.offset is now 0x170

  // ── Pvs ──
  const pvsOff = w.offset;
  w.setU32(0x8, pvsOff);
  writeVec4(w, model.pvs.mGridMin);
  writeVec4(w, model.pvs.mCellSize);
  writeVec4(w, model.pvs.mRecipCellSize);
  w.writeU32(model.pvs.muNumCells_X);
  w.writeU32(model.pvs.muNumCells_Z);
  w.writeU32(model.pvs.muNumCells);
  w.writeU32(0); // mpaHullPvs placeholder
  if (model.pvs.hullPvsSets.length > 0) {
    w.setU32(pvsOff + 0x3C, w.offset);
    for (const set of model.pvs.hullPvsSets) writePvsHullSet(w, set);
  }

  // ── Hull pointer table + per-hull data ──
  if (model.hulls.length > 0) {
    w.align16();
    const hullTableOff = w.offset;
    w.setU32(0xC, hullTableOff);
    for (let i = 0; i < model.hulls.length; i++) w.writeU32(0); // placeholders
    for (let i = 0; i < model.hulls.length; i++) {
      w.align16();
      const hullOff = w.offset;
      w.setU32(hullTableOff + i * 4, hullOff);
      writeHullBlock(w, model.hulls[i], hullOff, version);
    }
  }

  // ── FlowType pointer table + per-flow-type data ──
  if (model.flowTypes.length > 0) {
    w.align16();
    const ftTableOff = w.offset;
    w.setU32(0x10, ftTableOff);
    for (let i = 0; i < model.flowTypes.length; i++) w.writeU32(0);
    for (let i = 0; i < model.flowTypes.length; i++) {
      w.align16();
      const ftOff = w.offset;
      w.setU32(ftTableOff + i * 4, ftOff);
      writeFlowTypeBlock(w, model.flowTypes[i], ftOff);
    }
  }

  // ── Top-level arrays (order matches original game writer) ──
  // VehicleTypes → VehicleTypesUpdate → VehicleTraits → VehicleAssets
  if (model.vehicleTypes.length > 0) {
    w.align16();
    w.setU32(0x2C, w.offset);
    for (const vt of model.vehicleTypes) {
      w.writeU16(vt.muTrailerFlowTypeId); w.writeU8(vt.mxVehicleFlags);
      w.writeU8(vt.muVehicleClass); w.writeU8(vt.muInitialDirt);
      w.writeU8(vt.muAssetId); w.writeU8(vt.muTraitsId); w.writeU8(vt._pad07);
    }
  }
  if (model.vehicleTypesUpdate.length > 0) {
    w.align16();
    w.setU32(0x30, w.offset);
    for (const vtu of model.vehicleTypesUpdate) {
      w.writeF32(vtu.mfWheelRadius); w.writeF32(vtu.mfSuspensionRoll);
      w.writeF32(vtu.mfSuspensionPitch); w.writeF32(vtu.mfSuspensionTravel);
      w.writeF32(vtu.mfMass);
    }
  }
  if (model.vehicleTraits.length > 0) {
    w.align16();
    w.setU32(0x38, w.offset);
    for (const vt of model.vehicleTraits) {
      w.writeF32(vt.mfSwervingAmountModifier); w.writeF32(vt.mfAcceleration);
      w.writeU8(vt.muCuttingUpChance); w.writeU8(vt.muTailgatingChance);
      w.writeU8(vt.muPatience); w.writeU8(vt.muTantrumAttackCumProb);
      w.writeU8(vt.muTantrumStopCumProb); writeBytes(w, vt._pad0D, 3);
    }
  }
  if (model.vehicleAssets.length > 0) {
    w.align16();
    w.setU32(0x34, w.offset);
    for (const va of model.vehicleAssets) w.writeU64(va.mVehicleId);
  }
  // KillZoneIds → KillZones → KillZoneRegions
  if (model.killZoneIds.length > 0) {
    w.align16();
    w.setU32(0x20, w.offset);
    for (const id of model.killZoneIds) w.writeU64(id);
  }
  if (model.killZones.length > 0) {
    w.align16();
    w.setU32(0x24, w.offset);
    for (const kz of model.killZones) {
      w.writeU16(kz.muOffset); w.writeU8(kz.muCount); w.writeU8(kz._pad03);
    }
  }
  if (model.killZoneRegions.length > 0) {
    w.align16();
    w.setU32(0x28, w.offset);
    for (const kzr of model.killZoneRegions) {
      w.writeU16(kzr.muHull); w.writeU8(kzr.muSection);
      w.writeU8(kzr.muStartRung); w.writeU8(kzr.muEndRung); w.writeU8(kzr._pad05);
    }
  }

  // ── TLC sub-arrays (order: PYR, IIDs, ITypes, HashTbl, HashIdx, LTypes, CTypes, CPos) ──
  if (tlc.posAndYRotations.length > 0) {
    w.align16();
    w.setU32(0x44, w.offset);
    for (const v of tlc.posAndYRotations) writeVec4(w, v);
  }
  if (tlc.instanceIDs.length > 0) {
    w.align16();
    w.setU32(0x48, w.offset);
    for (const id of tlc.instanceIDs) w.writeU32(id);
  }
  if (tlc.instanceTypes.length > 0) {
    w.align16();
    w.setU32(0x4C, w.offset);
    for (const t of tlc.instanceTypes) w.writeU8(t);
  }
  if (tlc.instanceHashTable.length > 0) {
    w.align16();
    w.setU32(0x160, w.offset);
    for (const h of tlc.instanceHashTable) w.writeU32(h);
  }
  if (tlc.instanceHashToIndexLookup.length > 0) {
    w.align16();
    w.setU32(0x164, w.offset);
    for (const idx of tlc.instanceHashToIndexLookup) w.writeU16(idx);
  }
  if (tlc.trafficLightTypes.length > 0) {
    w.align16();
    w.setU32(0x50, w.offset);
    for (const lt of tlc.trafficLightTypes) writeLightType(w, lt);
  }
  if (tlc.coronaTypes.length > 0) {
    w.align16();
    w.setU32(0x54, w.offset);
    for (const ct of tlc.coronaTypes) w.writeU8(ct);
  }
  if (tlc.coronaPositions.length > 0) {
    w.align16();
    w.setU32(0x58, w.offset);
    for (const p of tlc.coronaPositions) writeVec4(w, p);
  }

  // ── PaintColours ──
  if (model.paintColours.length > 0) {
    w.align16();
    w.setU32(0x16C, w.offset);
    for (const c of model.paintColours) writeVec4(w, c);
  }

  // ── Patch muSizeInBytes ──
  w.setU32(0x4, w.offset);

  return w.bytes;
}

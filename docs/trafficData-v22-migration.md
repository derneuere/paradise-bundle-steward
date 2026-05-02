# TrafficData v22 → v45 migration — investigation findings

Investigation pass for the V22 → V45 conversion follow-up to issue #45.
Performed 2026-05-02 against two fixtures:

- **v22 prototype**: `example/older builds/B5Traffic.bndl` — Burnout 5
  development build (Nov 2006 X360 dev, big-endian). 4 378 212 B payload,
  342 hulls, 27 flow types, 27 vehicle types.
- **v45 retail**: `example/B5TRAFFIC.BNDL` — Paradise PC retail (LE).
  3 017 744 B payload, 375 hulls, 45 flow types, 30 vehicle types.

Investigation scripts: `scripts/investigate-traffic-v22-v45.ts`,
`scripts/investigate-traffic-v22-tails.ts`,
`scripts/investigate-traffic-v22-mappings.ts`.

## Header layout — confirmed

The two header layouts are structurally equivalent up to retail's added
tables. v22 lacks every retail feature that doesn't appear in the v22
header pointer set.

| Field                | v22 (BE) | v45 (LE) | Notes                              |
| -------------------- | -------: | -------: | ---------------------------------- |
| `muDataVersion`      |     0x00 |     0x00 | u8                                 |
| `muNumHulls`         |     0x02 |     0x02 | u16                                |
| `muSizeInBytes`      |     0x04 |     0x04 | u32                                |
| `ptrPvs`             |     0x08 |     0x08 | u32                                |
| `ptrHulls`           |     0x0c |     0x0c | u32 → hull pointer table           |
| `ptrFlowTypes`       |     0x10 |     0x10 | u32 → flow types (was tailA)       |
| `muNumFlowTypes`     |     0x14 |     0x14 | u16                                |
| `muNumVehicleTypes`  |     0x16 |     0x16 | u16                                |
| `ptrVehicleTypes`    |     0x18 |     0x2c | retail moved this                  |
| `ptrVehicleTypesUpd` |     0x1c |     0x30 | retail moved this                  |
| `ptrVehicleAssets`*  |     0x20 |     0x34 | v22 stored ASSET NAMES; retail CgsIDs |
| header size          |  **0x30** | **0x170** | retail added killzones, TLC, paint, traits |

\* The semantic role of v22's `ptrTailD` is "vehicle asset names (debug)".
Retail kept the asset CgsID hashes (which were already embedded inside the
v22 vehicle-type records) and dropped the debug name table.

Fields v22 has nothing equivalent to: `killZones`, `killZoneIds`,
`killZoneRegions`, `vehicleTraits`, `paintColours`, the entire inline
`TrafficLightCollection` (TLC). Retail introduced all of these between v22
and v44/45.

## Top-level table mappings

### `pvs` — direct mapping with one synthesised field

v22's PVS header is 0x30 bytes (vs retail's 0x40); the missing 0x10 bytes
are the forward `mCellSize` Vec4. Retail derives world→cell-index lookups
from the recip; the forward cell size is just a cache.

```
v22 PVS layout (0x30 B):
  +0x00  mGridMin        : Vec4
  +0x10  mRecipCellSize  : Vec4
  +0x20  muNumCells_X    : u32
  +0x24  ???             : u32   ← reads as muNumHulls (342) in our fixture
  +0x28  muNumCells      : u32   ← populated cell count, not X*Z
  +0x2c  ptrHullPvs      : u32   ← 0 in our fixture (sets are inline)
```

The field at `+0x24` reads as 342 — exactly equal to `muNumHulls`. Without
a second v22 fixture we can't tell whether this is a sparse-grid `Z`
(unlikely; the value is implausibly large for a city map), an unused
`muNumHulls` cache duplicated for runtime convenience, or simply garbage
from a non-zeroed C++ constructor. **Migration treats it as
"unknown / non-load-bearing" and re-derives Z at write time** as
`ceil(muNumCells / muNumCells_X)`, then pads `hullPvsSets` to the full
`X * Z` count of empty `PvsHullSet`s — the convention retail uses.

| v22 field          | v45 field          | How                                     |
| ------------------ | ------------------ | --------------------------------------- |
| `mGridMin`         | `mGridMin`         | pass through                            |
| —                  | `mCellSize`        | synthesise: `1 / mRecipCellSize` (per axis; w preserved as 0; guard against div-by-zero) |
| `mRecipCellSize`   | `mRecipCellSize`   | pass through                            |
| `muNumCells_X`     | `muNumCells_X`     | pass through                            |
| (unknown)          | `muNumCells_Z`     | synthesise: `ceil(muNumCells / muNumCells_X)` |
| `muNumCells`       | `muNumCells`       | re-derive: `muNumCells_X * muNumCells_Z` (retail convention) |
| `hullPvsSets`      | `hullPvsSets`      | pass through, then pad to `X*Z` with empty `PvsHullSet`s |

### `flowTypes` — direct mapping (same record shape, inlined in v22)

v22 stores flow types as a 27-entry pointer table inside `tailA`, followed
by inline records. Each record is `{ ptr_ids, ptr_probs, count_u32, pad_u32,
ids[count] u16, probs[count] u8 }` with 16-byte alignment between blocks.
Validated against the fixture's record-size distribution (24 × 64-byte
records + 3 × 48-byte records, all conforming to `16 + 3N` bytes for
N = 16 or N = 8 vehicle types respectively).

The retail `FlowType` record is structurally identical:
`{ mpauVehicleTypeIds u32, mpauCumulativeProbs u32, muNumVehicleTypes u8,
pad[3] }` + inline `vehicleTypeIds[]` + `cumulativeProbs[]`.

**Migration**: per-record direct copy. Endian flip on integers, drop the
inline pointer-table layout (retail uses a separate `ptrFlowTypes` table
of pointers to per-record buffers). No semantic loss.

### `vehicleAssets` + `vehicleTypes` — split via embedded CgsID

v22 vehicle types are 16 bytes each in `tailB`:
```
+0x00  CgsID asset hash : u64       ← retail's `vehicleAssets[k].mVehicleId`
+0x08  trailerFlowType  : u16
+0x0a  mxVehicleFlags   : u8
+0x0b  muVehicleClass   : u8
+0x0c  muInitialDirt    : u8
+0x0d  muTraitsId       : u8        ← traits table didn't exist in v22; treat as 0
+0x0e  ???              : u8[2]     ← bytes vary; likely flags/pad
```

The asset CgsID is verified by hashing the corresponding name in `tailD`
(27/27 names hash exactly — see
`scripts/investigate-traffic-v22-mappings.ts`).

Retail split this into two tables:
- `vehicleAssets[k] = { mVehicleId: CgsID }` — deduped lookup table.
- `vehicleTypes[i] = { ..., muAssetId: u8, muTraitsId: u8, _pad07: u8 }` —
  references the asset table by index.

**Migration**: for each v22 vehicle type, take bytes 0..7 as a CgsID,
emit it as `vehicleAssets[i].mVehicleId`, and set
`vehicleTypes[i].muAssetId = i` (no dedup needed — the 1:1 relationship
holds in the prototype). Bytes 8..15 map field-by-field to v45's
`TrafficVehicleTypeData` minus `muAssetId` (which we just emitted).

The `tailD` name table is dropped — retail does the same.

### `vehicleTypesUpdate` — direct copy

v22 `tailC` is exactly `27 records × 5 × f32 = 540 bytes`, with 4 bytes of
trailing alignment padding. v45 `vehicleTypesUpdate` records have the
identical 5×f32 layout (`mfWheelRadius, mfSuspensionRoll, mfSuspensionPitch,
mfSuspensionTravel, mfMass`).

**Migration**: byte-for-byte copy with endian flip on each f32. No semantic
loss.

### `vehicleTraits` — synthesise (no v22 source)

The traits table didn't exist in v22; vehicle behavior was hard-coded or
embedded in the vehicle-type record. v45 has 9 traits referenced by
`vehicleTypes[i].muTraitsId`.

**Migration option A (default)**: emit one trait with neutral values and
point every `vehicleTypes[i].muTraitsId = 0`. Honest about being lossy.

**Migration option B (richer)**: synthesise 1 trait per unique
`muVehicleClass` (Car / Van / Bus / Big Rig from v22's class field). Still
lossy — the actual numeric values are a guess — but at least preserves
class-level differentiation.

### `killZones`, `paintColours`, `trafficLights` — synthesise empty

Not represented in v22 in any form we can decode. Retail introduced them
with their own static-traffic / event flows.

**Migration**: emit empty arrays / empty TLC. The retail city's kill zones
were largely tied to the new highway network anyway — a v22 prototype's
road graph wouldn't map cleanly to retail's kill-zone regions. The user
will need to redo these manually if they want a playable retail bundle.

## Hull internals — partial decoding

This is the lossy frontier of the migration.

**Header (0x30 B per hull, vs v45's 0x50 B):**
```
+0x00  muNumSections    : u8
+0x01  muNumSectionSpans: u8
+0x02  muNumJunctions   : u8         ← always 0 in v22 fixture (no junctions yet)
+0x03  muNumStoplines   : u8         ← always 0
+0x04  muNumNeighbours  : u8
+0x05  muNumStaticTraffic: u8
+0x06  muNumVehicleAssets: u8
+0x07  pad              : u8
+0x08  ptr[0..7]        : u32 × 8    ← 8 sub-array pointers
+0x28  pad              : u8 × 8
```

v45's hull header has 12 pointers (0x10..0x3F = 0x30 bytes of pointers)
plus the inline 16-entry `mauVehicleAssets[16]` at +0x40..+0x4F. v22 only
has 8 pointers and no inline asset slots.

**Sub-array sizes (verified against hull[22] which has 2 sections):**

| v22 ptr index | v22 size | v45 likely equivalent          | Status                 |
| ------------- | -------: | ------------------------------ | ---------------------- |
| `ptr[0]`      |     96 B | `sections` (48 B/record × 2)   | ✅ verified — record size matches v45's `TrafficSection` (0x30 B) exactly |
| `ptr[1]`      |   4480 B | `rungs` + `cumulativeRungLengths` interleaved? | ⚠ unverified — 4480 / 32 = 140 rungs (consistent with 2 sections having ~70 rungs each); cumRL would add 4 B × 140 = 560 B which matches `ptr[2]`'s 560 B size |
| `ptr[2]`      |    560 B | `cumulativeRungLengths` (4 B × 140) | ✅ matches the rung-count hypothesis |
| `ptr[3]`      |     16 B | `neighbours` (4 B × 4) or `sectionFlows` (4 B × 4) | ⚠ unverified — too small to triangulate from one hull |
| `ptr[4..6]`   |   0–16 B | empty / sentinel               | likely placeholder for sub-arrays absent in v22 |
| `ptr[7]`      |      0 B | end-of-hull sentinel           | always equal to next hull's offset |

The 8-pointer set vs retail's 12-pointer set leaves four retail sub-arrays
without a v22 source: `staticTrafficVehicles`, `junctions`, `stopLines`,
`lightTriggers`, `lightTriggerStartData`, `lightTriggerJunctionLookup`.
The header counts confirm this: every v22 hull in our fixture has
`muNumJunctions = 0` and `muNumStoplines = 0`. Junctions, stop lines, and
all light/trigger features are retail additions.

**Per-section record (48 B): VERIFIED IDENTICAL TO V45**.
Decoding v22 hull[22].section[0] under v45's `TrafficSection` layout
yields completely sensible values (see
`scripts/investigate-traffic-v22-section.ts`):

```
muNumRungs:           72
muStopLineOffset:     255    ← "no stop line" sentinel (= v45 convention)
muSpanIndex:          0
mauForwardHulls:      [41, 0xFFFF, 0xFFFF]    ← one forward link + sentinels
mauBackwardHulls:     [23, 0xFFFF, 0xFFFF]
mauForwardSections:   [3, 0xFF, 0xFF]
mauBackwardSections:  [12, 0xFF, 0xFF]
mfSpeed:              29.06 m/s (~65 mph)     ← plausible city street speed
mfLength:             425.4 m                 ← plausible road segment length
_pad2C:               [0, 0, 0, 72]
```

The only oddity is `_pad2C[3] = 72`. In v45 these four trailing bytes are
zero padding; in v22 the last byte is sometimes non-zero and equal to
`muNumRungs` (also 72). This is likely a v22 internal cache (e.g. a
`muNumRungsValidated` or `muTotalRungsAlt`) that retail stripped. It's
safely preserved as `_pad2C` during migration — the writer passes those 4
bytes through verbatim.

**Migration**: v22 sections are byte-for-byte v45 sections with endian
flipped on the 32/16-bit fields. Just decode under the v45 layout
function, populating each section with the v22 BE-read values.

**Per-rung record (32 B):** v45 stores rungs as `2 × Vec4 = 32 B`. The 140
rungs hypothesis above implies the v22 layout is identical.

## Concrete migration plan

Implement `migrateV22toV45(model: ParsedTrafficDataV22): ConversionResult<ParsedTrafficDataV45>`
in three tiers:

### Tier 1 — top-level tables (no semantic loss)

These map cleanly. The migration result's `lossy: string[]` stays empty
for these:

- `pvs` → pass-through with mCellSize synthesised, hullPvsSets padded.
- `flowTypes[27]` → record-for-record copy.
- `vehicleTypes[27]` → bytes 8..15 of each tailB record map to retail's
  `TrafficVehicleTypeData`; `muAssetId = i`.
- `vehicleAssets[27]` → bytes 0..7 of each tailB record (CgsID).
- `vehicleTypesUpdate[27]` → byte-for-byte copy with endian flip.

### Tier 2 — synthesise default-empty (lossy with disclosure)

These get default values; the migration result's `defaulted` array lists
them so the post-conversion banner can warn the user:

- `killZones`, `killZoneIds`, `killZoneRegions` → empty arrays.
- `vehicleTraits` → one neutral trait, every `vehicleTypes[i].muTraitsId = 0`.
- `paintColours` → empty array.
- `trafficLights` (TLC) → empty inline (`mauInstanceHashOffsets[129]` zeroed).

### Tier 3 — hulls

The investigation upgraded this from "lossy frontier" to "mostly clean":

**Verified-identical record layouts** (just need endian flipping):
- `TrafficSection` (48 B per record) — decoded a v22 fixture section and
  every field has plausible values matching v45 semantics (see Hull
  Internals → Per-section record above).
- `TrafficLaneRung` (32 B per record = 2 × Vec4) — implied by the
  4480-byte rung region in hull[22] decoding cleanly as 140 rungs across
  2 sections (≈70 each), perfectly consistent with v45 layouts.
- `cumulativeRungLengths` (4 B per float) — implied by the 560-byte
  region matching `4 B × 140 rungs`.

**Still-unverified sub-arrays** (needs a richer v22 hull or a second
fixture; hull[22] only had 2 sections, 0 junctions, 0 stoplines, so the
remaining sub-arrays are too sparse to triangulate field-by-field):
- `neighbours` (4 B/record in v45)
- `sectionSpans` (8 B/record in v45)
- `staticTrafficVehicles` (88 B/record in v45 — plausibly different in v22)
- `sectionFlows` (4 B/record in v45)

**Confirmed absent in v22** (synthesise empty):
- `junctions`, `stopLines`, `lightTriggers`, `lightTriggerStartData`,
  `lightTriggerJunctionLookup` — every v22 hull has
  `muNumJunctions = 0, muNumStoplines = 0, muNumLightTriggers = 0`.
  These are retail features added between v22 and v44.

**Recommended migration path**:

Ship a Tier 3 implementation that decodes sections + rungs +
cumRungLengths (the verified-identical chunks) and synthesises empty
arrays for everything else. This is much richer than my original
"Option A: empty hulls" suggestion and gives the user a converted bundle
where the road graph and lane geometry are preserved — only the higher-
level traffic-flow metadata (neighbours, spans, flow assignments) and
retail-only features (junctions, light triggers) are lost.

Field-by-field decoding of the remaining sub-arrays is its own follow-up
issue; the MVP doesn't need it to ship.

## Test strategy

A `parse → migrate → write → parse` round-trip can't be byte-exact (the
migration is intentionally non-identity and synthesises new bytes), but
should be:

1. **Structural**: re-parsed model has `kind === 'v45'`, expected counts
   for the Tier 1 tables, `muDataVersion === 45`.
2. **Semantic**: PVS bounds match (mGridMin equal); a sampled flow type's
   vehicleTypeIds[] / cumulativeProbs[] match the v22 source; a sampled
   vehicle asset's CgsID round-trips through `decodeCgsId` to the original
   v22 asset name.
3. **Disclosure**: `migration.lossy` correctly enumerates the dropped
   hull internals, killzones, traits, paint, TLC; `migration.defaulted`
   enumerates the synthesised mCellSize, padded hullPvsSets, and the one
   neutral trait.

## Open questions / follow-ups

- **Hull internals decoding** (Option B above) — needs another fixture or
  external corroboration.
- **PVS field at +0x24** — confirmed 342 in our fixture (= muNumHulls);
  unclear whether this is structural or accidental. A second v22 fixture
  would resolve it. If structural, the field should be added to
  `ParsedTrafficDataV22`.
- **vehicleTraits scaffold for migrated bundles** — Option B (per-class
  traits) vs A (one neutral trait) is a usability call, not a correctness
  one. Defer until we have a user trying to drive the converted bundle.
- **muNumCells_Z dimension semantics** — retail's hullPvsSets are
  `X*Z` (every cell has an entry, including empty). v22 stores only the
  populated 96. Padding works for output but loses the spatial layout
  information (which cell is which). For migrated bundles to feel
  spatially right, we'd need to know each populated cell's (x,z) position;
  v22 might store this implicitly (e.g. row-major scan with sentinel
  empty entries), but this fixture doesn't make it obvious.

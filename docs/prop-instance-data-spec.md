# Prop Instance Data (`PRP_INST_*`) — format spec

**Resource type ID:** `0x10011`
**Other names:** PropInstances. **Filename pattern:** `PRP_INST_<trackUnitId>`.
**Category:** Game-specific (Burnout Paradise). **Memory distribution:** Main memory only.
**Source:** [Burnout wiki — Prop Instance Data](https://burnout.wiki/wiki/Prop_Instance_Data), captured 2026-06-08.
**Prop type table:** [`prop-types.md`](prop-types.md) → [`src/lib/core/propTypes.ts`](../src/lib/core/propTypes.ts).

Prop Instance Data places **props** (signs, lampposts, cones, spinning billboards,
collectibles, …) into a track unit. The top-level resource is a
`BrnPhysics::Props::PropZoneData`: a flat array of `PropInstanceData` records,
partitioned into spatial **cells** (a coarse XZ grid) so the runtime can
stream/spawn props near the player. Each instance references a **prop type**
(index into [`prop-types.md`](prop-types.md)) and carries a full world transform.

> **Ordering matters.** Each cell carries two counts, `muNumberOfRespawnDifferent`
> and `muNumberOfDontRespawn`, that partition its instances by respawn behaviour.
> The exact within-cell layout is **believed** to be respawn-changed first, then
> don't-respawn, then the remainder — but only the two counts are certain; the
> precise ordering is **unconfirmed**. Collectibles and other respawn-sensitive
> props only work when laid out in that order — the reason this editor exists
> (Blender exporters don't expose the toggles). The round-trip and editor MUST
> preserve instance order
> within each cell exactly.

## High-level model

```
PropZoneData (0x10011)
  ├─ header (32 bytes, 32-bit layout)
  ├─ instances: PropInstanceData[muNumberOfProps]   // at 0x20, 0x50 (80) bytes each
  ├─ cells:     PropCellData[muNumCells]             // immediately after instances, 0x0C (12) bytes each
  └─ <zero tail>                                     // pad to the resource's stored size
```

`maInstances` and `maCells` are absolute byte offsets into the payload; on read
they are recomputed-able and on write are re-derived from the fixed layout.

## On-disk structures (32-bit PC, little-endian — the only target)

The wiki also documents a 64-bit (Paradise Remastered) layout; like
streetData/trafficData/zoneList we implement **32-bit PC LE only**. Console
(BE) and 64-bit are out of scope.

### `PropZoneData` header — 32 bytes

| Offset | Size | Type | Name | Notes |
|--------|------|------|------|-------|
| 0x00 | 4 | `PropCellData*` | `maCells` | abs offset to the cell array; = `0x20 + muNumberOfProps*0x50` |
| 0x04 | 1 | u8 | `muNumCells` | cell count |
| 0x05 | 3 | — | padding | zero |
| 0x08 | 4 | `PropInstanceData*` | `maInstances` | abs offset to instances; **always `0x20`** |
| 0x0C | 4 | u32 | `muSizeInBytes` | **stored field; does NOT equal the buffer length** (see below) — preserve verbatim |
| 0x10 | 4 | u32 | `muNumberOfInstances` | total runtime instance slots = `muNumberOfProps` + every prop's part count (the zone loader allocates one slot per prop + one per part). So it's `>=` the stored prop count. Part counts live in the PropGraphicsList, not here, so it's preserved verbatim |
| 0x14 | 4 | u32 | `muNumberOfProps` | **count of stored `PropInstanceData` records** = `instances.length` |
| 0x18 | 2 | u16 | `muZoneId` | track-unit / zone id (e.g. 206) |
| 0x1A | 2 | — | padding | zero |
| 0x1C | 4 | — | padding | zero — the header is padded up to `0x20` (where `maInstances` always points). The wiki table stops at `muZoneId`, but the real header occupies a full 32 bytes. |

### `PropCellData` — 12 bytes (`0x0C`)

| Offset | Size | Type | Name | Notes |
|--------|------|------|------|-------|
| 0x00 | 4 | `PropCellId` | `mId` | `{ u16 muX, u16 muZ }` — grid coords |
| 0x04 | 2 | u16 | `muStartIndex` | first instance index this cell owns; = running sum of prior `muCount` |
| 0x06 | 2 | u16 | `muCount` | number of instances in this cell |
| 0x08 | 2 | u16 | `muNumberOfRespawnDifferent` | of the cell's instances, how many are "respawn different" (ordered first) |
| 0x0A | 2 | u16 | `muNumberOfDontRespawn` | how many are "don't respawn" (ordered after the respawn-different ones) |

Cells partition the instance array contiguously: `cells[0].muStartIndex == 0`,
`cells[i].muStartIndex == cells[i-1].muStartIndex + cells[i-1].muCount`, and the
sum of all `muCount` equals `muNumberOfProps`.

### `PropInstanceData` — 80 bytes (`0x50`)

| Offset | Size | Type | Name | Notes |
|--------|------|------|------|-------|
| 0x00 | 0x40 | `Matrix44Affine` | `mWorldTransform` | 16 × f32, row-major. Translation is the **last row** (floats 12,13,14 = world X,Y,Z) |
| 0x40 | 4 | u32 | `muTypeIdAndFlags` | lower **26 bits** = prop type index (into prop-types); upper **6 bits** = flags |
| 0x44 | 4 | u32 | `muInstanceID` | per-instance id |
| 0x48 | 2 | u16 | `muAlternativeType` | alternate prop type index, or `0xFFFF` = none |
| 0x4A | 1 | u8 | `mn8RotSpeed` (rotation byte) | Packs two fields: **top 2 bits (`& 0xC0`) = spinning axis** — `0x40` Y, `0x80` Z, `0xC0` none (`0x00` also occurs, e.g. static props); **low 6 bits (`& 0x3F`) = speed magnitude** (0–63). Modelled split as `mRotationAxis` + `mn8RotSpeed`; recombined on write. (An earlier reading as a single signed i8 saw `-64` = `0xC0` = axis-none/speed-0.) |
| 0x4B | 1 | u8 | `mn8MaxAngle` | |
| 0x4C | 1 | u8 | `mn8MinAngle` | |
| 0x4D | 3 | u8[3] | `mau8Padding` | zero — preserve verbatim |

### `muTypeIdAndFlags` bit packing

```
typeId = muTypeIdAndFlags & 0x03FFFFFF           // lower 26 bits → index into prop-types.md
flags  = muTypeIdAndFlags >>> 26                  // upper 6 bits
muTypeIdAndFlags = (flags << 26) | (typeId & 0x03FFFFFF)   // writer recombines
```

**Prop instance flags** (the upper 6 bits; values are pre-shift, i.e. the flag bit
position within the 6-bit field):

| Name | Bit value (within the 6-bit flags field) | Encoded value (`<< 26`) | Meaning |
|------|------|------|---------|
| `KI_PROP_FLAG_DISABLEPHYSICS` | 1 | 0x04000000 | Disable physics |

The parser splits `muTypeIdAndFlags` into model fields `typeId` (number, indexes
prop-types) and `flags` (number, the 6-bit field); the writer recombines.
`muAlternativeType` is its own field; `0xFFFF` (`PROP_ALT_TYPE_NONE`) means none.

## Real-fixture findings (verified 2026-06-08)

Decoded against the user's gold file `example/BE_9F_C7_93.dat` (TRK 206, raw
extracted resource, 27680 bytes) and two real bundle-embedded resources:

| fixture | bytes | numCells | muNumberOfProps | muNumberOfInstances | muSizeInBytes | muZoneId | tail all-zero |
|---------|------:|---------:|----------------:|--------------------:|--------------:|---------:|:---:|
| `BE_9F_C7_93.dat` (TRK 206, raw) | 27680 | 8 | 172 | 361 | 27648 | 206 | yes |
| `TRK_UNIT9_GR.BNDL` (embedded) | 11504 | 6 | 71 | 123 | 11464 | 9 | yes |
| `TRK_UNIT10_GR.BNDL` (embedded) | 6016 | 3 | 37 | 116 | 5988 | 10 | yes |

Invariants confirmed on all three (the layout is **rigid**):

1. `maInstances == 0x20` always; instances are 80 bytes; `maCells == 0x20 + muNumberOfProps*0x50` exactly.
2. `(maCells - maInstances) / 0x50 == muNumberOfProps` (the stored record count). `muNumberOfInstances` is a different, larger number = props + every prop's part count (total runtime instance slots) — **not** the stored prop count; preserve it verbatim.
3. Cells immediately follow instances; everything after the cells is **all zero**.
4. `muSizeInBytes` does NOT track the buffer length consistently (gold: len−32; TRK9: len−40; TRK10: len−28 — and TRK10's `muSizeInBytes` even exceeds `len−header`). It is an internal stored field → **preserve verbatim**, and reproduce the exact buffer length from a captured trailing-pad buffer.

Gold-file value checks (the user's verification data — pin these in a test):

```
header: maCells=0x35e0 muNumCells=8 maInstances=0x20 muSizeInBytes=27648
        muNumberOfInstances=361 muNumberOfProps=172 muZoneId=206
cell[2]: muX=70 muZ=37 muStartIndex=10 muCount=51 respawnDifferent=1 dontRespawn=4  (→ instances #10..#60)
inst[10]: typeId=8  (billboard_overdrive_YELLOW) instanceID=473825 altType=245 pos≈(2025.59, 11.67, -1292.24)
inst[11]: typeId=6  (STU_gate01)                 instanceID=463630 altType=0xFFFF pos≈(2033.68, 8.09, -1288.96)
inst[15]: typeId=154 (Sign_OceanView_R)          instanceID=373047 pos≈(2043.06, 15.79, -1261.62)
inst[16]: typeId=207 (sign_waterfront_L_055)     instanceID=373048 pos≈(2080.40, 15.13, -1256.40)
```

## Parsed model shape

```ts
type Matrix44 = number[]; // length 16, row-major (translation = indices 12,13,14)

type PropInstance = {
  mWorldTransform: Matrix44;     // 16 f32
  typeId: number;                // muTypeIdAndFlags & 0x03FFFFFF (index into prop-types)
  flags: number;                 // muTypeIdAndFlags >>> 26 (6-bit field)
  muInstanceID: number;          // u32
  muAlternativeType: number;     // u16, 0xFFFF = none
  mRotationAxis: number;         // rotation byte & 0xC0 — 0x00 / 0x40(Y) / 0x80(Z) / 0xC0(none)
  mn8RotSpeed: number;           // rotation byte & 0x3F — speed magnitude 0..63
  mn8MaxAngle: number;           // u8
  mn8MinAngle: number;           // u8
  _pad4D: [number, number, number]; // u8[3], preserved (zero)
};

type PropCell = {
  muX: number; muZ: number;                 // PropCellId — editable
  muStartIndex: number;                     // editable (written verbatim; not recomputed)
  muCount: number;                          // editable (written verbatim)
  muNumberOfRespawnDifferent: number;       // u16
  muNumberOfDontRespawn: number;            // u16
};

type ParsedPropInstanceData = {
  muZoneId: number;             // editable
  muSizeInBytes: number;        // preserved verbatim (readOnly)
  muNumberOfInstances: number;  // preserved verbatim (readOnly)
  instances: PropInstance[];
  cells: PropCell[];
  _trailingPad: Uint8Array;     // bytes from end-of-cells to end-of-buffer (all zero) — reproduces exact length
};
```

`muNumberOfProps` is **not** stored on the model (it equals `instances.length`);
the writer emits `instances.length`. `muStartIndex`/`muCount` are recomputed from
the cell partition on write (each cell consumes the next `muCount` instances).

## Round-trip / writer strategy

Byte-exact (`byteRoundTrip`) is achievable — the layout is rigid and the tail is
zero. Writer:

1. **Header (32 bytes):** `maInstances=0x20`; `muNumCells=cells.length` (u8) + 3 pad; `maCells = 0x20 + instances.length*0x50`; `muSizeInBytes` (verbatim); `muNumberOfInstances` (verbatim); `muNumberOfProps = instances.length`; `muZoneId`; 2 pad.
2. **Instances:** for each, 16 f32 transform; `muTypeIdAndFlags = (flags << 26) | (typeId & 0x03FFFFFF)`; `muInstanceID`; `muAlternativeType`; the rotation byte = `(mRotationAxis & 0xC0) | (mn8RotSpeed & 0x3F)`; `mn8MaxAngle`; `mn8MinAngle`; 3 pad bytes from `_pad4D`.
3. **Cells:** `muX`,`muZ`,`muStartIndex`,`muCount`,`muNumberOfRespawnDifferent`,`muNumberOfDontRespawn` all written **verbatim** from the model (the partition is editable — see below; not recomputed).
4. **Trailing pad:** append `_trailingPad` verbatim (zeros) → reproduces the exact original length.

This matches the `zoneList` precedent (recompute pointers + preserve verbatim
pad for byte-exactness). On structural mutation (add/remove instances or cells)
the trailing pad is appended unchanged and `muSizeInBytes` is kept verbatim;
re-parse stays consistent because cells are located via the recomputed `maCells`,
not a fixed offset.

## Editor / resourcespec notes

- `typeId` → enum dropdown sourced from `PROP_TYPES` (247 entries). `muAlternativeType` → same enum plus a `0xFFFF = (none)` entry.
- `flags` → flags field with `KI_PROP_FLAG_DISABLEPHYSICS` (mask `0x1` within the 6-bit field).
- `mWorldTransform` → `matrix44` leaf. Translation (world position) lives in indices 12/13/14; surface that in the tree label so artists can find a prop by position.
- The rotation byte is split into two editable fields: `mRotationAxis` → enum (`Unset 0x00` / `Y 0x40` / `Z 0x80` / `None 0xC0`) and `mn8RotSpeed` → `u8` clamped 0–63 (the speed magnitude). They recombine into one byte on write.
- Cell `muStartIndex`/`muCount` are **editable** (written verbatim — some tools set the partition by hand; see the round-trip note). `muSizeInBytes`, `muNumberOfInstances` are `readOnly`/preserved. `_trailingPad`, `_pad4D` are `hidden` round-trip-only fields.
- Tree labels: instance → `#i · <propName> · id <muInstanceID> · (x, z)`; cell → `(X=muX, Z=muZ) · #start..#end · R<respawnDifferent>/D<dontRespawn>`.

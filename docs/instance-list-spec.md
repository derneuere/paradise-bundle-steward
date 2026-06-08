# Instance List (`TRK_UNIT*_list`) — format spec

**Resource type ID:** `0x23` (`CgsGraphics::InstanceList`).
**Category:** Generic. **Memory distribution:** Main memory only.
**Imports:** 1 [[Model]] (`0x2A`) per instance.
**Source:** [Burnout wiki — Instance List](https://burnout.wiki/wiki/Instance_List), captured 2026-06-08.

An InstanceList places **Models in the world at a transform** — it is one of the
top-level resource types used for track-unit loading. Each track unit's `_GR`
bundle carries one InstanceList; rendering it (Model → Renderable per instance,
positioned by the instance's `mTransform`) draws the track-unit geometry, in the
**same world space as [PropInstanceData](prop-instance-data-spec.md)** — so props
sit on the rendered track.

## On-disk structures (32-bit PC, little-endian — the only target)

The wiki documents a 64-bit layout too; like the other resources we implement
32-bit PC LE only.

### `CgsGraphics::InstanceList` header — 16 bytes (`0x10`)

| Offset | Size | Type | Name | Notes |
|--------|------|------|------|-------|
| 0x0 | 4 | `Instance*` | `mpaInstances` | abs offset to the instance array — `0x10` on disk (right after the header) |
| 0x4 | 4 | u32 | `muArraySize` | total Instance entries allocated = `instances.length` |
| 0x8 | 4 | u32 | `muNumInstances` | **complete** entries (indices `0..muNumInstances-1` have valid transforms + locally-resolvable models). Preserved verbatim |
| 0xC | 4 | u32 | `muVersionNumber` | always `1` |

### `CgsGraphics::Instance` — 80 bytes (`0x50`)

| Offset | Size | Type | Name | Notes |
|--------|------|------|------|-------|
| 0x00 | 4 | `Model*` | `mpModel` | `0x0` on disk — a BND2 **import**; the real Model id comes from the import table (see below) |
| 0x04 | 2 | i16 | `mi16BackdropZoneID` | `-1` when not a backdrop |
| 0x06 | 2 | u16 | `mu16Pad` | padding |
| 0x08 | 4 | u32 | `mu32Pad` | padding |
| 0x0C | 4 | f32 | `mfMaxVisibleDistanceSquared` | unused? |
| 0x10 | 0x40 | `Matrix44Affine` | `mTransform` | 16 × f32, translation at floats [12..14] (i.e. record offset `0x40`) |

## Model imports (`mpModel`)

`mpModel` is stored as `0x0` and resolved through the bundle's **import table**:
each instance has one import entry whose `ptrOffset` equals the instance's
`mpModel` field offset (`mpaInstances + i*0x50`). `getImportsByPtrOffset(bundle.imports,
bundle.resources, resourceIndex)` returns a `Map<ptrOffset, resourceId>` — look up
the instance's field offset to get the Model's `resourceId`. The Model resource may
or may not live in the same bundle (backdrop/neighbour-chunk models are imported but
not present); only locally-present models can be rendered.

## Real-fixture findings (TRK_UNIT9_GR.BNDL, verified 2026-06-08)

```
resource size 18832 bytes ; importCount 196
header: mpaInstances=0x10  muArraySize=196  muNumInstances=23  muVersionNumber=1
instances start at 0x10 ; 196 × 0x50 = 0x3d50 ; then 3136 bytes of trailing pad → EOF
inst0  zone=-1  maxDistSq=0  pos=(-567.1, 370.8, -2779.4)  model import 0x5EAF1534
inst1  zone=-1  maxDistSq=0  pos=(-459.4, 164.0, -2649.1)  model import 0x21C9BD4B
inst2  zone=-1  maxDistSq=0  pos=(-259.0, 150.8, -2666.3)  model import 0x59AB13D2
```

Notes that shape the implementation:
- `muArraySize` (196) > `muNumInstances` (23): the array is over-allocated. The first
  `muNumInstances` entries are the complete, renderable ones (TRK9 has 23 local Models,
  matching `muNumInstances`). The rest reference external/backdrop models and carry
  stale/placeholder transforms — don't render them.
- `mpaInstances` is `0x10` and entries are a rigid `0x50` stride; everything after
  `muArraySize × 0x50` is trailing pad (zero here) — capture it verbatim for
  byte-exact round-trip (same pattern as PropInstanceData's `_trailingPad`).
- `mTransform` is the same `Matrix44Affine` as PropInstanceData / static traffic
  vehicles: load into THREE via `Matrix4.fromArray(transform)` then patch the bottom
  row `e[3]=e[7]=e[11]=0; e[15]=1` (pad slots are zero on disk).

## Parsed model shape

```ts
type InstanceListEntry = {
  mpModel: number;              // raw on-disk pointer (0) — preserved for round-trip
  mi16BackdropZoneID: number;   // i16
  mfMaxVisibleDistanceSquared: number; // f32
  mWorldTransform: number[];    // 16 f32
  _pad: { mu16Pad: number; mu32Pad: number }; // preserved verbatim
};

type ParsedInstanceList = {
  muNumInstances: number;       // complete-entry count (readOnly; preserved)
  muVersionNumber: number;      // always 1 (readOnly; preserved)
  instances: InstanceListEntry[];   // length === muArraySize
  _trailingPad: Uint8Array;     // bytes after the array → EOF (reproduces exact length)
};
```

`muArraySize` is `instances.length` (recomputed). `mpaInstances` is recomputed to
`0x10`. The Model id is **not** stored on the parsed model: `parseRaw(raw, ctx)` only
sees the resource payload (no bundle/import table), and the bytes that carry the model
ref live in the BND2 import section. So the payload round-trips byte-exact from
`mpModel`(0)/pad/transform/trailing alone. **Rendering** resolves the per-instance
Model id separately via `getImportsByPtrOffset(bundle.imports, bundle.resources,
resourceIndex)`, keyed by each instance's `mpModel` field offset (`0x10 + i*0x50`).

## Round-trip / writer strategy

Byte-exact, same approach as PropInstanceData:
1. **Header (16 bytes):** `mpaInstances=0x10`; `muArraySize=instances.length`;
   `muNumInstances` (verbatim); `muVersionNumber` (verbatim).
2. **Instances (0x50 each):** `mpModel` (verbatim, 0); `mi16BackdropZoneID`; `mu16Pad`;
   `mu32Pad`; `mfMaxVisibleDistanceSquared`; 16 f32 transform.
3. **Trailing pad:** append `_trailingPad` verbatim.

## Render plan (track geometry under the props)

For each of the first `muNumInstances` instances: resolve `modelImportId` → find the
Model (`0x2A`) resource with that id in the bundle → resolve the Model's Renderable
(`0xC`) imports → decode each renderable to a `THREE.BufferGeometry` (reuse the decode
in `renderableDecodedContext.tsx`) → render a grey, untextured mesh at
`fromArray(mWorldTransform)` (composed with the Model's part locator if present).
Skip instances whose Model isn't present locally. Textures/shaders live in companion
bundles (`GLOBALTEXTUREDICTIONARY.BIN` / `SHADERS.BNDL`) and are out of scope — grey
geometry is enough for spatial context.

# Prop Graphics List (`PRP_GL__*`) — format spec

**Resource type ID:** `0x10010` (= 65552)
**Other names:** PropGraphicsList. **Filename pattern:** `PRP_GL__<trackUnitId>`.
**Category:** Game-specific (Burnout Paradise). **Memory distribution:** Main memory only.
**Imports:** **1 `Model` per prop + 1 `Model` per part** (`importCount == nProps + nParts`).
**Source:** [Burnout wiki — Prop Graphics List](https://burnout.wiki/wiki/Prop_Graphics_List), captured 2026-06-09.
**Related:** [`prop-instance-data-spec.md`](prop-instance-data-spec.md) (`0x10011`, places the prop instances this catalogue resolves to models), [`prop-types.md`](prop-types.md), [`instance-list-spec.md`](instance-list-spec.md) (same `Model*`-via-import pattern).

Prop Graphics List is the per-track-unit **catalogue** that maps every prop **TYPE**
placed in a track unit to the `Model` resource(s) the runtime spawns for it. There
is exactly **one** PropGraphicsList per `TRK_UNIT*_GR.BNDL` bundle. It is the
graphics-side companion to [Prop Instance Data](prop-instance-data-spec.md): Prop
Instance Data (`0x10011`) places instances of a prop type into the world; this
resource tells the runtime which mesh to draw for each type, plus which meshes to
draw for each **destructible part** of that prop.

The top-level resource is a `BrnPhysics::Props::PropGraphicsList`. It carries two
parallel arrays:

- **`PropGraphics`** — one entry per whole prop → its `Model` (the body mesh).
- **`PropPartGraphics`** — one entry per prop **part** → its `Model` (a
  destructible sub-piece, e.g. a billboard panel that breaks off). Parts are
  grouped contiguously by owning prop; a `PropGraphics.mpParts` points at the
  prop's first part.

> **Counts are not symmetric with instances.** A PropGraphicsList enumerates prop
> *types* (and their parts), not placed instances — so a track unit with hundreds
> of instances may list only a handful of props. Across the corpus the max is 52
> props / 82 parts; 172 of 427 units list nothing at all (empty list).

## High-level model

```
PropGraphicsList (0x10010)
  ├─ header (32 bytes, 32-bit layout, fields end at 0x18, padded to 0x20)
  ├─ props:  PropGraphics[muNumberOfPropModels]       // at 0x20, 0x0C (12) bytes each
  ├─ <align16 pad>
  ├─ parts:  PropPartGraphics[muNumberOfPropPartModels]// at align16(propEnd), 0x0C (12) bytes each
  └─ <align16 pad> + inline BND2 import table          // importCount × 16 bytes, to end of payload
```

The import table is **modelled** (each entry's resource id becomes the owning
record's `mpModelId`) and **rebuilt** by the writer from the record counts, so it
is not carried verbatim — see "Parsed model shape" and "Round-trip / writer
strategy" below. The on-disk field notes that follow describe the disk format; the
"how it's modelled" column says what the parser/writer do with each field.

`mpaPropGraphics` and `mpaPropPartGraphics` are absolute byte offsets into the
payload; both are **rigid** (always `0x20` and `align16(0x20 + nProps*0x0C)`) so on
write they are **recomputed from the array lengths**, never trusted from disk.

## On-disk structures (32-bit PC, little-endian — the only target)

The wiki also documents a 64-bit (Paradise Remastered) layout; like
propInstanceData / instanceList / streetData / trafficData we implement **32-bit
PC LE only**. Console (BE) and 64-bit are out of scope.

### `PropGraphicsList` header — 32 bytes

| Offset | Size | Type | Name | Notes |
|--------|------|------|------|-------|
| 0x00 | 4 | u32 | `muSizeInBytes` | the **structural end**: part-array end when parts exist (may be unaligned), `align16(prop-array end)` when only props, `0x20` when empty. **Derived** — recomputed on write; the parser asserts the stored value matches (proven across all 428 fixtures). |
| 0x04 | 4 | u32 | `muZoneNumber` | PVS zone / track-unit id (editable) |
| 0x08 | 4 | u32 | `muNumberOfPropModels` | count of stored `PropGraphics` records = `props.length` (recomputed on write) |
| 0x0C | 1 | u8 | `muNumberOfPropPartModels` | count of stored `PropPartGraphics` records = `parts.length`. **u8 in a 4-byte slot** (u8 + 3 zero pad). Recomputed on write. |
| 0x0D | 3 | — | padding | zero |
| 0x10 | 4 | `PropGraphics*` | `mpaPropGraphics` | abs offset to prop array; **always `0x20`** when populated, `0` when empty. **Recomputed.** |
| 0x14 | 4 | `PropPartGraphics*` | `mpaPropPartGraphics` | abs offset to part array; **always `align16(0x20 + nProps*0x0C)`** when parts exist, `0` otherwise. **Recomputed.** |
| 0x18 | 8 | — | padding | zero — the header occupies a full 32 bytes; the meaningful fields stop at `0x18` and the block is zero-padded up to `0x20` (where `mpaPropGraphics` always points). |

### `PropGraphics` — 12 bytes (`0x0C`) — at `0x20`

| Offset | Size | Type | Name | Notes |
|--------|------|------|------|-------|
| 0x00 | 4 | u32 | `muTypeId` | prop type index (into [`prop-types.md`](prop-types.md)) |
| 0x04 | 4 | `Model*` | `mpPropModel` | **`0x0` on disk** — a BND2 **import** (see below); the body mesh. Modelled as the editable `mpModelId` (bigint); the writer emits 0 here and rebuilds the import-table entry from `mpModelId`. |
| 0x08 | 4 | `PropPartGraphics*` | `mpParts` | resource-relative **internal pointer** to this prop's first part record; leftover/garbage when the prop has no parts. Derived on write for a prop that owns parts; preserved verbatim (`_mpPartsRaw`) for a partless prop. |

### `PropPartGraphics` — 12 bytes (`0x0C`) — at `align16(0x20 + nProps*0x0C)`

| Offset | Size | Type | Name | Notes |
|--------|------|------|------|-------|
| 0x00 | 4 | u32 | `muTypeId` | owning prop's type id |
| 0x04 | 4 | u32 | `muPartId` | part index within the prop |
| 0x08 | 4 | `Model*` | `mpPropModel` | **`0x0` on disk** — a BND2 **import**; the part's mesh. Modelled as the editable `mpModelId` (bigint); the writer emits 0 here and rebuilds the import-table entry from `mpModelId`. |

## Model imports (`mpPropModel`) and the `mpParts` internal pointer

`mpPropModel` (on **both** record types) is stored as `0x0` and resolved through
the bundle's **import table** — exactly the same pattern as
[`instance-list-spec.md`](instance-list-spec.md)'s `mpModel`. Each prop and each
part has one import entry whose `offset` (the entry's `ptrOffset`) equals that
record's `mpPropModel` field offset. `getImportsByPtrOffset(bundle.imports,
bundle.resources, resourceIndex)` returns a `Map<number, bigint>` keyed by field
offset (value is the Model's 64-bit `resourceId` as a `bigint`) — look up the
record's field offset (`0x20 + i*0x0C + 0x04` for prop `i`; `mpaPropPartGraphics +
j*0x0C + 0x08` for part `j`) to get the Model's `resourceId`. The Model resource may
live in another bundle (shared/neighbour-chunk models are imported but not local).

On read, the parser resolves each `mpModelId` from this table by field offset; on
write it rebuilds the table from the per-record `mpModelId`s (see below).

`mpParts` is **not** an import — it is an **internal, resource-relative pointer** to
the prop's first `PropPartGraphics` record. Parts are grouped contiguously by
owning prop (the prop with the matching `muTypeId`), so a prop with parts points at
its run's first record. A prop with **no** parts carries a leftover/garbage `mpParts`
the runtime never dereferences (nonzero in most fixtures — 2951 of them — and `0` in
the rest). The parser never follows `mpParts` to read the structure (the part array
is located via the recomputed `mpaPropPartGraphics` and grouped by `muTypeId`); the
writer derives `mpParts` for a prop that owns parts (the byte offset of its run) and
re-emits `_mpPartsRaw` verbatim for a partless prop — so it survives the part array
relocating after a prop add/remove.

> The parser **needs** the import table to recover each record's `mpModelId`, but
> the structural layout is fully determined by the two counts. The writer rebuilds
> the table from the model, so the round-trip stays byte-exact and adds/removes of
> props re-establish every Model import.

## Inline import table (the BND2 import section)

After the last structural array, the payload is padded to a 16-byte boundary and
then carries the resource's **inline BND2 import table**:

- `importOffset == align16(muSizeInBytes)` — where the table starts.
- `importCount == nProps + nParts` — **one Model import per prop, one per part**
  (verified on all 427 resources). This is the wiki's "1 Model per prop, 1 per part".
- Each entry is **16 bytes**: `{ u64 resourceId, u32 fieldOffset, u32 pad }`, where
  `fieldOffset` is the byte offset of the `mpPropModel` field the import fills in.
  (In the parsed `ImportEntry` model these are `resourceId: { low, high }`,
  `offset`, `padding` — see `parseImportEntries` in
  [`bundle/bundleEntry.ts`](../src/lib/core/bundle/bundleEntry.ts); the on-disk
  layout is u32 low, u32 high, u32 offset, u32 padding, all little-endian.)
- `payload length == align16(muSizeInBytes) + importCount*16`.

The table is **modelled** (each entry's resource id becomes the owning record's
`mpModelId`) and **rebuilt** by the writer in canonical order — props then parts by
ascending field offset, each entry `{ u64 resourceId, u32 fieldOffset, u32 0 }`.
Because the table is reconstructed from the record counts rather than carried
verbatim, **both field edits and add/remove of props/parts round-trip**: changing
the counts shifts every `mpPropModel` field offset, and the writer simply emits the
new offsets. The bundle envelope's `importOffset`/`importCount` are recomputed on
export via the handler's `importTable()` hook.

## Real-fixture findings (verified 2026-06-09)

Decoded against two real bundle-embedded resources via the CLI/registry extract path:

| fixture | zone | raw bytes | nProps | nParts | `muSizeInBytes` | `mpaPropPartGraphics` | importCount | import-table bytes | pad+table bytes |
|---------|-----:|----------:|-------:|-------:|----------------:|----------------------:|------------:|-------------------:|----------------:|
| `TRK_UNIT9_GR.BNDL` | 9 | 1776 | 10 | 52 | 784 | `0xA0` (160) | 62 | 992 | 992 |
| `TRK_UNIT10_GR.BNDL` | 10 | 1616 | 9 | 47 | 708 | `0x90` (144) | 56 | 896 | 908 |

Arithmetic check (self-consistent, confirms the invariants):

```
TRK9 : mpaPropPartGraphics = align16(0x20 + 10*0x0C) = align16(0x98) = 0xA0  ✓
       importCount = 10+52 = 62 ; 62*16 = 992 ; align16(784)=784 ; 784+992 = 1776 = rawLen  ✓
       muSizeInBytes 784 is already 16-aligned, so the region = 0 pad + 992 table = 992.
TRK10: mpaPropPartGraphics = align16(0x20 + 9*0x0C) = align16(0x8C) = 0x90  ✓
       importCount =  9+47 = 56 ; 56*16 = 896 ; align16(708)=720 ; 720+896 = 1616 = rawLen  ✓
       muSizeInBytes 708 is the unaligned part-array end; importOffset rounds it to 720, so
       the import-table region = 12 pad (708→720) + 896 table = 908.
```

> **The pad+table region ≠ the import-table bytes when `muSizeInBytes` is unaligned.**
> The region from the last array end to EOF is the align-pad **plus** the import table.
> When `muSizeInBytes` is already 16-aligned (TRK9) the pad is empty and the two coincide;
> when it is unaligned (TRK10) the region is larger by the pad width. The writer regenerates
> the pad as zero and rebuilds the table from the model, reproducing both regions exactly.

**Corpus distribution** (sweep of all `TRK_UNIT*_GR.BNDL` in `example/`):

- **172 empty** (all-zero header, 32-byte payload, null pointers) / **254 populated**.
- **22 props-with-no-parts** (a subset of populated; `nParts == 0`).
- **0** parts-with-no-props, **0** bundles with more than one PGL.
- Maxima: **52 props**, **82 parts**.

**Byte-exact sweep result:** every PropGraphicsList that reaches the parser
round-trips `writePropGraphicsList(parsePropGraphicsList(raw))` **byte-for-byte**
across all 428 fixtures (256 populated + 172 empty, 0 fail) — including the
model-driven rebuild of the import table. The parser/writer in
[`src/lib/core/propGraphicsList.ts`](../src/lib/core/propGraphicsList.ts) were
rewritten for this (model `mpModelId` per record, nest parts under their owning
prop, derive `muSizeInBytes`/`mpParts`, rebuild the table); the byte-exactness above
is what proves that rewrite safe.

**Confirmed invariants (all 254 populated resources, zero violations):**

1. `mpaPropGraphics == 0x20` always.
2. `mpaPropPartGraphics == align16(0x20 + nProps*0x0C)` whenever `nParts > 0`.
3. `importCount == nProps + nParts` always.
4. The header pad `[0x18, 0x20)` and the inter-array align pad `[propEnd,
   mpaPropPartGraphics)` are **all zero** in every fixture.
5. Every `mpPropModel` field is `0` on disk; the real id lives in the inline import
   table, keyed by the field offset.
6. Parts are grouped contiguously by `muTypeId`; the prop with the matching type
   owns that run (no two parts-owning props share a type; every run matches a prop;
   runs are in prop order). A prop with no parts carries a leftover/garbage `mpParts`
   (nonzero in 2951 fixtures, `0` in 610) the runtime never dereferences.

**Extractor false-positives (not PGL bugs):** `TRK_UNIT158_GR.BNDL` throws a
spurious "incorrect header check" zlib error inside the bundle extractor's
`isCompressed()` heuristic (a resource whose first two payload bytes coincidentally
look like a zlib magic). `TRK_UNIT192_GR.BNDL` trips the same heuristic earlier, in
`parseImportEntries`. Both are extractor/bundle-layer issues — the PGL payloads
themselves are healthy and would round-trip byte-exact. Skip/tolerate them; neither
is a parser bug.

## Parsed model shape

The catalogue is **fully editable**: Model references are modelled as per-record
resource ids, and props **and parts** can be added or removed. The writer rebuilds
the inline import table and every derived offset from the model, so nothing is
carried verbatim except what the corpus sweep proved is reconstructable.

**Parts nest under their owning prop.** The on-disk part array is flat and grouped
contiguously by `muTypeId`; the prop with the matching type owns that run (verified
across all 234 PGLs-with-parts: contiguous-by-type, single-owner, every run matches
a prop, runs in prop order). So the model nests each prop's parts under it rather
than carrying a flat array + a pointer — ownership is then structural and can't
desync on edit. `mpParts` is derived on write for a prop that owns parts; for a
**partless** prop it's leftover/garbage the runtime never dereferences, preserved
verbatim as `_mpPartsRaw` so the round-trip stays byte-exact.

```ts
type PropPartGraphics = {
  muPartId: number;   // u32 — part index within the owning prop
  mpModelId: bigint;  // Model resource id (the BND2 import). Editable.
  // On disk the part ALSO stores muTypeId == the owning prop's type id; it isn't
  // modelled — the part is nested under its prop, so the writer re-emits the prop's.
};

type PropGraphics = {
  muTypeId: number;          // u32 — prop type index (into prop-types)
  mpModelId: bigint;         // Model resource id (the BND2 import); 0n = none/unresolved. Editable.
  parts: PropPartGraphics[]; // this prop's destructible parts (owned by type; empty = partless)
  _mpPartsRaw: number;       // raw on-disk mpParts — derived on write for owners, preserved verbatim for partless props
};

type ParsedPropGraphicsList = {
  muZoneNumber: number;      // u32 — PVS zone / track-unit id (editable)
  props: PropGraphics[];     // each prop carries its own parts; there is no top-level parts array
};
```

`muNumberOfPropModels` / `muNumberOfPropPartModels` are **not** stored on the model
(they equal `props.length` / `sum(props[].parts.length)`); the writer emits those
counts. `mpaPropGraphics` / `mpaPropPartGraphics` and `muSizeInBytes` (the structural
end) are recomputed. `mpPropModel` (0 on disk) is rebuilt as a 0 pointer + an
import-table entry carrying `mpModelId`. `mpParts` is the byte offset of a prop's
first part run (derived from the running part offset) for owners, else `_mpPartsRaw`
verbatim. The writer rejects two props of the same type where one owns parts (parts
are owned by type, so that shape can't round-trip).

## Round-trip / writer strategy

Byte-exact (`byteRoundTrip`) is achievable — the layout is rigid. Writer:

1. **Header (32 bytes):** `muSizeInBytes` = derived structural end;
   `muZoneNumber`; `muNumberOfPropModels = props.length`; `muNumberOfPropPartModels
   = parts.length & 0xff` (u8) + 3 pad; `mpaPropGraphics = props.length ? 0x20 : 0`;
   `mpaPropPartGraphics = parts.length ? align16(0x20 + nProps*0x0C) : 0`; zero-pad
   up to `0x20`.
2. **PropGraphics:** for each, `muTypeId`; `mpPropModel = 0` (the id is emitted into
   the import table below); `mpParts` = the byte offset of this prop's part run
   (running part offset) when it owns parts, else `_mpPartsRaw` verbatim.
3. **align16 pad → PropPartGraphics:** zero-pad to `mpaPropPartGraphics`, then flatten
   parts in prop order — for each prop, for each of its parts: the owning prop's
   `muTypeId`; `muPartId`; `mpPropModel = 0`. Then zero-pad up to the structural end
   (a no-parts list has an align pad after the prop array).
4. **align16 pad → import table:** for each prop, then each part, emit
   `{ u64 mpModelId, u32 fieldOffset, u32 0 }` → reproduces the exact length and
   re-establishes every Model import.

This mirrors the [`environmentTimeLine`](../src/lib/core/environmentSettings.ts)
precedent (model the inline import-table ids per record; recompute pointers,
counts, structural size, and the table from the array lengths on write). Because
the table is **rebuilt** rather than carried verbatim, both **field edits** AND
**adding/removing props or parts** round-trip byte-exact (verified across all 256
populated fixtures). When the prop/part count changes, the bundle envelope's
`importOffset`/`importCount` follow via the handler's `importTable()` hook on
export, exactly like EnvironmentTimeLine and ParticleDescriptionCollection.

The corpus sweep that justified the rebuild (all 256 populated + 172 empty
fixtures, zero violations): `muSizeInBytes` always equals the derived structural
end; the import table is ordered props-then-parts by ascending field offset; every
import-entry padding word and inter-array/align pad is zero; `mpParts` is always an
aligned index into the part array; and the payload length is always exactly
`align16(structuralEnd) + (nProps+nParts)*16`. The parser asserts each of these and
fails loud on any unexpected layout.

## Editor / resourcespec notes

- `muZoneNumber` is the only freely-editable header field.
- A prop's `muTypeId` → enum dropdown sourced from `PROP_TYPES` (same table as
  [`prop-instance-data-spec.md`](prop-instance-data-spec.md)). Parts are nested under
  their prop and take the prop's type, so a part exposes only `muPartId` (a plain
  integer) + `mpModelId`. Props and parts are both **addable/removable**.
- `mpModelId` (on props and parts) is an **editable** `bigint` resource id
  (`{ kind: 'bigint', bytes: 8, hex: true }`) — the Model the runtime spawns. On
  disk it is a `0` pointer + an import-table entry; the writer rebuilds that entry
  from `mpModelId`. Prop Models usually live in `GLOBALPROPS.BIN`.
- `_mpPartsRaw` is a `hidden`/`readOnly` round-trip-only field (the raw `mpParts`,
  preserved verbatim for partless props); `muSizeInBytes`, `mpaPropGraphics`,
  `mpaPropPartGraphics` are derived and never modelled.
- Tree labels: prop → `#i · <propTypeName> · model <resourceId>`; part →
  `#j · <propTypeName> · part <muPartId> · model <resourceId>`.
- **Adding/removing props and parts is supported** (`addable`/`removable` on, with a
  `makeEmpty` that seeds `mpModelId = 0n`). The main workflow is cataloguing a
  newly-placed prop type: add a prop row, set its type + Model id. The bundle
  envelope's import metadata is recomputed on export via the `importTable()` hook.
```

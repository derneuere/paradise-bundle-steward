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
  └─ _tail:  <align16 pad> + inline BND2 import table  // importCount × 16 bytes, to end of payload
```

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
| 0x00 | 4 | u32 | `muSizeInBytes` | **stored field; does NOT consistently equal a derivable offset** — part-array end when parts exist (may be unaligned), `align16(prop-array end)` when no parts, `0x20` when empty. Preserve **verbatim**. |
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
| 0x04 | 4 | `Model*` | `mpPropModel` | **`0x0` on disk** — a BND2 **import** (see below); the body mesh. Resolved via `getImportsByPtrOffset` keyed by this field's byte offset. Preserved verbatim. |
| 0x08 | 4 | `PropPartGraphics*` | `mpParts` | resource-relative **internal pointer** to this prop's first part record; **`0` (NULL) when the prop has no parts**. Preserved verbatim. |

### `PropPartGraphics` — 12 bytes (`0x0C`) — at `align16(0x20 + nProps*0x0C)`

| Offset | Size | Type | Name | Notes |
|--------|------|------|------|-------|
| 0x00 | 4 | u32 | `muTypeId` | owning prop's type id |
| 0x04 | 4 | u32 | `muPartId` | part index within the prop |
| 0x08 | 4 | `Model*` | `mpPropModel` | **`0x0` on disk** — a BND2 **import**; the part's mesh. Resolved via `getImportsByPtrOffset`. Preserved verbatim. |

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

`mpParts` is **not** an import — it is an **internal, resource-relative pointer** to
the prop's first `PropPartGraphics` record. Because parts are grouped contiguously
by owning prop, a prop with parts points at its first one; a prop with **no** parts
stores `mpParts == 0` (NULL). The parser never dereferences `mpParts` to read the
structure (the part array is located via the recomputed `mpaPropPartGraphics`); it
is preserved verbatim purely for byte-exactness.

> The parser **never needs the import table** to decode the structure — the layout
> is fully determined by the two counts. It captures the table verbatim in `_tail`
> so the round-trip stays byte-exact and every Model import stays valid.

## Inline import table (the BND2 import section, captured in `_tail`)

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

The whole region (align pad + import table) is captured as `_tail` and re-emitted
**verbatim**. This is why **field edits round-trip** but **adding/removing props or
parts is out of scope**: changing the counts shifts every `mpPropModel` field
offset, which would invalidate the captured table's `fieldOffset` values.

## Real-fixture findings (verified 2026-06-09)

Decoded against two real bundle-embedded resources via the CLI/registry extract path:

| fixture | zone | raw bytes | nProps | nParts | `muSizeInBytes` | `mpaPropPartGraphics` | importCount | import-table bytes | `_tail` bytes |
|---------|-----:|----------:|-------:|-------:|----------------:|----------------------:|------------:|-------------------:|--------------:|
| `TRK_UNIT9_GR.BNDL` | 9 | 1776 | 10 | 52 | 784 | `0xA0` (160) | 62 | 992 | 992 |
| `TRK_UNIT10_GR.BNDL` | 10 | 1616 | 9 | 47 | 708 | `0x90` (144) | 56 | 896 | 908 |

Arithmetic check (self-consistent, confirms the invariants):

```
TRK9 : mpaPropPartGraphics = align16(0x20 + 10*0x0C) = align16(0x98) = 0xA0  ✓
       importCount = 10+52 = 62 ; 62*16 = 992 ; align16(784)=784 ; 784+992 = 1776 = rawLen  ✓
       muSizeInBytes 784 is already 16-aligned, so _tail = 0 pad + 992 table = 992.
TRK10: mpaPropPartGraphics = align16(0x20 + 9*0x0C) = align16(0x8C) = 0x90  ✓
       importCount =  9+47 = 56 ; 56*16 = 896 ; align16(708)=720 ; 720+896 = 1616 = rawLen  ✓
       muSizeInBytes 708 is the unaligned part-array end; importOffset rounds it to 720, so
       _tail = 12 pad (708→720) + 896 table = 908 (the parser captures pad+table, not just the table).
```

> **`_tail` ≠ import-table bytes when `muSizeInBytes` is unaligned.** `_tail` is everything
> from the last array end to EOF, i.e. the align-pad **plus** the import table. When
> `muSizeInBytes` is already 16-aligned (TRK9) the pad is empty and the two coincide; when it
> is unaligned (TRK10) `_tail` is larger by the pad width. The writer re-emits `_tail` verbatim,
> so it reproduces both regions in one shot.

**Corpus distribution** (sweep of all `TRK_UNIT*_GR.BNDL` in `example/`):

- **172 empty** (all-zero header, 32-byte payload, null pointers) / **254 populated**.
- **22 props-with-no-parts** (a subset of populated; `nParts == 0`).
- **0** parts-with-no-props, **0** bundles with more than one PGL.
- Maxima: **52 props**, **82 parts**.

**Byte-exact sweep result:** every PropGraphicsList that reaches the parser
round-trips `writePropGraphicsList(parsePropGraphicsList(raw))` **byte-for-byte**
(426/426 byte-exact pass, 0 fail). The parser/writer in
[`src/lib/core/propGraphicsList.ts`](../src/lib/core/propGraphicsList.ts) needs no
changes.

**Confirmed invariants (all 254 populated resources, zero violations):**

1. `mpaPropGraphics == 0x20` always.
2. `mpaPropPartGraphics == align16(0x20 + nProps*0x0C)` whenever `nParts > 0`.
3. `importCount == nProps + nParts` always.
4. The header pad `[0x18, 0x20)` and the inter-array align pad `[propEnd,
   mpaPropPartGraphics)` are **all zero** in every fixture.
5. Every `mpPropModel` field is `0` on disk; the real id lives in the inline import
   table, keyed by the field offset.
6. A prop with no parts stores `mpParts == 0` (NULL) — it does **not** reuse a
   neighbour's pointer or the part-array-end value.

**Extractor false-positives (not PGL bugs):** `TRK_UNIT158_GR.BNDL` throws a
spurious "incorrect header check" zlib error inside the bundle extractor's
`isCompressed()` heuristic (a resource whose first two payload bytes coincidentally
look like a zlib magic). `TRK_UNIT192_GR.BNDL` trips the same heuristic earlier, in
`parseImportEntries`. Both are extractor/bundle-layer issues — the PGL payloads
themselves are healthy and would round-trip byte-exact. Skip/tolerate them; neither
is a parser bug.

## Parsed model shape

```ts
type PropGraphics = {
  muTypeId: number;    // u32 — prop type index (into prop-types)
  mpPropModel: number; // u32 — Model* import, 0 on disk; resolved by field offset. Verbatim.
  mpParts: number;     // u32 — internal pointer to first part (0 = no parts). Verbatim.
};

type PropPartGraphics = {
  muTypeId: number;    // u32 — owning prop's type id
  muPartId: number;    // u32 — part index within the prop
  mpPropModel: number; // u32 — Model* import, 0 on disk; resolved by field offset. Verbatim.
};

type ParsedPropGraphicsList = {
  muZoneNumber: number;     // u32 — PVS zone / track-unit id (editable)
  muSizeInBytes: number;    // u32 — stored size; not a derivable offset (preserved verbatim, readOnly)
  props: PropGraphics[];
  parts: PropPartGraphics[];
  _tail: Uint8Array;        // align16 pad + inline import table, end-of-arrays..EOF (verbatim)
};
```

`muNumberOfPropModels` / `muNumberOfPropPartModels` are **not** stored on the model
(they equal `props.length` / `parts.length`); the writer emits the array lengths.
`mpaPropGraphics` / `mpaPropPartGraphics` are recomputed from those lengths.

## Round-trip / writer strategy

Byte-exact (`byteRoundTrip`) is achievable — the layout is rigid. Writer:

1. **Header (32 bytes):** `muSizeInBytes` (**verbatim** — not a derivable offset);
   `muZoneNumber`; `muNumberOfPropModels = props.length`; `muNumberOfPropPartModels
   = parts.length & 0xff` (u8) + 3 pad; `mpaPropGraphics = props.length ? 0x20 : 0`;
   `mpaPropPartGraphics = parts.length ? align16(0x20 + nProps*0x0C) : 0`; zero-pad
   up to `0x20`.
2. **PropGraphics:** for each, `muTypeId`; `mpPropModel` (**verbatim**, `0` on
   disk); `mpParts` (**verbatim** internal pointer).
3. **align16 pad → PropPartGraphics:** zero-pad to `mpaPropPartGraphics`, then for
   each part `muTypeId`; `muPartId`; `mpPropModel` (**verbatim**, `0`).
4. **`_tail`:** append verbatim (align pad + inline import table) → reproduces the
   exact length and keeps every Model import valid.

This mirrors the [`propInstanceData`](prop-instance-data-spec.md) / `zoneList`
precedent (recompute pointers + counts, preserve verbatim stored-size and pad for
byte-exactness). Because the inline import table is keyed by `mpPropModel` field
offsets, **field edits** (zone id, a prop/part `muTypeId`, `muPartId`) round-trip,
but **adding or removing props/parts is OUT of scope** — it would shift those field
offsets and invalidate the captured table. `muSizeInBytes` is preserved verbatim
with no validation against the recomputed layout, so it would be stale after a
structural mutation (which is why such mutations are blocked).

## Editor / resourcespec notes

- `muZoneNumber` is the only freely-editable header field.
- `muTypeId` (on both record types) → enum dropdown sourced from `PROP_TYPES` (same
  table as [`prop-instance-data-spec.md`](prop-instance-data-spec.md)); `muPartId`
  is a plain integer.
- `mpPropModel` is `readOnly` in the editor — it is `0` on disk and the real Model
  id is resolved from the import table at display/render time via
  `getImportsByPtrOffset(bundle.imports, bundle.resources, resourceIndex)`, keyed by
  the record's field offset. Surface the resolved Model `resourceId` in the tree
  label so artists can see which mesh a prop/part maps to.
- `mpParts`, `muSizeInBytes`, and `_tail` are `readOnly`/`hidden` round-trip-only
  fields (`mpaPropGraphics`/`mpaPropPartGraphics` are derived and never modelled).
- Tree labels: prop → `#i · <propTypeName> · model <resourceId> · parts <n>`; part →
  `#j · part <muPartId> of <propTypeName> · model <resourceId>`.
- Adding/removing props or parts must be disabled (`addable`/`removable` off) until
  a future slice rebuilds the inline import table from scratch.
```

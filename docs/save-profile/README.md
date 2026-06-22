# Burnout Paradise save-profile support

`Profile.BurnoutParadiseSave` is the game's progression save. It is **not** a
BND2 bundle, so it lives outside the bundle Workspace: a standalone editor at the
`/save` route, backed by the codec in
[`src/lib/core/profileSave/`](../../src/lib/core/profileSave).

The spec mirrors of the wiki pages are alongside this file
(`container.md`, `progression-profile.md`, …). Source:
<https://burnout.wiki/wiki/Profile/Burnout_Paradise>.

## File shape

```
[ platform header ]  [ ProfileStoredData body ]
  RGMH  (PC / Remastered, no protection, has a thumbnail + metadata strings)
  MC02  (Xbox 360, big-endian, three CRC32 checksums — recomputed on save)
  none  (PS3 / PS4 / Switch — the file IS the body)
```

The body is a fixed sequence of `FixedSizeOpaqueBuffer<T>` chunks at
platform-specific offsets (see `variants.ts` / `container.md`): Progression,
Live Revenge, Options, Cagney (+options), Davis, PDLC, Cop, Island, Recent
Players, Padding. Not every chunk exists on every platform.

## How editing stays byte-exact

The codec is **decode-on-raw + patch-in-place**: each chunk keeps its original
bytes, decoding produces a display view, and an edit writes a single field back
at its known offset. Bytes we don't touch (padding, fields we don't model,
ambiguous regions) survive a load → save unchanged. The round-trip stress test
(`__tests__/profileSave.test.ts`) asserts this against a real PC Remastered
fixture, plus per-variant tiling and synthetic MC02 / headerless round-trips.

## Decode coverage (current)

| Chunk | Status |
|---|---|
| Progression Profile (**PC Remastered**, v31) | Fully modelled — license, vehicles, liveries, rivals, events, collectibles, discovery, Road Rules, records, counters, flags |
| Progression Profile (PS3 / X360 / PC / PS4 / Switch) | Preserved opaque (layout differs; no fixture to validate) |
| Live Revenge / Options / Cagney / Davis / PDLC / Cop / Island / Recent Players | Preserved opaque — documented in this folder, not yet decoded into fields |

Opaque chunks are still loaded, shown (size + hex preview), and saved byte-exact.

## Extending

Adding a chunk decoder is "write a `StructSpec`": model the fields in a layout
module (see `progression.ts`), point the chunk at it, and the engine + the
`/save` editor pick it up. A few load-bearing facts the engine already encodes:

- `CgsID` is a `u64` (rendered hex).
- `CgsBitArray<N>` is 64-bit-word aligned → `ceil(N/64)*8` bytes.
- `CgsSet<CgsID,Cap>` / `CgsArray<CgsID,Cap>` = `u32 count` + `u32 pad` + `Cap × u64`.
- `DateAndTime` is `bool mbIsLocal @0` + a trailing 8-byte time (FILETIME on
  Win/X360, `time_t` elsewhere); its footprint is 0xC or 0x10 by platform.
- `Vector3` is 4 floats (x, y, z + preserved w) = 0x10.

The size-invariant test will flag any layout whose fields overrun the chunk.

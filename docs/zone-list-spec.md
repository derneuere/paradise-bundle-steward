# Zone List (`PVS.BNDL`) — format spec

**Resource type ID:** `0xB000`
**Filename:** `PVS.BNDL` (Paradise PC) — also referenced as `Paradise ZoneList Example`.
**Memory distribution:** Main memory only (no GPU side).
**Editor (existing):** [Bundle-Manager](https://github.com/burninrubber0/Bundle-Manager) (C#).
**Source:** [Burnout wiki — ZoneList](https://burnout.wiki/wiki/Zone_List), captured 2026-04-26.

The Zone List is the **PVS (Potentially Visible Segments)** map. Its purpose is to tell the streaming system which track units to load when the player enters a given zone. Unlike `BrnTraffic::Pvs` (the uniform-grid hull-visibility cache embedded in `TrafficData` for traffic AI culling), `ZoneList` is artist-authored polygonal zones with explicit safe/unsafe neighbour lists — it is the source of the non-uniform grid the user sees in the existing Bundle-Manager editor screenshot.

## High-level model

```
ZoneList
  ├─ points: Vector2[muTotalPoints]      // shared point pool, packed
  ├─ zonePointStarts: u32[muTotalZones]  // zone → starting offset in `points`
  ├─ zonePointCounts: i16[muTotalZones]  // typically all 4
  └─ zones: Zone[muTotalZones]
       ├─ safeNeighbours:   Neighbour[miNumSafeNeighbours]
       ├─ unsafeNeighbours: Neighbour[miNumUnsafeNeighbours]
       ├─ zoneId:   u64
       ├─ zoneType: i16
       ├─ flags:    u32 (unused)
       └─ ...

Neighbour
  ├─ zone (pointer; resolved to zone-index in the model)
  └─ flags: u32
```

Zones reference each other through `Neighbour.mpZone`, which is a raw pointer in the on-disk format. The model resolves these pointers to integer **zone indices** at parse time and re-emits them as pointers at write time, exactly the way `TrafficData` does for hull/section indices. `mpPoints` inside each `Zone` aliases the same `points` pool (offset = `zonePointStarts[zoneIdx]`).

## Structures

### `CgsSceneManager::ZoneList`

#### 32-bit (PC, X360, PS3)

| Offset | Size  | Type        | Field                  | Notes |
|-------:|------:|-------------|------------------------|-------|
| `0x00` | `0x4` | `Vector2*`  | `mpPoints`             | base address of the shared point pool |
| `0x04` | `0x4` | `Zone*`     | `mpZones`              | base address of the zone array |
| `0x08` | `0x4` | `u32*`      | `mpuZonePointStarts`   | per-zone offset into `mpPoints` |
| `0x0C` | `0x4` | `i16*`      | `mpiZonePointCounts`   | per-zone vertex count (always 4 in retail) |
| `0x10` | `0x4` | `u32`       | `muTotalZones`         | |
| `0x14` | `0x4` | `u32`       | `muTotalPoints`        | |

Total header size: **`0x18`**.

#### 64-bit (Paradise Remastered)

| Offset | Size  | Type        | Field                  |
|-------:|------:|-------------|------------------------|
| `0x00` | `0x8` | `Vector2*`  | `mpPoints`             |
| `0x08` | `0x8` | `Zone*`     | `mpZones`              |
| `0x10` | `0x8` | `u32*`      | `mpuZonePointStarts`   |
| `0x18` | `0x8` | `i16*`      | `mpiZonePointCounts`   |
| `0x20` | `0x4` | `u32`       | `muTotalZones`         |
| `0x24` | `0x4` | `u32`       | `muTotalPoints`        |

Total header size: **`0x28`**.

### `CgsSceneManager::Zone`

#### 32-bit

| Offset | Size  | Type          | Field                    | Notes |
|-------:|------:|---------------|--------------------------|-------|
| `0x00` | `0x4` | `Vector2*`    | `mpPoints`               | aliases `ZoneList.mpPoints + zonePointStarts[idx]·sizeof(Vector2)` |
| `0x04` | `0x4` | `Neighbour*`  | `mpSafeNeighbours`       | |
| `0x08` | `0x4` | `Neighbour*`  | `mpUnsafeNeighbours`     | |
| `0x0C` | `0x4` | —             | padding                  | |
| `0x10` | `0x8` | `u64`         | `muZoneId`               | |
| `0x18` | `0x2` | `i16`         | `miZoneType`             | |
| `0x1A` | `0x2` | `i16`         | `miNumPoints`            | always 4 |
| `0x1C` | `0x2` | `i16`         | `miNumSafeNeighbours`    | |
| `0x1E` | `0x2` | `i16`         | `miNumUnsafeNeighbours`  | |
| `0x20` | `0x4` | `u32`         | `muFlags`                | unused |
| `0x24` | `0xC` | —             | padding                  | |

Total record size: **`0x30`**.

#### 64-bit

| Offset | Size  | Type          | Field                    |
|-------:|------:|---------------|--------------------------|
| `0x00` | `0x8` | `Vector2*`    | `mpPoints`               |
| `0x08` | `0x8` | `Neighbour*`  | `mpSafeNeighbours`       |
| `0x10` | `0x8` | `Neighbour*`  | `mpUnsafeNeighbours`     |
| `0x18` | `0x8` | `u64`         | `muZoneId`               |
| `0x20` | `0x2` | `i16`         | `miZoneType`             |
| `0x22` | `0x2` | `i16`         | `miNumPoints`            |
| `0x24` | `0x2` | `i16`         | `miNumSafeNeighbours`    |
| `0x26` | `0x2` | `i16`         | `miNumUnsafeNeighbours`  |
| `0x28` | `0x4` | `u32`         | `muFlags`                |
| `0x2C` | `0x4` | —             | padding                  |

Total record size: **`0x30`**.

### `CgsSceneManager::Neighbour`

#### 32-bit

| Offset | Size  | Type    | Field      | Notes |
|-------:|------:|---------|------------|-------|
| `0x00` | `0x4` | `Zone*` | `mpZone`   | resolved to zone-index at parse time |
| `0x04` | `0x4` | `u32`   | `muFlags`  | see `eNeighbourFlags` |
| `0x08` | `0x8` | —       | padding    | |

Total record size: **`0x10`**.

#### 64-bit

| Offset | Size  | Type    | Field      |
|-------:|------:|---------|------------|
| `0x00` | `0x8` | `Zone*` | `mpZone`   |
| `0x08` | `0x4` | `u32`   | `muFlags`  |
| `0x0C` | `0x4` | —       | padding    |

Total record size: **`0x10`**.

## Enumerations

### `CgsSceneManager::Neighbour::eNeighbourFlags`

| Name                          | Value  |
|-------------------------------|-------:|
| `E_RENDERFLAG_NONE`           | `0x0`  |
| `E_NEIGHBOURFLAG_RENDER`      | `0x1`  |
| `E_NEIGHBOURFLAG_IMMEDIATE`   | `0x2`  |

These describe how each neighbour zone should be loaded relative to the player's current zone. `RENDER` means the streaming system keeps it resident; `IMMEDIATE` means it must be fully loaded before transit (typically zones a few seconds ahead of the camera at top speed).

## Layout in memory

Confirmed by inspection of `example/PVS.BNDL` (single resource named `"newgrid"`, 32-bit, little-endian, 428 zones, 1712 points) and `example/older builds/PVS.BNDL` (Burnout 5 Nov 13 2006 / Feb 22 2007 X360 prototype, big-endian, 369 zones, 1476 points, wrapped in a Bundle V1 (`bndl`) container). Sections appear on disk in this order, **not** the order the wiki implies:

| # | Section | Offset (this fixture) | Size formula | Notes |
|---|---|---|---|---|
| 1 | Header                     | `0x00`     | `0x18`                                             | six pointer/count fields |
| 2 | Pad to 16                  | `0x18`     | 8 bytes                                            | so zones start at `0x20` |
| 3 | Zone records               | `0x20`     | `muTotalZones × 0x30`                              | |
| 4 | Neighbour pool             | `0x5060`   | `Σ(safeCount + unsafeCount) × 0x10`                | safe-then-unsafe per zone, in zone order |
| 5 | Points                     | `0x27710`  | `muTotalPoints × 0x10`                             | **16-byte stride**, not 8 — see below |
| 6 | `zonePointStarts`          | `0x2E210`  | `muTotalZones × 4`                                 | u32 each |
| 7 | `zonePointCounts`          | `0x2E8C0`  | `muTotalZones × 2`                                 | i16 each |
| 8 | Pad to 16                  | `0x2EC18`  | 0–8 bytes                                          | aligns total payload size |

### The "Vector2" stride is actually 16 bytes

The wiki types `mpPoints` as `Vector2*`. Empirically each on-disk record is **16 bytes**, not 8: the first 8 bytes carry the actual `(x, y)` and the trailing 8 bytes are pad (typically zero — likely a SIMD-alignment artifact). `zonePointStarts[idx]` is still an index, but the byte offset of zone `idx`'s first point is `mpPoints + zonePointStarts[idx] · 16`.

The steward parser stores the trailing 8 bytes as `_padA` / `_padB` (two `f32`s) so the writer can re-emit them verbatim. If those bytes ever turn out to carry non-zero data (per-vertex weights, height, …) we don't need to change the parse model — only how we expose those fields in the editor.

### Neighbour pool ordering

For byte-exact round-trip the writer packs neighbours in **zone-index order, safe block then unsafe block per zone**. `mpSafeNeighbours` / `mpUnsafeNeighbours` point at the start of each respective slice (or `0` when the count is zero). This matches the Bundle-Manager reference implementation and is what `example/PVS.BNDL` does on disk.

### Prototype-build quirks (Nov 13 / Feb 22)

The BND1 prototype fixture exercises two layout edge cases the retail PC fixture never hits — both purely cosmetic but required for byte-exact round-trip:

- **Orphan Neighbour records in the pool.** In some zones the bytes immediately after the zone's safe+unsafe blocks contain a few extra 16-byte records that look like Neighbour entries (valid `mpZone` pointer, `muFlags = E_NEIGHBOURFLAG_RENDER`, zero pad) but no zone's `mpSafeNeighbours` / `mpUnsafeNeighbours` ever points at them. The Nov 13 fixture has 3 such orphans (48 bytes total). Likely leftovers from authoring-tool zone deletion. The parser captures these as a per-zone `_trailingNeighbourPad: Uint8Array` and the writer re-emits them verbatim. Retail's pool is fully contiguous so the field is empty there.
- **`zonePointCounts` aligned to 16.** Retail has 428 zones (`428 × 4 = 1712` bytes for `zonePointStarts`, naturally 16-aligned) so no padding is needed between starts and counts. The Nov 13 fixture has 369 zones (`1476 % 16 = 4`) so the format pads with 12 zero bytes to align `zonePointCounts` to 16. The writer always pads to 16 here — benign for retail (zero pad) and necessary for prototypes.
- **Non-zero trailing tail.** The 14-byte trailing pad in the Nov 13 fixture is filled with `0x04` bytes (over-allocated authoring leftover) instead of zero. Captured as an optional `_finalPad: Uint8Array` on `ParsedZoneList`; absent when the writer should emit the standard zero pad.

### Pointer resolution

`Neighbour.mpZone` and `Zone.mpPoints` / `mpSafeNeighbours` / `mpUnsafeNeighbours` are raw byte offsets into the resource payload. The parser inverts them to integer indices at read time:

- `mpPoints` → `(ptr - ptrPoints) / 16` is the index into `points[]`, equal to `zonePointStarts[zoneIdx]`.
- `mpSafeNeighbours` / `mpUnsafeNeighbours` → ranges into the neighbour pool; we read `miNumSafe` + `miNumUnsafe` records starting from each pointer.
- `Neighbour.mpZone` → `(ptr - ptrZones) / 0x30` is the target zone index.

The writer recomputes all these from the layout it lays out — pointers in the model are not authoritative, only the indices and the section ordering are.

## Bundle wrapper (BND1 vs BND2)

The ZoneList **payload** is byte-identical between Bundle V1 and Bundle V2 — only endianness flips. What differs is the surrounding container:

| Aspect | Retail (`example/PVS.BNDL`) | Prototype (`example/older builds/PVS.BNDL`) |
|---|---|---|
| Bundle magic | `bnd2` (Bundle 2) | `bndl` (Bundle V1, version 5) |
| Endianness | LE (PC, platform=1) | **BE** (X360, platform=2) |
| ZoneList resource type ID | `0xB000` | `0xB000` (same) |
| Compression | zlib | zlib |
| Zones | 428 | 369 |

The BND1 reader/writer lives in [`src/lib/core/bundle/bundle1.ts`](../src/lib/core/bundle/bundle1.ts). It dispatches automatically from `parseBundle` / `writeBundleFresh` based on byte 0–3 magic. Per-platform layout sizes (PC `0x4C`/`0x60`, X360 `0x58`/`0x70`, PS3 `0x64`/`0x78`) come from [burnout.wiki/wiki/Bundle](https://burnout.wiki/wiki/Bundle). Only V5 is implemented; V3/V4 error cleanly when fixtures appear.

BND1-only fields that don't fit BND2's `ResourceEntry` shape — the 5-chunk size/offset descriptors, runtime pointers, V5 alignment, and the resource ID hash table — are stashed on `ParsedBundle.bundle1Extras` so the round-trip writer can reproduce byte-exact output without polluting the BND2 path.

### Cross-container conversion

`convertBundle(bundle, originalBuffer, target)` (exported from [`bundle/index.ts`](../src/lib/core/bundle/index.ts)) repacks a bundle into the other container and/or platform. Internally it (1) decompresses each resource's primary chunk, (2) calls the registered handler's `parseRaw`/`writeRaw` to flip endianness when the source/target byte orders differ, (3) builds a target-shape `ParsedBundle` (synthesizing or stripping `bundle1Extras` as needed), and (4) feeds it to `writeBundleFresh` which dispatches to the right writer.

CLI usage: `bundle-cli convert <in> <out> --container <bndl|bnd2> --platform <pc|x360|ps3> [--allow-unknown]`. The `--allow-unknown` flag lets resources without writable handlers pass through verbatim during endianness flips (correct only when the payload is opaque/byte-oriented). Without the flag, unhandled types cause a `BUNDLE_CONVERT_NO_HANDLER` error so the failure is visible.

The auxiliary resource bundled alongside the BND1 PVS ZoneList is a [`TextFile`](https://burnout.wiki/wiki/TextFile) (type `0x3`) — a development-only Bundle imports XML resource. Its `mLength` u32 prefix is **always little-endian on disk** regardless of bundle platform (the dev tool that wrote BND1 bundles ran on PC and never byte-swapped, since this type is never read back at X360 runtime). The handler is in [`textFile.ts`](../src/lib/core/textFile.ts) and is registered by default; cross-container conversion of the older PVS fixture works without `--allow-unknown` thanks to it.

## Differences vs `BrnTraffic::Pvs`

| Aspect | `BrnTraffic::Pvs` (TrafficData, `0x10002`) | `ZoneList` (PVS.BNDL, `0xB000`) |
|---|---|---|
| Purpose | hull-visibility cache for traffic AI | track-unit streaming PVS |
| Cell shape | uniform `mCellSize` AABB grid | polygonal (4 points per zone) |
| Cell count | `muNumCells_X × muNumCells_Z` (`25 × 15` for B5TRAFFIC) | `muTotalZones` (`428` for `PVS.BNDL`) |
| Per-cell payload | up to 8 hull indices (`Set<uint16_t, 8>`) | safe + unsafe neighbour zones, zone type, zone id |
| Authoring | tool-generated | hand-edited via Bundle-Manager |
| Bundle | embedded inside `*B5TRAFFIC.BNDL` | standalone `PVS.BNDL` (one resource named `"newgrid"`) |

Both grids cover the city, both are called "PVS" in different contexts, and the existing Bundle-Manager screenshot is the **`ZoneList` editor**, not `BrnTraffic::Pvs`.

## Should the TrafficData viewport load `PVS.BNDL`?

Short answer: **no, not for the static-traffic placement workflow** — but yes if we want feature-parity with Bundle-Manager's PVS editor.

**For "drop a static car at the OTN tunnel and figure out which `PvsHullSet` to edit"** — the user's stated use case — the right grid is `BrnTraffic::Pvs` (already wired into the TrafficData viewport at [TrafficDataViewport.tsx](../src/components/trafficdata/TrafficDataViewport.tsx)). That grid maps a world position to a hull-visibility set, which is what the user actually edits to make traffic see the new car. `ZoneList` controls track-unit streaming and has nothing to say about hull membership; even if a vehicle's position fell inside a particular `Zone`, that wouldn't tell you anything about which hulls' static-traffic arrays to extend.

**For replacing Bundle-Manager's PVS editor** — yes, eventually. The ZoneList is what that screenshot shows: 428 polygonal zones tagged with a `zoneType` and an explicit safe/unsafe neighbour graph for streaming. A standalone `ZoneListViewport` mirroring `AISectionsViewport` (polygons + adjacency lines on the X-Z plane, with click-to-select-zone and the same `selectPath` shim) is the natural follow-up. Steward already parses + writes the resource byte-exact (this PR), so the editor would be a pure rendering / interaction layer with no new format work.

**Should we draw both grids in the same viewport?** Probably not by default. They serve different mental models — traffic AI vs. world streaming — and overlaying them would clutter the city map. A toggle (the same way `PVS grid (25×15)` already toggles `BrnTraffic::Pvs`) is the cheapest path if both are wanted at once.

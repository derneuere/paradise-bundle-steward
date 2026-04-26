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

Confirmed by inspection of `example/PVS.BNDL` (single resource named `"newgrid"`, 32-bit, little-endian, 428 zones, 1712 points). Sections appear on disk in this order, **not** the order the wiki implies:

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

### Pointer resolution

`Neighbour.mpZone` and `Zone.mpPoints` / `mpSafeNeighbours` / `mpUnsafeNeighbours` are raw byte offsets into the resource payload. The parser inverts them to integer indices at read time:

- `mpPoints` → `(ptr - ptrPoints) / 16` is the index into `points[]`, equal to `zonePointStarts[zoneIdx]`.
- `mpSafeNeighbours` / `mpUnsafeNeighbours` → ranges into the neighbour pool; we read `miNumSafe` + `miNumUnsafe` records starting from each pointer.
- `Neighbour.mpZone` → `(ptr - ptrZones) / 0x30` is the target zone index.

The writer recomputes all these from the layout it lays out — pointers in the model are not authoritative, only the indices and the section ordering are.

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

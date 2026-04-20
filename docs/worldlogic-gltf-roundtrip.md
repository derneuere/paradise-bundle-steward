# World-logic glTF round-trip — design plan

**Status:** design, pre-implementation. Authored 2026-04-20. Decisions locked 2026-04-20 after cloning `TriggersToGLTF` and auditing its output for losslessness.

## Locked decisions

1. **One `.gltf` per bundle.** Unified scene containing StreetData + TrafficData + AISections + TriggerData. CLI `--include` scopes subsets when needed.
2. **Byte-exact round-trip is the target.** Export→import with no edits must produce a bundle identical to the input down to the byte. This is the correctness contract every CLI test enforces.
3. **Extensive CLI test suite** (matches the existing `bundle-cli.ts` pattern for `roundtrip`/`stress`). Each resource gets a `roundtrip-gltf` subcommand, a `stress-gltf` matrix of mutation scenarios, and per-fixture golden-hash tests.
4. **Mesh + LINE_STRIP on the same node** for lane-rung ribbons (solid-shaded + wireframe-editable in Blender with no duplication cost).
5. **PC-only (32-bit little-endian).** Defers Paradise Remastered (64-bit) and X360/PS3 (big-endian) to a later phase, matching the current steward parser scope.

## TriggersToGLTF losslessness audit (2026-04-20)

The user guessed the C++ precedent might already be byte-exact. **It is not.** Reading [`src/converter.cpp`](../../TriggersToGLTF/src/converter.cpp) and [`include/trigger-data.h`](../../TriggersToGLTF/include/trigger-data.h) directly, the following data is dropped:

- **`TriggerData` header fields** (`versionNumber`, `size`, `playerStartPosition`, `playerStartDirection`, `onlineLandmarkCount`) never appear anywhere in the glTF output — neither as extras nor as a hidden metadata node. See `convertTriggersToGLTF` at [converter.cpp:326](../../TriggersToGLTF/src/converter.cpp#L326); the function writes scene nodes only.
- **`VFXBoxRegion`** only writes the transform and a name. No `extras`. [converter.cpp:626](../../TriggersToGLTF/src/converter.cpp#L626) (`convertVfxBoxRegion`) never calls `addTriggerRegionFields`, so `id`, `regionIndex`, `type`, and `unk0` are lost.
- **Bare `TriggerRegion`** (fallback array, [converter.cpp:677](../../TriggersToGLTF/src/converter.cpp#L677)) has the same problem — transform + name, no extras.
- **`SignatureStunt.id`** is `CgsID` (u64) but cast to `int` on export: `extras["ID"] = Value((int)signatureStunt.id)` at [converter.cpp:636](../../TriggersToGLTF/src/converter.cpp#L636). Same for `camera` (i64). **Narrowing above 2³¹.**
- **`Killzone.regionIds`** — same i64→int narrowing, [converter.cpp:647](../../TriggersToGLTF/src/converter.cpp#L647).
- **Euler → quaternion** at export ([converter.cpp:309](../../TriggersToGLTF/src/converter.cpp#L309) `EulerToQuatRot`) is well-defined forward. The reverse (quat → Euler) is **not unique** — gimbal lock + multiple equivalent Euler triples exist. A round-trip through glTF storage loses the original Euler representation unless we preserve it in `extras`.
- `-f` and `-s` filters drop nodes outright — by design for that tool's use case, but incompatible with round-trip.

**Steward's target is strictly stronger.** Our contract must be: every scalar field of every entry is preserved, 64-bit IDs are stringified, Euler angles are stored in extras alongside the transform so we can re-emit the exact source bytes, and the bundle-level metadata (header fields, top-level resource counts) lives in a hidden root-level `extras` blob. Byte-exactness is verified by the CLI test suite on every PR.

This finding also **hardens the design decision** on TriggersToGLTF compatibility: our output should be *readable by* consumers that understand its conventions (same node name prefixes, same extras keys), but our writer will produce a superset of its fields. The superset stays under vanilla glTF 2.0 — we just use more of the extras space.

**Goal.** Take Paradise's "logical" world data — `StreetData` (streets / junctions / roads / challenges), `TrafficData` (traffic sections with lane rungs, static vehicles, junction logic boxes), `AISections` (AI cells with portals and no-go lines), and `TriggerData` (OBB regions, landmarks, blackspots) — and round-trip it through a vanilla glTF 2.0 scene. Export is the easy half: open the scene in Blender, stare at the whole city as a wireframe of logical regions, find the thing you want to change. Import is the bold half: after you edit in Blender (move a junction, add a new traffic section, redraw an AI cell), steward ingests the edited glTF and rewrites the bundle byte-for-byte where you didn't touch and regeneratively where you did.

The north star for the export half is [`burninrubber0/TriggersToGLTF`](https://github.com/burninrubber0/TriggersToGLTF) — a small C++ tool that already does this for TriggerData. It is read-only, uses plain glTF 2.0, and encodes everything non-geometric in `node.extras`. This plan explicitly extends that precedent to StreetData and the rest of the world-logic resources, *and adds an importer nobody in the Paradise scene has written yet.*

---

## 1. Scope and precedent

### What TriggersToGLTF does (the template to copy)

- Plain glTF 2.0, textual `.gltf`, no custom extensions, no glb.
- One shared **unit-cube mesh** (14-vertex tri-strip, 1×1×1 centered on origin) in the buffer; every OBB node references mesh 0 and scales it per instance.
- Node naming convention `<Type> <index> (<id>)` — e.g. `Landmark 3 (12345)`, `GenericRegion 42 (9876)`. The `(<id>)` suffix is the canonical identity token for round-trip.
- Per-node `extras` is a **flat JSON dict** mirroring the format's field names verbatim: `"TriggerRegion ID"`, `"Group ID"`, `"Is one way"`, `"District"`.
- Point triggers (`RoamingLocation`, `SpawnLocation`, grid slots) have no mesh — just `translation` (+ quat `rotation` if needed).
- Hierarchical: `Landmark` parents its 8 `StartingGrid` slots; `SignatureStunt` parents its `GenericRegion` children; `Killzone` parents its trigger children. Scene roots are only the top-level parents, so Blender's outliner mirrors the Paradise hierarchy.

### What TriggersToGLTF *doesn't* do (the gap we fill)

- No importer. The tool has zero re-import path. Node names embed `ID`, and extras carry `TriggerRegion ID` — enough to match identities — but nobody in burninrubber0's repo graph has built the reverse direction.
- No support for non-OBB geometry (polylines for roads, polygons for AI cells, quad strips for traffic lane rungs).
- TriggerData only; StreetData, TrafficData, AISections are out of scope.

### Why steward should own the round-trip

Steward already has:

- A full TS parser + writer for `StreetData` ([src/lib/core/streetData.ts](../src/lib/core/streetData.ts)) with byte-exact round-trip on `BTTSTREETDATA.DAT`, stress-tested across 18 mutation scenarios.
- A full TS parser + writer for `TrafficData` ([src/lib/core/trafficData.ts](../src/lib/core/trafficData.ts)), `AISections` ([src/lib/core/aiSections.ts](../src/lib/core/aiSections.ts)), `TriggerData` ([src/lib/core/triggerData.ts](../src/lib/core/triggerData.ts)).
- `three@^0.169.0`, `@react-three/fiber`, `@react-three/drei` already in `package.json` — glTF export is `THREE.GLTFExporter` plus a tiny transform layer, no new heavyweight deps.
- A schema-driven editor framework ([docs/schema-editor-migration.md](schema-editor-migration.md)) already using a `swapYZ` tag on Vec3 fields — the Z-up/Y-up convention is already recognized across the codebase.
- A CLI dispatcher (`npm run bundle -- <cmd>`, [scripts/bundle-cli.ts](../scripts/bundle-cli.ts)) where `bundle export-gltf` / `bundle import-gltf` slot in naturally next to `dump` / `pack` / `roundtrip`.

This is the right home. The C++ precedent can stay as the point-of-truth for OBB conventions; steward becomes the repo that actually round-trips.

---

## 2. What goes into the scene

All four resources map into **one** glTF file — one scene, one outliner view in Blender. Organization is via a three-level node hierarchy whose top-level groups name the resource, second-level groups name the collection, and leaves are the individual entries.

```
<bundle-name>.world-logic.gltf
  ├── StreetData
  │   ├── Junctions/       (point nodes, one per Junction entry)
  │   ├── Roads/           (LINE_STRIP polylines)
  │   ├── Streets/         (point nodes, positioned at their linked road's reference point)
  │   └── ChallengeParScores/  (hidden-by-default; data nodes with no geometry)
  ├── TrafficData
  │   ├── TrafficSections/     (quad-strip meshes from lane rungs)
  │   ├── JunctionLogicBoxes/  (point + extras)
  │   ├── StaticVehicles/      (cube-mesh nodes using per-instance 4×4 transform)
  │   ├── LightTriggers/       (OBB via unit-cube)
  │   └── StopLines/           (line segments)
  ├── AISections
  │   ├── Sections/    (CLOSED line-loop polygons from 4 corners; extras hold speed/flags/id)
  │   ├── Portals/     (line segments between boundary-line endpoints, parented under their owning section)
  │   └── NoGoLines/   (line segments, parented under their owning section)
  └── TriggerData
      ├── Landmarks/       (OBB parents + starting-grid children — matches TriggersToGLTF)
      ├── GenericRegions/  (OBB, mesh 0 instanced)
      ├── Blackspots/      (OBB + score extras)
      ├── VFXBoxRegions/   (OBB)
      ├── Killzones/       (OBB parents + trigger children)
      ├── SignatureStunts/ (OBB parents + GenericRegion children)
      ├── SpawnLocations/  (point + rotation)
      └── RoamingLocations/ (point)
```

**Top-level groups are always present**, even when empty. This gives the importer a stable reconciliation target — "I see the `TrafficSections` group is missing three children compared to the original: those were deletions." Absent groups would be ambiguous ("did the user drop it, or was the file produced before we supported it?").

---

## 3. Geometry strategy per resource

### StreetData

StreetData is mostly pointers and scalar metadata — actual world-space geometry is thin. But there's enough to anchor everything in space.

- **Roads**: each `Road` carries `mReferencePosition: {x, y, z}` ([streetData.ts:64](../src/lib/core/streetData.ts#L64)). For a first pass a road is just a **point node** at that position. As a bolder second pass we reconstruct the road's polyline by walking its span references via `TrafficData.TrafficSection.muSpanIndex` + `TrafficLaneRung.maPoints` — see "Road polylines from TrafficData" below.
- **Junctions**: `Junction` has no explicit position of its own; the position is inherited from the road the junction lies on (via `superSpanBase.miRoadIndex`). Compute `junction.position = roads[superSpanBase.miRoadIndex].mReferencePosition`. Point node, mesh-less.
- **Streets**: same story — position derived from the linked road. Point node.
- **ChallengeParScores**: no position at all. Emit as empty data nodes (no translation, no mesh) parented under a `ChallengeParScores` group, all extras, hidden-by-default in Blender via the standard `node.extras.hidden = true` convention. Keeps them round-trippable without cluttering the viewport.

Identity tokens:

- Roads: `mId: bigint` (stringified as decimal in extras, since JSON numbers lose precision above 2^53).
- Junctions: `macName` (16-byte ASCII, e.g. `"MAIN_HARDIE"`), which is unique in practice. Fall back to `(index, superSpanBase.miRoadIndex)` if `macName` is empty.
- Streets: `(superSpanBase.miRoadIndex, superSpanBase.miSpanIndex)` tuple.
- Challenges: index only — the format has no explicit ID, and there's one per road, so `(roadIndex)` is the identity.

### TrafficData — this is where the geometry lives

The user's ask — *"reimport with new traffic sections n shit"* — aims squarely here.

- **TrafficSection** carries `muRungOffset` + `muNumRungs` into a global `TrafficLaneRung[]` array. Each rung is `[Vec4, Vec4]` — left edge, right edge of the lane at that rung. A section's rungs laid end-to-end describe the drivable surface: it's a ribbon. **Export each section as a LINE_STRIP primitive** with `2 * numRungs` vertices (alternating left/right edges), so the whole ribbon is visible in Blender as a ladder. Optionally also emit a TRIANGLES primitive with two tris per rung pair for a solid shaded ribbon that's easier to pick. Extras hold the scalar fields (`muTurnLeftProb`, `mfSpeed`, `mfLength`, section index, section ID if one exists).
- **JunctionLogicBox**: point node at `mPosition`. Children: 8 `TrafficLightController` sub-nodes carrying the light/stop-line arrays as extras, plus a `LightTriggers` container whose children are the OBB-mesh nodes.
- **StaticVehicle**: `mTransform` is a 4×4 `Matrix44Affine`. Decompose into translation + rotation (quat) + scale, emit a node with that transform, attach the shared unit-cube mesh (small, car-shaped scale feels natural). Extras: `mFlowTypeID`, `mExistsAtAllChance`, `muFlags`.
- **TrafficLightTrigger**: OBB with `mDimensions` scale and `mPosPlusYRot` position+Y-rotation. Unit-cube mesh, standard OBB pattern.
- **StopLines**: line segments. Positions come from the rung index they live on — each stop line is placed at a rung; emit a LINE primitive between the rung's left and right edges.

### AISections

- **Sections** are closed 4-corner polygons in world XY (Paradise X-horizontal-east, Y-height, Z-horizontal-north; see §5). Emit as LINE_LOOP (mode=2) primitives per section, with optional filled TRIANGLE_FAN for solid coloring by speed or flag. Extras: `id`, `speed`, `flags`, `district`, `spanIndex`.
- **Portals** are boundary lines plus a 3D anchor. Parent under the owning section; emit each portal as a hierarchy: the anchor is the node's `translation`, each `BoundaryLine` becomes a LINE segment child.
- **NoGoLines** same treatment, under the owning section.

### TriggerData

Already matches [`TriggersToGLTF`](https://github.com/burninrubber0/TriggersToGLTF) — we copy its conventions verbatim so someone who's used that tool feels at home. This is deliberate: *node-name prefixes, extras keys, hierarchy shape, all identical*. The payoff is we can later merge its output with ours and not worry about incompatibility.

---

## 4. Round-trip identity and reconciliation

The core contract, on import:

> For each node in the glTF scene, find the matching original entry and update it. Nodes without a match are new entries. Original entries with no matching node are deletions. All mutations preserve byte-exactness outside the touched fields.

The matching rule, in order:

1. **`extras.ID` (primary key)** — for resources that have a natural ID (`Road.mId`, `AISection.id`, `TriggerRegion.id`, `JunctionLogicBox.muID`), we write it into extras verbatim. If an edited node still has the same ID, it matches.
2. **Composite key (fallback for IDless entries)** — `Junction.macName`, `Street.(roadIndex,spanIndex)`, `TrafficSection.index`, `ChallengeParScores.roadIndex`. These are written as extras fields like `"Name"`, `"Road index"`, `"Span index"` and used when ID-matching fails.
3. **Node order (last-resort tiebreaker)** — within a group, sibling order in the outliner becomes the array order in the rewritten bundle. This only kicks in when neither primary nor composite key matches uniquely, and we warn loudly.

**Creating a new entry.** User duplicates a node in Blender, edits the OBB / polyline / position, blanks the `ID` field (or sets it to a sentinel like `-1`). Importer assigns a new ID (next-unused for resources with monotonic IDs; nothing for indexed resources; a freshly-stringified bigint for `Road.mId` using the existing "random bigint" convention). The new entry's internal pointers (`TrafficSection.muRungOffset`, `Junction.mpaExits`) are recomputed from scratch — we already do this in the rebuild path of the writer.

**Deleting an entry.** Node missing → entry dropped. The importer prints a summary (`3 junctions deleted, 1 road added, 42 sections modified`) and asks for confirmation (CLI: `--yes` to skip; UI: explicit button) before writing the bundle, because silent mass-deletion is the failure mode people hate.

**Renaming / moving.** `Junction.macName` is identity in most cases but users *will* want to rename junctions. The rename-detection heuristic: if a node with an unrecognized name has the same position + same `superSpanBase.miRoadIndex` + same `superSpanBase.miSpanIndex` as a vanished entry, treat it as a rename, not a delete+add. Toggleable via `--no-detect-renames`.

---

## 5. Coordinate system and units

Paradise is **Z-up** (Burnout engine). glTF is **Y-up** by convention. Steward already tags vec3 fields with `swapYZ` in the schema layer ([src/components/schema-editor/fields/VectorField.tsx](../src/components/schema-editor/fields/VectorField.tsx)) because the editor already had to solve this.

**Export**: apply `swapYZ` (negate Z, swap Y↔Z) to every position/direction/rotation we emit. Consistent with the existing schema-editor behavior.

**Import**: reverse the transformation. A dedicated module `src/lib/core/gltf/coords.ts` owns the transformation and is the only code that knows the conversion — do not duplicate.

**Units**: Paradise world-space unit = 1 meter (confirmed by the ~8km island fit and standard Criterion engine convention). glTF convention is also meters. No scale factor. If a user imports a glTF from Blender that was worked in feet/inches they'll see a 3.28× discrepancy on the first import — we document this prominently.

**Precision**: glTF `NODE.translation` is f32. Paradise positions are f32. No loss.

---

## 6. Architecture

```
src/lib/core/gltf/
  coords.ts               — swapYZ in both directions, matrix44 decomposition helpers
  nodeConventions.ts      — name prefixes, extras key canonical names, node-key resolution
  unitCube.ts             — the shared unit-cube mesh (buffer+accessor builder for export)
  export/
    streetData.ts         — ParsedStreetData → gltf-transform Document subtree
    trafficData.ts        — ParsedTrafficData → Document subtree
    aiSections.ts         — ParsedAISections → Document subtree
    triggerData.ts        — ParsedTriggerData → Document subtree (matches TriggersToGLTF output)
    worldLogic.ts         — combines all four, produces one Document, serializes
  import/
    reconcile.ts          — node→entry matching, new/delete/rename detection
    streetData.ts         — Document → ParsedStreetData (given the original for reconciliation)
    trafficData.ts        — Document → ParsedTrafficData
    aiSections.ts         — Document → ParsedAISections
    triggerData.ts        — Document → ParsedTriggerData
    worldLogic.ts         — orchestrator, produces a diff report + updated models

src/pages/WorldLogicPage.tsx  — (stretch) embedded three.js viewer for the combined scene
scripts/bundle-cli.ts          — add `export-gltf` / `import-gltf` subcommands
```

**Library choice.** Use [`@gltf-transform/core`](https://gltf-transform.dev/) for both directions, not `THREE.GLTFExporter`. Reasons:

- glTF-Transform has a first-class `extras` API and a scene-graph abstraction that survives round-tripping; `GLTFExporter` is optimized for baking three.js scenes out, not for authoring logical glTF.
- It's pure glTF-2.0, no three.js runtime dependency — lets the CLI path run outside the browser.
- It's ~90 KB gzipped, no three.js dependency baggage on its own.
- It's maintained by Don McCurdy (author of the VS Code gltf-viewer), the de facto reference implementation.

Adding `@gltf-transform/core` is a single `npm i` — no peer-dep drama.

**CLI UX** (once implemented):

```
npm run bundle -- export-gltf <in-bundle.dat> [--out <out.gltf>] [--include streetData,trafficData,...]
npm run bundle -- import-gltf <original-bundle.dat> <edited.gltf> [--out <new-bundle.dat>] [--dry-run]
```

`--dry-run` prints the diff report (`+3 sections, -1 junction, 42 modifications`) without writing. `--include` scopes the export to a subset of resources.

**UI** (eventually): on each resource's page, an "Export glTF" button that dumps just that one resource. A top-level "Export world-logic glTF" button on the bundle page that dumps everything. An "Import glTF" dropzone that diffs against the currently-loaded bundle and shows the reconciliation report before committing.

---

## 7. Phased delivery

Done in isolation each phase should land a merged PR. Phases 1–2 are the MVP; phases 3+ are the bold endgame.

### Phase 1 — Exporter MVP, StreetData only

Scope: `bundle export-gltf <in> --out <out.gltf>` emits a scene containing the StreetData hierarchy only (Junctions, Roads as points for now — no polylines, Streets, ChallengeParScores as hidden data nodes). Node naming + extras conventions locked in. Tests: a new fixture under `example/` produces a stable glTF output; round-trip is not attempted yet.

**Success**: open the output in Blender, see a pointcloud of junctions + roads over a placeholder grid, inspect any node's Custom Properties and find the Paradise fields there verbatim.

### Phase 2 — Importer MVP, StreetData only

Scope: `bundle import-gltf <orig> <edited>` reads the edited glTF, reconciles against the original StreetData, outputs a new bundle. Supports: field edits (change `mReferencePosition`, rename a junction), deletes (node removed), adds (new node with no `ID`). Detection report printed to stdout.

**Success**: user edits a junction name in Blender, re-imports, diffs the two bundles with `StreetDataTool roundtrip`, sees exactly one change. Steward's existing stress-test matrix passes against the rebuilt bundle.

### Phase 3 — Road polylines from TrafficData cross-reference

Scope: when TrafficData is present in the same bundle, upgrade Road nodes from points to LINE_STRIP polylines by walking the span→rung chain. This is where roads stop being abstract and start looking like roads in the viewport.

**Success**: opened scene looks like a recognizable wireframe of Paradise City, with visible highway arcs, the bridges, the docks.

### Phase 4 — Expand to TrafficData + AISections + TriggerData

Scope: the full resource set, in one scene. Exporter and importer both. Emphasis on TrafficData — lane-rung ribbons are the geometry the user specifically asked about. Reuse Phase 2's reconciliation framework; it's mostly per-resource glue.

**Success**: user opens a glTF, duplicates a `TrafficSection` node in Blender, stretches the rungs to route traffic through a new side-street, re-imports, boots Paradise, traffic flows through the new section.

### Phase 5 — "Add new traffic section" flow

Scope: importer handles *net-new* entries gracefully (not just edits of existing ones). New TrafficSections in particular are nontrivial because rungs are stored in a global pool with offsets — adding a section means extending the pool, recomputing every section's `muRungOffset` downstream of the insertion point, and regenerating any affected neighbor arrays. This is the "bold" half of the request. Likely requires a `TrafficDataRebuilder` module that mirrors `StreetData`'s rebuild path.

**Success**: the user's original sentence — *"reimport with new traffic sections"* — works end-to-end.

### Phase 6 — Companion Blender addon (stretch)

Scope: a `.py` addon for Blender 4.x that knows the extras schema and adds:

- Sidebar panel showing the parsed `extras` of the selected node with proper field types (enum dropdowns instead of raw ints, bool checkboxes instead of `0`/`1`).
- Templates: "Add new traffic section here" spawns a pre-extras-populated ribbon node at the 3D cursor.
- Validation: `Validate Paradise scene` operator that checks for dangling references, duplicate IDs, missing `extras.ID` fields.
- One-click export back to `.gltf` with the correct extras conventions.

This drops the skill floor from "understand Paradise's format" to "edit boxes in Blender". Out of scope for the core steward repo — lives at a separate repo `steward-blender` or similar. Mentioned here because the design choice *not* to use custom glTF extensions is what makes the addon viable later as an optional QoL layer rather than a hard dependency.

---

## 8. Registry integration

Per [docs/schema-editor-migration.md](schema-editor-migration.md), adding or touching resources is mechanical. The glTF flow doesn't need new resource types — it's a *transformation* over existing ones. Integration points:

- **Handler.caps**: add an optional `caps.gltfExport: boolean` and `caps.gltfImport: boolean`. Defaults to `false`. When true, the resource handler exports a `toGltf(doc, model, ctx)` and `fromGltf(doc, original, ctx)` that the orchestrator dispatches to. This keeps the glTF code discoverable via the registry and parallel to the existing `caps.read`/`caps.write` pattern — no shotgun registration.
- **No schema changes required.** Existing schemas already describe every field; extras keys derive from the schema field names via a deterministic canonicalizer (`muFoo` → `"Foo"`, `mfBar` → `"Bar"`, stripping Hungarian prefixes, mirroring the TriggersToGLTF style exactly).

---

## 9. Test harness — the correctness spine

The byte-exact contract means the CLI test suite isn't a nice-to-have; it's the only thing that tells us the feature works. Pattern matches the existing `npm run bundle -- roundtrip` and `StreetDataTool stress` precedents, which are the reason steward's StreetData port is trustworthy today.

### Subcommands (one per layer)

```
npm run bundle -- export-gltf    <in.dat> [--out <f.gltf>] [--include ...]
npm run bundle -- import-gltf    <orig.dat> <edited.gltf> [--out <new.dat>] [--dry-run]
npm run bundle -- roundtrip-gltf <in.dat>   # export → import → compare. Fails on any byte diff.
npm run bundle -- stress-gltf    <in.dat>   # runs the mutation matrix (see below), fails on any regression.
npm run bundle -- diff-gltf      <a.gltf> <b.gltf>   # human-readable scene diff for debugging failures.
```

### Required tests

**Per-resource round-trip (vitest):** one test per fixture, one fixture per resource type at minimum. For each: parse → export-gltf → import-gltf → write → sha256-compare against input. Must be byte-identical. Fixtures in `example/` get a `gltfRoundtrip: true` assertion in the handler fixtures array — parallel to how `byteRoundTrip` and `stableWriter` already work in [src/lib/core/registry/handler.ts](../src/lib/core/registry/handler.ts).

**Stress matrix (mirrors the 18-scenario `StreetDataTool stress` pattern):** a table of mutations applied at the glTF layer (edit a node's extras, move a translation, duplicate a node, delete a node, add a new node with blank ID), re-imported, and deep-compared (using NaN-aware float compare, matching the `BitConverter.ToInt32` trick in [StreetData.cs stress test](../../C:/Users/Niaz/burnout-pr/Bundle-Manager/StreetDataTool/Stress.cs)). Each row asserts the expected outcome:
| scenario                                        | expected byte-delta | expected diff report                     |
|-------------------------------------------------|---------------------|------------------------------------------|
| baseline (no edits)                             | 0                   | `0 modifications`                        |
| edit scalar extras field                        | ≠0, localized       | `1 modification`                         |
| move translation                                | ≠0, localized       | `1 modification`                         |
| duplicate node, blank ID                        | ≠0                  | `+1 entry`                               |
| delete node                                     | ≠0                  | `-1 entry`                               |
| rename junction (name changes, position same)   | ≠0                  | `1 rename` (if rename-detection enabled) |
| add TrafficSection with 10 rungs                | ≠0                  | `+1 TrafficSection, +10 rungs`           |
| swap two sibling orders                         | 0 (order-insensitive) | `0 modifications`                      |
| unicode in extras string                        | byte-exact          | `0 modifications`                        |
| extras key with `null` value                    | byte-exact          | `0 modifications`                        |

**Cross-resource interaction tests.** When StreetData's road polyline is sourced from TrafficData rung data (Phase 3), edits to TrafficData must not silently desync the StreetData view. One explicit test: edit a rung, re-export, confirm the Road polyline in the fresh glTF reflects it.

**Golden-hash tests.** For each fixture, check in a `fixtures/<name>.gltf.sha256` file. CI fails if the hash changes without an intentional update. Catches accidental regressions in the exporter's determinism (node ordering, JSON key ordering, float-to-string formatting).

**TriggersToGLTF compat test.** Take a TriggerData-only glTF produced by the C++ tool, run it through steward's `import-gltf`, confirm we read it without errors. Our exporter's output is a superset, so this is one-way compatibility — their tool can't read ours (because of the extra extras), but ours reads theirs.

**Determinism.** `export-gltf(file) == export-gltf(file)` byte-for-byte, for the same input on the same platform. No timestamp, no generator version, no RNG. Explicit test.

### Fixture library

Fixtures live in `example/` and grow with the feature. PC-only for now; fixture filenames include platform suffix so we have a migration path when phase 7 adds Remastered. Minimum set for Phase 1:

- `example/BTTSTREETDATA.DAT` — already present (sha1 `9be20668…`, 29584 bytes).
- `example/paradise_trigger.bin` — one TriggerData resource, cross-validated against TriggersToGLTF.
- `example/paradise_aisections.bin` — one AISections fixture.
- `example/paradise_trafficdata.bin` — one TrafficData fixture with non-trivial lane rungs.
- `example/world_logic_full.dat` — optional but bold: a synthetic bundle that combines all four resource types so the one-file-per-bundle assertion is verified end-to-end.

### Debugging hooks

- `--verbose` prints the reconciliation decision per node: `[match-id] Road 12 (0xdeadbeef) → roads[12]`.
- `--trace` dumps intermediate `ParsedStreetData` / `ParsedTrafficData` models alongside the input and output bundles so `diff` reveals which field drifted.
- `npm run bundle -- diff-gltf` (listed above) is not just for CI; it's the primary debugging UI when a stress scenario fails.

## 10. Remaining open questions

---

Still live, to resolve before Phase 1 lands:

1. **Where to stash the bundle-level header fields** that don't fit any per-entry node (e.g. StreetData's `miVersion`, TrafficData's any global counters, AISections' `version` / `sectionMinSpeeds` / `sectionMaxSpeeds`). Candidate: a root-level `scene.extras.paradiseBundle = { streetData: {...}, trafficData: {...} }` blob that's invisible in Blender's outliner. Alternative: one empty `__Metadata` node per resource at the root of its group. Leaning toward scene-level extras — cleaner and doesn't pollute the node tree.
2. **`extras` field naming.** Options: (a) mirror the TS field names verbatim (`muRungOffset`, `mfSpeed`) — pure but cryptic for non-programmers editing in Blender. (b) mirror TriggersToGLTF-style human-readable names (`"Rung offset"`, `"Speed"`) — readable but we have to hand-maintain the mapping. (c) both — machine name in extras, human-readable in a companion `displayName` field. Leaning toward (b) for user resources (Traffic/Street/AI) with a canonical TS→human mapping derived from the schema; keeps Blender-side experience first-class.
3. **Deterministic glTF serialization.** `@gltf-transform/core` is deterministic if we're careful about JSON key order, but needs verification. If it isn't natively, we implement a post-processing canonicalizer. Open until we measure.

## 11. Why this is worth building

Every other "Paradise data-resource editor" in the scene is either a custom GUI (`Bundle-Manager`, `YAP`) or a read-only export (`TriggersToGLTF`, `Oobber`). A true round-trip through vanilla glTF 2.0 is *genuinely novel* in this ecosystem — I checked. The closest existing precedent is DGIorio's Blender addon for Paradise Remastered *models* (geometry only, not logical data); nothing in the community touches street/traffic/AI data with a glTF workflow.

If this ships:

- Modders edit Paradise's logical world in Blender, which they already know, instead of learning a bespoke grid editor.
- Adding a new street or traffic section goes from "hand-patch bytes" to "duplicate node, drag, save".
- The format serves as a human-readable exchange for mod releases — "here's my custom traffic mod as a glTF, reimport to produce the bundle".
- Steward becomes the canonical round-trip tool for Paradise world logic.

The precedent exists (TriggersToGLTF shows the pattern works); the parsers exist (steward already has them); the 3D dependencies exist (three.js is already installed). The only thing missing is the bridge, and the bridge is what this plan describes.

# Online Bundle Manager

A modern web-based tool for exploring and modifying Burnout Paradise bundle files. Built with React and TypeScript, Online Bundle Manager provides an intuitive interface for viewing and editing game resources through a **schema-driven editor framework** with a Unity-style 3-pane layout (hierarchy tree, 3D / 2D viewport, inspector).

## Features

Every editor in the app is powered by the same schema-driven framework (see [Schema-driven editor](#schema-driven-editor)): a hand-written schema per resource declares record types, enums, flags, refs, and tree labels; the framework handles navigation, primitive editing, structural-sharing mutation, and tab layout automatically. Rich legacy tables (traffic flows, vehicle cards, challenge action editors, …) are preserved as **extensions** — React components registered in the schema that slot into `propertyGroups` or `customRenderer` fields without being rewritten.

### Fully supported (read + write + schema editor)

- **AI Sections** (0x10001) — editor for the AI navigation mesh: 8,780+ sections with portals, boundary lines, corners, speed tiers, flags, and section reset pairs. Includes a Unity-style 3D viewport with section selection, section-speed color coding, and instanced portal rendering. Writer round-trips **byte-exact** against the reference fixture. 7 stress scenarios, clean 200+ fuzz iterations.
- **Traffic Data** (0x10002) — editor for the traffic simulation graph: 14 resource types (hulls, sections, rungs, junctions, section flows, flow types, kill zones, vehicle types/assets/traits, traffic lights, light triggers, static vehicles, paint colours). Was the first resource ported to the schema editor and is the reference implementation for `propertyGroups` + extension-preserved tabs.
- **Trigger Data** (0x10003) — editor for world trigger regions: landmarks, generic regions, blackspots, VFX regions, killzones, roaming and spawn locations. 3D viewport with InstancedMesh-batched region gizmos for responsive pan/zoom on real data.
- **Vehicle List** (0x10005) — editor for all 284+ vehicles with gameplay stats, audio config, flags, and unlock metadata. Selecting a vehicle in the tree drills into the full vehicle card (appearance / audio / gameplay / performance / technical sections) via an extension. Writer round-trips **byte-exact**.
- **Street Data** (0x10018) — editor for streets, junctions, roads, and challenge par scores used by the road network. 3D viewport renders the road graph. Writer is lossy-but-idempotent: the first write drops the retail spans/exits tail (which the game ignores due to a FixUp bug), subsequent writes are stable.
- **Challenge List** (0x1001F) — editor for all 500 freeburn challenges, with difficulty, player requirements, two goal actions each, and up to 4 locations per action. Type-aware tree labels surface each challenge's primary action as a short label (`#0 · Near Miss · FBCT_599594`).
- **Player Car Colours** (0x1001E) — editor for all color palettes (Gloss, Metallic, Pearlescent, Special, Party) with paint and pearl Vector4 color values. Writer round-trips **byte-exact**. 32-bit PC layout.
- **PolygonSoup List** (0x43) — editor for world collision polygon soups (WORLDCOL.BIN: 850+ polygon soups, 1.5M triangles total). Dedicated batched 3D viewport, page-level resource picker for multi-resource bundles, `byResourceId` export support for bundles with hundreds of same-typed resources, and a decoded-bitfield inspector extension for `PolygonSoupPoly.collisionTag` (surface kind, sound bank, footstep / particle / decal slots) that clears only the bits it owns and pastes the decoded result back. Writer round-trips **byte-exact** across the entire fixture.
- **AttribSys Vault** — typed vehicle-attribute writer used by vehicle bundles. Has a dedicated editor page ([AttribSysVaultPage](src/pages/AttribSysVaultPage.tsx)) plus 9 stress scenarios covering top-speed, boost, torque, mass, FOV, drift params, full-tune, and zero-grip mutations.
- **Material** (0x40) — read+write handler for the per-mesh Material resource that points at a Shader plus per-register sampler / cbuffer bindings. Drives both the schema-editor and the Renderable viewer's translated-shader path (the cross-bundle MaterialAssembly index is built from this handler).
- **Model** (0x2A) — read+write handler for the LOD container that maps state indices to Renderable LODs. Stress scenarios cover LOD-distance bumps, state-mapping shuffles, and flag-bit flips.
- **Shader** (0x12) + **ShaderProgramBuffer** — read+write handlers for vehicle / world shaders, with a dedicated [ShaderPage](src/pages/ShaderPage.tsx) for inspecting the DXBC bytecode, RDEF cbuffers, and named techniques. The Shader handler is the source of bytecode for the DXBC → GLSL translator that powers translated-shader rendering in the Renderable viewer.
- **DeformationSpec** — read+write handler for the per-vehicle deformation spec (handling-body scale, wheel raise/drop, sensor radii, IK-part joint angles, transform-tag positions, driven-point distance sums). 9 stress scenarios.
- **WheelGraphicsSpec** + **GraphicsStub** — read+write handlers for the wheel/caliper Model lookup and the small per-bundle graphics stub. Both are byte-exact round-trip with a handful of structural mutation scenarios each.

### Read-only

- **Renderable + GraphicsSpec viewer** — three.js-powered 3D viewer for vehicle bundles, now integrated as a schema-editor viewport. The left pane lists meshes, materials, and vertex descriptors via the schema tree; the center pane runs the r3f scene with click-to-select; the right pane inspects per-mesh draw parameters, resolved Material / VertexDescriptor imports, part locator status, and the per-mesh OBB matrix. Walks the GraphicsSpec → Model → Renderable chain, applies per-part `mpPartLocators` Matrix44 transforms, and decodes vertex/index data from each Renderable's secondary block. See [Renderable viewer](#renderable-viewer) for details.
- **Texture** — schema editor with a dedicated 2D texture viewport showing the decoded pixel data alongside the header metadata (format, dimensions, mip count, flags). Pixel blobs are marked as opaque in the schema to keep them out of the walker.
- **TextureState** (0x42) — sampler-state metadata that pairs with each Texture (filter, wrap, addressing mode). Parsed by the registry so the Renderable viewer's material-binding chain can surface samplers; no dedicated editor page yet.
- **ICE Take Dictionary** — schema editor over the in-game camera editor take dictionary. Spec still incomplete on the Burnout Wiki; fields beyond the header are mirrored as-is from the parser.

### Tools

- **Hex Viewer** — low-level bundle inspection with coverage map, resource metadata, and color-coded sections by type.
- **Bundle CLI** — a first-class command-line harness that drives the exact same handler registry the UI consumes. See [CLI](#cli).

### Platform support

- 32-bit PC. 64-bit Paradise Remastered and big-endian console bundles (X360, PS3) are not supported.

## Getting started

### Prerequisites

- **Node.js 22+** (the `lovable-tagger` devDep and Vite 5 require it)
- Modern web browser with WebGL support

### Installation

```bash
git clone https://github.com/derneuere/paradise-bundle-steward.git
cd paradise-bundle-steward
npm install
```

### Development

```bash
npm run dev
```

Open your browser to `http://localhost:8080`.

### Building

```bash
npm run build
```

### Tests

```bash
npm run test:run                  # run the full vitest suite
npm run test                      # watch mode
```

The test suite is auto-generated from the handler registry — every registered handler's `fixtures` array contributes tests without touching `registry.test.ts`. Writable handlers assert byte-exact or idempotent round-trips against the sample bundles in `example/`.

## Usage

1. **Load a bundle** — click "Load Bundle File" and pick a `.BUNDLE` / `.DAT` / `.BNDL` file. All example bundles under `example/` work.
2. **Explore resources** — the Resources tab lists every resource in the bundle with its type, size, and an "Edit" link when a handler is registered.
3. **Edit** — click any "Edit X" link to open the visual editor for that resource. Every editor reads through `useBundle().getResource<T>(key)` and writes back through `setResource(key, next)` — no page-specific context plumbing.
4. **Export** — the "Export Bundle" button in the header rebuilds the bundle via `writeBundleFresh`, which iterates the registry and calls each writable handler's `writeRaw` for any resource you edited.
5. **Inspect** — the Hex View tab shows the raw bundle layout for any resource, and the Resource Inspector page drills into individual entries.

## CLI

The CLI (`scripts/bundle-cli.ts`) is the primary surface for iterating on parsers and finding edge cases. It drives the same `src/lib/core/registry` the UI uses, so every improvement flows both ways automatically.

```bash
# Enumerate resources in a bundle
npm run bundle -- list example/VEHICLELIST.BUNDLE

# Parse a known resource and print a summary
npm run bundle -- parse example/BTTSTREETDATA.DAT
npm run bundle -- parse example/CAMERAS.BUNDLE --type iceTakeDictionary

# Dump a parsed model to JSON (bigint-safe) and re-pack it
npm run bundle -- dump example/VEHICLELIST.BUNDLE out.json --type vehicleList
npm run bundle -- pack out.json patched.BUNDLE --type vehicleList

# Full read → write → re-read check
npm run bundle -- roundtrip example/AI.DAT
npm run bundle -- roundtrip example/ONLINECHALLENGES.BNDL
npm run bundle -- roundtrip example/TRIGGERS.DAT

# Run a handler's registered stress scenarios
npm run bundle -- stress example/BTTSTREETDATA.DAT
npm run bundle -- stress example/VEHICLELIST.BUNDLE --type vehicleList
npm run bundle -- stress example/VEHICLELIST.BUNDLE --type vehicleList --scenario add-vehicle

# Seeded random structural fuzzing
npm run bundle -- fuzz example/AI.DAT --iterations 200
npm run bundle -- fuzz example/BTTSTREETDATA.DAT --iterations 100 --seed 1
npm run bundle -- fuzz example/VEHICLELIST.BUNDLE --type playerCarColours

# World-logic glTF round-trip (StreetData / TrafficData / AISections / TriggerData)
npm run bundle -- export-gltf example/WORLDLOGIC.BUNDLE worldlogic.glb
npm run bundle -- import-gltf example/WORLDLOGIC.BUNDLE edited.glb patched.BUNDLE
npm run bundle -- roundtrip-gltf example/WORLDLOGIC.BUNDLE
```

### Stress mode

`stress` runs a set of pre-registered mutation scenarios against a writable handler. Each scenario applies a known edit (remove last street, toggle a flag, add a brand-new vehicle with every field populated, etc.), writes the mutated model, re-parses the bytes, writes again, and asserts the writer is idempotent. An optional per-scenario `verify` hook does deeper field-level checks.

Today's coverage:

- **AISections** (7): `baseline`, `edit-first-section-speed`, `toggle-first-section-flags`, `remove-last-section`, `remove-last-reset-pair`, `edit-first-section-id`, `swap-first-two-sections`
- **StreetData** (5): `baseline`, `remove-last-street`, `remove-last-road-and-challenge`, `edit-road-debug-name`, `zero-all-challenge-scores`
- **VehicleList** (7): `baseline`, `edit-first-name`, `toggle-first-flags`, `swap-first-two`, `bulk-zero-colors`, `add-vehicle`, `remove-last-vehicle`
- **TriggerData** (8): `baseline`, `remove-last-landmark`, `remove-last-generic-region`, `remove-last-blackspot`, `remove-last-spawn-location`, `edit-first-landmark-id`, `zero-first-spawn-position`, `bulk-pop-every-array`
- **ChallengeList** (6): `baseline`, `remove-last-challenge`, `edit-first-challenge-title`, `zero-first-challenge-difficulty`, `zero-first-action-time-limit`, `duplicate-last-challenge`
- **TrafficData** (24): `baseline` plus per-array `remove-last-*` / `remove-first-*` / `duplicate-first-*` mutations across hulls, sections, rungs, neighbours, static vehicles, junctions, stop lines, light triggers, section spans, flow types, kill zones, vehicle types/assets/traits, paint colours, and traffic lights — exercises every count-derived pointer in the writer
- **PolygonSoupList** (7): `baseline`, `pop-last-soup`, `pop-first-soup`, `swap-first-two-soups`, `duplicate-first-soup`, `insert-synthetic-at-middle`, `append-synthetic-soup`
- **AttribSysVault** (9): `baseline`, `set-max-speed`, `set-boost-values`, `set-engine-torque`, `set-driving-mass`, `set-fov`, `set-drift-params`, `full-tune`, `zero-all-grip`
- **DeformationSpec** (9): `baseline`, `scale-handling-body`, `raise-all-wheels`, `sensor-radii-x2`, `tag-point-initial-positions-zero`, `driven-point-distance-sum`, `identity-car-to-handling-transform`, `tweak-ikpart-joint-angles`, `shift-all-transform-tags`
- **Material** (3): `baseline`, `flip-shader-id-low-bit`, `reverse-material-states`
- **Model** (4): `baseline`, `bump-lod-distances`, `shuffle-state-mapping`, `flip-flags-bit`
- **Shader** (2) + **ShaderProgramBuffer** (1): `baseline`, `flip-flags-bit` / `baseline`
- **WheelGraphicsSpec** (3): `baseline`, `swap-wheel-caliper-ids`, `drop-caliper`
- **GraphicsStub** (2): `baseline`, `swap-slot-indices`

Single-field mutations are surgical — editing `vehicles[0].boostCapacity` changes exactly one byte at the expected offset, nothing adjacent.

### Fuzz mode

`fuzz` applies **seeded random structural mutations** to the top-level arrays of a handler's model, then asserts writer idempotence and re-parse success on every iteration. Unlike stress scenarios (which are hand-curated and deterministic), fuzzing is generic — the same mutation walker runs against every writable handler — and intentionally explores combinations of edits no one would write by hand.

Operators: `pop`, `dup`, `swap`, `clear`, `append` (bias away from `clear`). Only top-level arrays are touched; nested arrays and primitive fields are left alone. The goal is exercising count-derived pointer math and writer branches, not random-byte garbage.

Handlers declare `fuzz.tolerateErrors` regexes for known invariant violations — e.g., StreetData enforces `challenges.length === roads.length` and TriggerData's writer rejects killzones whose `triggerIds` reference a popped GenericRegion. The fuzzer counts those as **tolerated rejections** (expected) rather than **failures** (bugs).

```bash
# 100 random mutations, fixed seed for reproducibility
npm run bundle -- fuzz example/TRIGGERS.DAT --iterations 100 --seed 42

# Failures print a mutation trace so you can reproduce by hand:
#   iter  42  FAIL  writer not idempotent (write1 30016 B, write2 30080 B)
#         trace: pop streets @17, dup junctions @3, swap roads @5 ↔ @12
```

Default seed is `Date.now()` (printed at startup). Same seed → identical mutation sequence → identical results.

## Renderable viewer

Vehicle graphics bundles (`*_GR.BNDL`, `VEH_*_GR.BIN`, etc.) carry a chain
of three resource types that together describe a car body:

```
GraphicsSpec (0x10006)         ← top level, one per vehicle
  ├── parts: u32[partsCount]   ← indices into the GraphicsSpec's import table
  ├── locators: Matrix44[partsCount]   ← per-part world transforms
  └── imports → Model (0x2A) per part
        ├── numRenderables / numStates / state→renderable map
        └── imports → Renderable (0xC) per LOD
              ├── meshCount + per-mesh DrawIndexedParameters
              ├── shared IndexBuffer + VertexBuffer body block
              ├── imports → Material per mesh
              └── imports → VertexDescriptor per mesh (up to 6 slots)
```

The `/renderable` route walks this whole chain in the browser and assembles
the car in a [react-three-fiber](https://r3f.docs.pmnd.rs/) scene. No
intermediate OBJ/glTF export — the bundle bytes go straight to
`THREE.BufferGeometry` instances.

### Toggles in the viewer header

- **source: GraphicsSpec / all renderables** — `GraphicsSpec` mode walks the
  GraphicsSpec parts table and only renders the LOD0 Renderable for each
  part, with the part locator applied. `all renderables` skips the GraphicsSpec
  and dumps every Renderable in the bundle into the scene at origin (no
  transforms). Useful when you want to see lower-LOD or non-vehicle bundles.
- **lod: LOD0 only / all LODs** — drops Renderables whose RST name ends in
  `_LOD1`+. Reduces overdraw when `all renderables` is selected. Has no
  visible effect in `GraphicsSpec` mode (that path is already LOD0-only).
- **locator: fromArray / rowSet** — controls how the GraphicsSpec
  `mpPartLocators` 16-float matrices are converted to `THREE.Matrix4`. The
  on-disk format is row-major OpenTK with translation in the bottom row;
  `fromArray` (the correct mode for BP PC bundles) reads them column-major,
  effectively transposing into three.js's column-major-with-right-column-
  translation form. `rowSet` is a debugging fallback that uses
  `Matrix4.set()` literally — kept around in case a future bundle ships with
  the alternate convention.
- **mesh xform: none / full** — debugging toggle for the per-mesh
  `boundingMatrix` (the 64-byte matrix at the start of every RenderableMesh).
  This is **confirmed to be an oriented bounding box descriptor**, not a
  transform — the toggle exists so future maintainers can re-verify by
  applying it as a Matrix4 and watching every mesh squash into its OBB cell.
  Default `none` is the correct choice for actual rendering.

### Click-to-inspect

Hover any mesh to highlight it (light blue tint). Click to select (orange
tint, persists). The right-side panel shows the parent Renderable id, the
debug name from the bundle's ResourceStringTable, the per-mesh draw
parameters, the resolved material + VertexDescriptor import ids, the part
locator presence flag, and the full 4×4 OBB matrix dump. Click empty space
to deselect.

The picking uses r3f's built-in raycaster — no manual `THREE.Raycaster`
calls. `e.stopPropagation()` on each mesh's `onClick` ensures the closest
hit wins when meshes overlap.

### Translated shaders + textures

The viewer also has a **`useTranslatedShaders` toggle** that swaps the flat
`MeshStandardMaterial` fallback for real game shaders. With it enabled, the
pipeline builds a cross-bundle texture catalog and a Material → Shader
binding index over the primary bundle, all loaded `secondaryBundles`, and
the page-level "+ texture pack" list (so dropping in `SHADERS.BNDL` or a
texture pack lights up shaders that wouldn't otherwise translate).

For each unique mesh material the renderer:

1. Resolves the mesh's `materialAssemblyId` → Material → Shader id chain.
2. Translates the vertex + pixel DXBC bytecode to GLSL via
   [`src/lib/core/dxbc/`](src/lib/core/dxbc/) (SM5 translator with cbuffer
   layout inference).
3. Pulls per-register sampler bindings from the Material, falling back to
   name-matched textures from the catalog.
4. Decodes DXT1/DXT5 swizzled mips and feeds them into a
   `THREE.ShaderMaterial` built by
   [`buildTranslatedShaderMaterial`](src/lib/core/translatedShaderMaterial.ts),
   with an optional preview tonemap so HDR PaintGloss output doesn't
   saturate to white in the absence of an engine post-stack.

Result on the CARBRWDS sample: 86/86 shaders compile and many parts render
with their lit shading and per-part textures. Non-identity vertex skinning
(wheels) and a couple of vehicle-specific shaders still render dark — see
the Roadmap.

### Limitations

- **No skinning.** BoneIndexes / BoneWeights vertex attributes are decoded
  but not used. The car renders in its bind pose.
- **CARBRWDS-tested only.** All locators in our sample have identity
  rotation; non-identity rotations are supported in the parser but unverified.
  Wheels in particular need testing on a different vehicle bundle.
- **No GraphicsSpec writer.** The viewer is read-only. Editing geometry or
  re-packing a vehicle bundle is out of scope.

## World-logic glTF round-trip

The four world-logic resources (StreetData, TrafficData, AISections,
TriggerData) can be exported as a **single combined glTF document**, edited
in Blender (or any glTF-aware tool), and re-imported into the original
bundle. The CLI commands `export-gltf`, `import-gltf`, and
`roundtrip-gltf` in [`scripts/bundle-cli.ts`](scripts/bundle-cli.ts) are
the entry points; the orchestration lives at
[`src/lib/core/gltf/worldLogicGltf.ts`](src/lib/core/gltf/worldLogicGltf.ts)
with one subtree builder per resource (`streetDataGltf.ts`,
`trafficDataGltf.ts`, `aiSectionsGltf.ts`, `triggerDataGltf.ts`).

Convention (full spec in
[`docs/worldlogic-gltf-roundtrip.md`](docs/worldlogic-gltf-roundtrip.md)):
each resource owns one root-level group node and one key under
`scene.extras.paradiseBundle`. Importers reconcile **adds, deletes, and
edits** of nodes back to the parsed model — the dedicated reconcile tests
([`blenderAddDelete.test.ts`](src/lib/core/gltf/blenderAddDelete.test.ts),
[`blenderEditReconcile.test.ts`](src/lib/core/gltf/blenderEditReconcile.test.ts))
simulate Blender's typical "duplicate / delete / nudge" workflow against
each subtree.

This is the recommended path for bulk edits to the road / traffic / AI /
trigger graphs that would be tedious in the schema editor (e.g. dragging a
chain of TrafficData section rungs). Anything edited in Blender and
re-imported flows through the same registry writers as the schema editor,
so byte-exact / stable-writer guarantees still apply.

## Architecture

### Handler registry

The core of the app is the **resource handler registry** at `src/lib/core/registry/`. Every resource type is represented by a single `ResourceHandler<Model>` object that bundles:

- `parseRaw(bytes, ctx)` — decode already-decompressed bytes into a typed model
- `writeRaw(model, ctx)` — re-encode the model (optional for read-only handlers)
- `describe(model)` — one-line CLI summary
- `category` — `'Data' | 'Graphics' | 'Camera'`, used by the CLI and Resources page to group handlers in the UI
- `fixtures` — pinned example bundles for regression testing
- `stressScenarios` — optional hand-curated mutation scenarios
- `fuzz.tolerateErrors` — optional regexes for writer-invariant rejections the CLI fuzzer should treat as expected

The registry is the single source of truth for which resources exist and how they behave. `src/lib/resourceTypes.ts`, `src/lib/capabilities.ts`, `src/context/BundleContext.tsx` state, `src/pages/ResourcesPage.tsx` NavLinks, and `src/App.tsx` routes are all **derived from the registry** — adding a new resource type requires editing exactly one new file in `registry/handlers/` plus one line in `registry/index.ts`.

### Schema-driven editor

Above the registry sits a second layer: a **schema-driven editor framework** at `src/lib/schema/` and `src/components/schema-editor/`. Every page that edits a parsed model goes through the same React provider + 3-pane layout; no resource-specific page plumbing survives.

The schema is a plain TypeScript declaration — one file per resource at `src/lib/schema/resources/<key>.ts`. It enumerates record types, their fields, field kinds (`u8` / `u16` / `u32` / `i8` / `i16` / `i32` / `f32` / `bigint` / `bool` / `string` / `enum` / `flags` / `vec2` / `vec3` / `vec4` / `matrix44` / `ref` / `record` / `list` / `custom`), `fieldMetadata` (label, description, hidden, readOnly, derivedFrom), `propertyGroups` for tab layout, tree-label callbacks, and cross-field validation hooks. The schema **is the contract** — a coverage test walks the parsed data against the schema in both directions and fails the build on drift in either.

On top of that, `src/lib/schema/walk.ts` provides immutable, structural-sharing `getAtPath` / `updateAtPath` / `insertListItem` / `removeListItem` / `resolveSchemaAtPath` / `walkResource` helpers. The editor's mutation plumbing is one line per action: the inspector calls `setAtPath(path, value)` and the provider hands back a new root with only the touched branch rewritten.

The editor UI lives at `src/components/schema-editor/`:

- **`SchemaEditor.tsx`** — the top-level 3-pane layout (hierarchy / viewport / inspector) used by every editable page.
- **`HierarchyTree.tsx`** — virtualized tree (for 5k+ list items without click latency) that walks the schema to build collapsible nodes and runs the per-record `label()` callback at render time.
- **`InspectorPanel.tsx`** — renders the selected record as a form grouped by `propertyGroups`, with each group showing either raw fields or a `component:` extension.
- **`ViewportPane.tsx`** — dispatches by `resource.key` to one of the viewport modules (PolygonSoupList, Renderable, Texture, …) or shows "no viewport available" for resources without spatial data.
- **`fields/`** — 15 renderer components, one per field kind, dispatched by `FieldRenderer.tsx`. The default renderers cover every kind in `types.ts`; complex lists opt out via `customRenderer` and slot a Phase 1/2 tab back in unchanged.
- **`extensions/<key>Extensions.tsx`** — adapters that wrap legacy tables as `SchemaExtensionProps` components (`{ path, value, setValue, setData, data, resource }`) so Phase 1/2 UI code survives the migration with no rewrite.

**Why this exists**: the pre-schema pattern was one bespoke editor page per resource, each wiring its own tabs, lists, and mutation callbacks. Every new resource meant a full page rewrite and a fresh chance to forget something the parser cares about. The schema flips that: the coverage test enforces completeness, tree navigation and mutation come for free, and the only code a new resource needs is the schema declaration (plus extensions for any preserved legacy tables). The ChallengeList migration was 4 schema records + 3 extension wrappers + a 50-line page; the StreetData and TriggerData migrations reused their entire existing tab stacks via extensions.

### Directory layout

```
src/lib/core/
  registry/
    handler.ts         # ResourceHandler + StressScenario interfaces
    index.ts           # handler array + byTypeId/byKey lookup
    extract.ts         # single absolute-offset + decompress helper
    bundleOps.ts       # parseBundleResourcesViaRegistry (used by UI)
    editors.ts         # handler.key → lazy React page map
    handlers/          # one file per resource type
    registry.test.ts   # auto-generated fixture suite
  bundle/              # low-level bundle parser (header, entries, debug data)
  dxbc/                # DXBC SM5 → GLSL translator (parser, ops, glsl emitter)
  gltf/                # world-logic glTF round-trip (Street/Traffic/AI/Trigger + Blender reconcile)
  aiSections.ts        # parseRaw/writeRaw for AI Sections (byte-exact)
  streetData.ts        # parseRaw/writeRaw for StreetData
  triggerData.ts
  challengeList.ts
  vehicleList.ts
  playerCarColors.ts   # 32-bit only
  iceTakeDictionary.ts # read-only, partial
  renderable.ts        # read-only Renderable (0xC) + VertexDescriptor (0xA)
  graphicsSpec.ts      # read-only GraphicsSpec (0x10006) parser
  model.ts             # parseRaw/writeRaw for Model (0x2A)
  material.ts          # parseRaw/writeRaw for Material (0x40)
  shader.ts            # parseRaw/writeRaw for Shader (0x12) + ShaderProgramBuffer
  deformationSpec.ts   # parseRaw/writeRaw for DeformationSpec
  wheelGraphicsSpec.ts # parseRaw/writeRaw for WheelGraphicsSpec
  graphicsStub.ts      # parseRaw/writeRaw for GraphicsStub
  polygonSoupList.ts   # parseRaw/writeRaw for PolygonSoup (byte-exact)
  collisionTag.ts      # decoded-bitfield helpers for PolygonSoupPoly.collisionTag
  texture.ts           # read-only Texture (DXT1/DXT5 decode)
  textureState.ts      # read-only TextureState (sampler metadata)
  textureCatalog.ts    # cross-bundle texture name catalog (Renderable viewer)
  materialBinding.ts   # per-register MaterialAssembly binding extractor
  materialChain.ts     # Material → Shader → cbuffer/sampler resolution
  translatedShaderMaterial.ts  # builds THREE.ShaderMaterial from translated DXBC
  trafficData.ts       # parseRaw/writeRaw for TrafficData
  binTools.ts          # BinReader / BinWriter primitives
  resourceManager.ts   # extractResourceData, compress/decompress
src/lib/schema/
  types.ts             # FieldSchema / RecordSchema / ResourceSchema / FieldMetadata
  walk.ts              # getAtPath / updateAtPath / walkResource / resolveSchemaAtPath
  resources/           # one <key>.ts schema + <key>.test.ts coverage test per resource
src/components/schema-editor/
  SchemaEditor.tsx     # 3-pane layout (hierarchy / viewport / inspector)
  HierarchyTree.tsx    # virtualized tree navigating the schema + per-record labels
  InspectorPanel.tsx   # record form with propertyGroups + tabs + extension slots
  ViewportPane.tsx     # dispatches to per-key 3D / 2D viewports
  context.tsx          # SchemaEditorProvider + useSchemaEditor (selection + mutation)
  fields/              # 15 FieldRenderer dispatches (Int, Vec3, Enum, Flags, Ref, …)
  viewports/           # PolygonSoupListViewport, RenderableViewport, TextureViewport
  extensions/          # per-resource React adapters wrapping legacy tabs
src/pages/
  WorkspacePage.tsx       # /workspace — multi-Bundle editor; the home for every schema-driven resource
  PolygonSoupListPage.tsx # bespoke pages — one per resource that needs custom UX
  RenderablePage.tsx      #   (cross-instance picking, decoded-mesh preview,
  TexturePage.tsx         #    shader compilation, etc.)
  …
```

### Adding a new resource type

1. Write the binary parser and writer in `src/lib/core/<key>.ts` with `parse*Data(bytes)` and `write*Data(model)` functions. Use `BinReader` / `BinWriter` from `binTools.ts`.
2. Create `src/lib/core/registry/handlers/<key>.ts` exporting a `ResourceHandler<Model>` with `caps`, `describe`, `parseRaw`, `writeRaw`, and at least one `fixtures` entry.
3. Add one import and one array entry in `src/lib/core/registry/index.ts`.
4. (If editable) write `src/lib/schema/resources/<key>.ts` — a `ResourceSchema` with one `RecordSchema` per nested struct in the parser, `fieldMetadata` for hidden / derived fields, `propertyGroups` for the tab layout, and `label()` callbacks on any user-navigable list. Copy the shape of [`src/lib/schema/resources/trafficData.ts`](src/lib/schema/resources/trafficData.ts) (complex, extensions-first) or [`playerCarColours.ts`](src/lib/schema/resources/playerCarColours.ts) (minimal, schema-first).
5. (If editable) write `src/lib/schema/resources/<key>.test.ts` modeled after `trafficData.test.ts`: assert `walkResource` coverage in both directions, `resolveSchemaAtPath` on a deep path, structural-sharing mutation, and writer idempotence against the fixture (byte-exact or `stableWriter` per the handler's declared expectation).
6. (If preserving rich legacy tabs) write `src/components/schema-editor/extensions/<key>Extensions.tsx` with one adapter per legacy tab that translates between the schema editor's `SchemaExtensionProps` contract and the existing component props. Reference the adapter from the schema via `propertyGroups: [{ component: 'TabName' }]` or `list: { customRenderer: 'TabName' }`.
7. Register an `EditorProfile` in `src/lib/editor/profiles/<key>.ts` (schema, displayName, optional `matches` for versioned variants) and a render binding in `src/lib/editor/bindings.ts` (overlay + extensions keyed on `(resourceKey, profileKind)`). The `/workspace` editor consumes both — no `src/pages/` entry, no `EDITOR_PAGES` entry. Only resources that need custom UX beyond what the Workspace inspector provides (decoded-mesh preview, shader compilation, multi-instance picking) get a bespoke page registered in `EDITOR_PAGES`.
8. (If 3D-spatial) the overlay registered in step 7 mounts inside the `WorldViewport` composition automatically. Simple overlays render their own scene primitives; multi-instance overlays (PolygonSoupList) use a dedicated context to share state with their bespoke page.
9. (Optional) add a `HANDLER_META` entry in `src/lib/capabilities.ts` for notes and wiki URLs that aren't machine-derivable.

`types.ts`, `resourceTypes.ts`, `capabilities.ts` (except meta), `BundleContext.tsx`, `ResourcesPage.tsx`, and `App.tsx` are **never touched**. The migration prompts at [`docs/schema-editor-migration.md`](docs/schema-editor-migration.md) contain copy-pasteable per-resource briefs with the gotchas each one hit.

### Technical details

- **React 18** + **TypeScript 5** + **Vite 5** for the app shell
- **shadcn/ui** + **Tailwind CSS** for the UI component library
- **typed-binary** + custom `BinReader` / `BinWriter` for binary parsing
- **three** + **@react-three/fiber** + **@react-three/drei** for the in-browser 3D viewer
- **pako** for zlib compression/decompression
- **vitest** for the auto-generated fixture suite
- **tsx** runs the CLI under Node without a separate build step

## Roadmap

### Short term

- **More handler-level fuzz coverage** — the generic array walker only touches top-level arrays; nested per-entry arrays (road spans, junction exits, challenge actions) are still out of reach.
- **Schema-driven validation surface** — `RecordSchema.validate` already exists and a couple of resources use it, but the inspector doesn't yet show warnings/errors inline. TriggerData's drive-thru v1.0/v1.9 limit check is the canonical first use case.
- **Count-field reconciliation helper** — writers that reject `muNum* !== array.length` mismatches currently require the editor to update both. A `derivedFrom` hook on the schema mutation pipeline could patch them automatically.
- **Verify Renderable viewer on non-CARBRWDS vehicles** — every locator we've tested has identity rotation. Need a bundle where some part has a non-identity rotation (likely a wheel or a tilted spoiler) to confirm the `fromArray` matrix conversion is correct in the general case.
- **Wheels.** Wheel geometry isn't visibly distinct from body parts in our CARBRWDS sample. Need to confirm wheels come through the GraphicsSpec parts table on a vehicle that has visually obvious wheel geometry.


### Renderable viewer follow-ups

- **Vehicle / skinned shaders that still render dark.** With `useTranslatedShaders` enabled, all 86 shaders in the CARBRWDS sample compile and many parts now render with their lit shading and per-part textures, but a handful of vehicle-specific shaders (and anything that needs skinning) still come out unlit. Likely missing cbuffer values or unbound samplers — the diagnostic scripts under `scripts/probe-*.ts` are the entry points for chasing these down.
- **Skinning / bone weights.** `BoneIndexes` and `BoneWeights` vertex attributes are decoded by `decodeVertexArrays()` but not exposed. A future skeletal pose viewer could light them up.
- **ShatteredGlassParts.** Parsed by `parseGraphicsSpec` (count + table offset) but not rendered. Each entry maps a Model to a body part index for hot-swap on collision.
- **Per-mesh OBB visualization.** The `boundingMatrix` is a confirmed OBB. A future "show bounds" toggle could draw the OBBs as wireframe boxes for debugging mesh placement.
- **Vehicle picker UI.** When a bundle contains multiple GraphicsSpecs (does this happen for non-vehicle bundles?), the viewer currently picks the first one. A picker dropdown would be cleaner.
- **Camera fit-to-selection.** Clicking a mesh could optionally re-frame the OrbitControls target on the selected mesh's centroid.

### Blocked

- **ICE Take Dictionary** full support — blocked by incomplete Burnout Wiki spec
- **Renderable / VertexDescriptor TUB-PC branch** — the viewer only handles the BPR-format VertexDescriptor (`unknown2 != 0`, 20-byte attribute records). Pre-BND2 Xbox 360 / PS3 bundles use the older 16-byte-per-attr format and would need a second decoder branch — currently no test data for this.

### Long term

- Additional resource type parsers (based on community needs)
- Resource diffing and comparison tools in the CLI (`bundle -- diff a.bundle b.bundle`)
- 64-bit Paradise Remastered support (scale/stride changes throughout the parser stack)
- Big-endian X360 / PS3 console-bundle support

## Motivation

### Why this project exists

Online Bundle Manager modernizes the Burnout Paradise modding experience with three core goals:

1. **Modern tech stack** — React and TypeScript enable rapid development and excellent DX. Coming from web development, these tools are natural and productive.
2. **Better UX** — React makes it dramatically easier to create intuitive, responsive interfaces than traditional C# Windows Forms. Modern web UI patterns provide a superior user experience.
3. **AI-assisted development** — TypeScript and React are exceptionally well-suited for AI-assisted coding. The goal is to "vibe code" through Burnout Wiki specifications in about an hour per feature. This is a passion project, and the thesis is that AI-assisted development makes it feasible to implement game specs quickly and accurately.

### Development workflow

- **UI prototyping**: [Lovable](https://lovable.dev) for rapid UI iteration
- **Core logic**: [Claude Code](https://claude.com/code) for implementing parsers, writers, and the CLI harness
- **Specifications**: [Burnout Wiki](https://burnout.wiki) snapshots in `docs/` as the authoritative source

### What works well

- **Typed models make editors trivial** — once `ResourceHandler<Model>` is defined, the React components practically write themselves via shadcn/ui primitives.
- **CLI-driven iteration** — the registry is the single source of truth, so the CLI is the primary surface for debugging parsers. `bundle -- roundtrip` catches regressions in seconds; `bundle -- stress` catches edge cases AI assistants tend to miss when writing writers.
- **Schema-driven editor framework** — the hand-written `ResourceSchema` per resource describes the whole model in one place, and the framework handles tree navigation, inspector forms, structural-sharing mutation, virtualized lists, and tab layout uniformly. A new resource now ships as roughly 300 lines of schema declaration + a 50-line page wrapper, and the coverage test enforces that the schema tracks the parser forever. Legacy tables from the pre-schema era (vehicle cards, challenge action editors, traffic flow tables) survive unchanged as `extensions` slotted into schema `propertyGroups` — no rewrite tax for the migration.

## Contributing

Contributions are welcome! The codebase is designed to be AI-friendly for rapid feature development.

### Areas for contribution

- Additional resource type parsers — use the handler-registry pattern, reference the matching `docs/*.md` spec
- Stress scenarios for existing handlers
- UI/UX improvements
- Bug fixes and optimizations

## License

This project is for educational and research purposes. Burnout Paradise is a trademark of Electronic Arts Inc.

## Resources

- [Burnout Wiki](https://burnout.wiki) — comprehensive documentation of game formats
- [Bundle Manager (C#)](https://github.com/burninrubber0/Bundle-Manager) — reference implementation by the community
- `docs/` — local snapshots of the Burnout Wiki spec pages used as the ground truth for each handler

## Acknowledgments

- The Burnout modding community for reverse-engineering the game formats
- Burnout Wiki contributors for documenting specifications
- Original Bundle Manager developers for pioneering the tooling

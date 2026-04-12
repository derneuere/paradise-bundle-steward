# Online Bundle Manager

A modern web-based tool for exploring and modifying Burnout Paradise bundle files. Built with React and TypeScript, Online Bundle Manager provides an intuitive interface for viewing and editing game resources including challenges, trigger data, vehicles, street data, and more.

## Features

### Fully supported (read + write + editor)

- **AI Sections** — editor for the AI navigation mesh: 8,780+ sections with portals, boundary lines, corners, speed tiers, flags, and section reset pairs. Writer round-trips **byte-exact** against the reference fixture. Includes 7 stress scenarios and passes 200+ fuzz iterations cleanly.
- **Challenge List** — visual editor for all 500 freeburn challenges, with difficulty, player requirements, actions, and locations.
- **Trigger Data** — complete editor for world trigger regions: landmarks, generic regions, blackspots, VFX regions, killzones, roaming and spawn locations.
- **Vehicle List** — editor for all 284+ vehicles with gameplay stats, audio config, flags, and unlock metadata. Writer round-trips **byte-exact** against the reference fixture.
- **Street Data** — tabbed editor for streets, junctions, roads, and challenge par scores used by the road network. Writer is lossy-but-idempotent: the first write drops the retail spans/exits tail (which the game ignores due to a FixUp bug), subsequent writes are stable.
- **Player Car Colours** — editor for all color palettes (Gloss, Metallic, Pearlescent, Special, Party) with paint and pearl Vector4 color values. Writer round-trips **byte-exact** against the reference fixture. 32-bit PC layout.

### Read-only

- **Renderable + GraphicsSpec viewer** — three.js-powered 3D viewer for vehicle bundles. Walks the GraphicsSpec → Model → Renderable chain, applies per-part `mpPartLocators` Matrix44 transforms, decodes vertex/index data from each Renderable's secondary block, and renders the assembled car in-browser. Click any mesh to see its parent Renderable id, RST debug name, vertex/index/triangle counts, resolved Material + VertexDescriptor imports, part locator status, and the per-mesh OBB matrix dump. LOD0 filter, GraphicsSpec vs all-Renderables source toggle, locator-interpretation toggle, and a debugging boundingMatrix-as-transform toggle. See [Renderable viewer](#renderable-viewer) for details.
- **ICE Take Dictionary** — partial support for the in-game camera editor take dictionary. Spec incomplete on the Burnout Wiki.

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
```

### Stress mode

`stress` runs a set of pre-registered mutation scenarios against a writable handler. Each scenario applies a known edit (remove last street, toggle a flag, add a brand-new vehicle with every field populated, etc.), writes the mutated model, re-parses the bytes, writes again, and asserts the writer is idempotent. An optional per-scenario `verify` hook does deeper field-level checks.

Today's coverage:

- **AISections**: `baseline`, `edit-first-section-speed`, `toggle-first-section-flags`, `remove-last-section`, `remove-last-reset-pair`, `edit-first-section-id`, `swap-first-two-sections` (7 scenarios)
- **StreetData**: `baseline`, `remove-last-street`, `remove-last-road-and-challenge`, `edit-road-debug-name`, `zero-all-challenge-scores` (5 scenarios)
- **VehicleList**: `baseline`, `edit-first-name`, `toggle-first-flags`, `swap-first-two`, `bulk-zero-colors`, `add-vehicle`, `remove-last-vehicle` (7 scenarios)
- **TriggerData**: `baseline`, `remove-last-landmark`, `remove-last-generic-region`, `remove-last-blackspot`, `remove-last-spawn-location`, `edit-first-landmark-id`, `zero-first-spawn-position`, `bulk-pop-every-array` (8 scenarios)
- **ChallengeList**: `baseline`, `remove-last-challenge`, `edit-first-challenge-title`, `zero-first-challenge-difficulty`, `zero-first-action-time-limit`, `duplicate-last-challenge` (6 scenarios)

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

### Limitations

- **No textures.** Materials resolve to ids but the texture pipeline
  (Material → TextureState → Texture, with DXT1/DXT5 swizzled mips) isn't
  implemented yet. Every mesh gets a flat `MeshStandardMaterial`.
- **No skinning.** BoneIndexes / BoneWeights vertex attributes are decoded
  but not used. The car renders in its bind pose.
- **CARBRWDS-tested only.** All locators in our sample have identity
  rotation; non-identity rotations are supported in the parser but unverified.
  Wheels in particular need testing on a different vehicle bundle.
- **No GraphicsSpec writer.** The viewer is read-only. Editing geometry or
  re-packing a vehicle bundle is out of scope.

## Architecture

### Handler registry

The core of the app is the **resource handler registry** at `src/lib/core/registry/`. Every resource type is represented by a single `ResourceHandler<Model>` object that bundles:

- `parseRaw(bytes, ctx)` — decode already-decompressed bytes into a typed model
- `writeRaw(model, ctx)` — re-encode the model (optional for read-only handlers)
- `describe(model)` — one-line CLI summary
- `fixtures` — pinned example bundles for regression testing
- `stressScenarios` — optional hand-curated mutation scenarios
- `fuzz.tolerateErrors` — optional regexes for writer-invariant rejections the CLI fuzzer should treat as expected

The registry is the single source of truth for which resources exist and how they behave. `src/lib/resourceTypes.ts`, `src/lib/capabilities.ts`, `src/context/BundleContext.tsx` state, `src/pages/ResourcesPage.tsx` NavLinks, and `src/App.tsx` routes are all **derived from the registry** — adding a new resource type requires editing exactly one new file in `registry/handlers/` plus one line in `registry/index.ts`.

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
  aiSections.ts        # parseRaw/writeRaw for AI Sections (byte-exact)
  streetData.ts        # parseRaw/writeRaw for StreetData
  triggerData.ts
  challengeList.ts
  vehicleList.ts
  playerCarColors.ts   # 32-bit only
  iceTakeDictionary.ts # read-only, partial
  renderable.ts        # read-only Renderable (0xC) + VertexDescriptor (0xA)
  graphicsSpec.ts      # read-only GraphicsSpec (0x10006) + Model (0x2A)
  binTools.ts          # BinReader / BinWriter primitives
  resourceManager.ts   # extractResourceData, compress/decompress
src/pages/
  RenderablePage.tsx   # three.js + react-three-fiber viewer
```

### Adding a new resource type

1. Write the binary parser and writer in `src/lib/core/<key>.ts` with `parse*Data(bytes)` and `write*Data(model)` functions. Use `BinReader` / `BinWriter` from `binTools.ts`.
2. Create `src/lib/core/registry/handlers/<key>.ts` exporting a `ResourceHandler<Model>`.
3. Add one import and one array entry in `src/lib/core/registry/index.ts`.
4. (If editable) add a lazy `<key>: lazy(() => import('@/pages/<Key>Page'))` entry in `registry/editors.ts` and drop a `src/pages/<Key>Page.tsx` that reads via `useBundle().getResource<T>(key)` and writes via `setResource(key, next)`.
5. (Optional) add a `HANDLER_META` entry in `src/lib/capabilities.ts` for notes and wiki URLs.

`types.ts`, `resourceTypes.ts`, `capabilities.ts` (except meta), `BundleContext.tsx`, `ResourcesPage.tsx`, and `App.tsx` are **never touched**.

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

- **More handler-level fuzz coverage** — the generic array walker only touches top-level arrays; nested per-entry arrays (road spans, junction exits, challenge actions) are still out of reach
- **Editor-side coverage for PlayerCarColours writes** — the writer is live and byte-exact, but the `ColorsPage` edit flow should grow explicit "add/remove color" affordances
- **Verify Renderable viewer on non-CARBRWDS vehicles** — every locator we've tested has identity rotation. Need a bundle where some part has a non-identity rotation (likely a wheel or a tilted spoiler) to confirm the `fromArray` matrix conversion is correct in the general case.
- **Wheels.** Wheel geometry isn't visibly distinct from body parts in our CARBRWDS sample. Need to confirm wheels come through the GraphicsSpec parts table on a vehicle that has visually obvious wheel geometry.


### Renderable viewer follow-ups

- **Texture decoding.** Material → TextureState → Texture chain resolves but textures aren't loaded. Needs a DXT1/DXT5 decoder with mip-swizzle handling, plus a way to feed the result into a `THREE.Texture`. Multi-day workstream — the DXT decode itself is well-known, but hooking up Material slots to the right shader uniforms (diffuse / normal / specular) requires reading the Material struct properly.
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

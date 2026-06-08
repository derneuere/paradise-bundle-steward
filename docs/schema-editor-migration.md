# Schema-editor architecture reference

How the schema-driven editor framework is wired, and how to add a new
resource to it. This guide was originally a set of "migrate the remaining
resource" prompts; that migration is now essentially complete, so it has
been converted into a structural reference. The per-resource sections at
the bottom are kept as historical notes on how each resource was wired.

## Status

The schema-driven editor framework lives at
`steward/src/components/schema-editor/` and `steward/src/lib/schema/`,
with per-resource wiring under `steward/src/lib/editor/`. Every
world/data resource is migrated — each has a schema (under
`src/lib/schema/resources/`) and an `EditorProfile` (under
`src/lib/editor/profiles/`), and most have extensions and/or a 3D overlay:

- **TrafficData** (type `0x10002`) — extensions wrapping 14 Phase 1/2
  tabs, custom `propertyGroups`, and a 3D overlay. Schema at
  `src/lib/schema/resources/trafficData.ts`, profile at
  `src/lib/editor/profiles/trafficData.ts`, extensions at
  `src/components/schema-editor/extensions/trafficDataExtensions.tsx`,
  overlay at `src/components/schema-editor/viewports/TrafficDataOverlay.tsx`.
- **PolygonSoupList** (type `0x43`) — schema-first migration with a
  dedicated 3D overlay batching 1.5M triangles, a resource picker, and
  `byResourceId` export support for bundles with hundreds of same-typed
  resources. Schema at `src/lib/schema/resources/polygonSoupList.ts`,
  page at `src/pages/PolygonSoupListPage.tsx`, overlay at
  `src/components/schema-editor/viewports/PolygonSoupListOverlay.tsx`.
- **AISections** (`0x10001`), **StreetData** (`0x10018`), **TriggerData**
  (`0x10003`), **ChallengeList** (`0x1001F`), **VehicleList** (`0x10005`),
  **PlayerCarColours** (`0x1001E`), **IceTakeDictionary** (`0x41`),
  **Renderable**, and **Texture** — all migrated (schema + EditorProfile;
  AISections, ChallengeList, Renderable, StreetData, TriggerData, and
  VehicleList also ship extensions).

TrafficData and PolygonSoupList are still the best-documented reference
implementations — read their schema + test before adding a new resource.

## Framework quick reference

- `src/lib/schema/types.ts` — field/record types. Kinds: `u8`/`u16`/`u32`/
  `i8`/`i16`/`i32`/`f32`/`bigint`/`bool`/`string`/`enum`/`flags`/`vec2`/
  `vec3`/`vec4`/`matrix44`/`ref`/`record`/`list`/`custom`. Also exports
  `defineProfile` for the per-resource `EditorProfile`.
- `src/lib/schema/walk.ts` — `getAtPath`, `updateAtPath`, `resolveSchemaAtPath`,
  `walkResource` (depth-first visitor). All immutable with structural sharing.
- `src/lib/editor/profiles/` — one `EditorProfile` per resource (and per
  layout variant, e.g. AISections v4/v6/v12). A profile binds a
  `ResourceSchema` to the resource and declares its overlay/extensions via
  the editor registry (`src/lib/editor/bindings.ts`, ADR-0008).
- `src/components/schema-editor/SchemaEditor.tsx` — 3-pane layout that
  just needs a `SchemaEditorProvider` above it.
- `src/components/schema-editor/context.tsx` — `SchemaEditorProvider` and
  `useSchemaEditor` hook. Holds selection + mutation + extension registry.
- `src/components/schema-editor/fields/FieldRenderer.tsx` — dispatches by
  field kind. Existing renderers cover everything in `types.ts`.
- `src/components/schema-editor/ViewportPane.tsx` — mounts the overlay
  resolved from the resource's `EditorProfile` (ADR-0008) via
  `pickRenderBinding` (`@/lib/editor/bindings`) inside a shared
  `<WorldViewport>`. `renderable` and `texture` are the only special-cased
  surfaces; every other resource flows through its profile's overlay. New
  viewports are registered as an overlay on the resource's `EditorProfile`
  under `src/lib/editor/profiles/`, **not** by editing `ViewportPane`.

## Adding a resource — recipe

Every resource follows these steps. Deviate only where the per-resource
notes below say so.

### 1. Schema declaration

Create `src/lib/schema/resources/<key>.ts` modeled after
`trafficData.ts`. It must:

- Import `FieldSchema`, `RecordSchema`, `ResourceSchema`, `SchemaContext`,
  `SchemaRegistry` from `../types`.
- Define small helpers (`const u8 = () => ({ kind: 'u8' })` etc.) — copy
  from `trafficData.ts` if short.
- Declare one `RecordSchema` per nested struct in the parser's types file.
  Every parsed field must be covered — no silent drops. Cross-reference
  against `src/lib/core/<key>.ts` and the docs in `docs/<name>.md` to
  confirm field count + types.
- Mark `_pad*`, `muSizeInBytes`, cached layout offsets, and anything the
  writer patches at write time as `hidden: true, readOnly: true` via
  `fieldMetadata`.
- Mark fields derived from array lengths (`muNum*`) as
  `readOnly: true, hidden: true, derivedFrom: 'arrayFieldName'`.
- Add `label: (value, index, ctx) => string` callbacks to every
  user-navigable record and list item — `#{index} · first-line-summary`
  is the baseline format. Include counts (verts/polys) or computed
  summaries where they help users find things.
- Optionally add `propertyGroups` on the root record to split the default
  form into tabs.
- Export the final `ResourceSchema` as `<key>ResourceSchema`:

  ```ts
  export const <key>ResourceSchema: ResourceSchema = {
    key: '<key>',           // must match the handler's key
    name: 'Human Name',
    rootType: '<RootRecordType>',
    registry,
  };
  ```

### 2. Round-trip test

Create `src/lib/schema/resources/<key>.test.ts` modeled after
`trafficData.test.ts` or `polygonSoupList.test.ts` (prefer the traffic
version for single-resource bundles, PSL for multi-resource). It must:

- Load an existing fixture from `example/`. Each resource already has one
  — check `src/lib/core/registry/handlers/<key>.ts` for the `fixtures`
  array.
- Parse it via the handler's `parseRaw`.
- **Coverage**: walk the parsed data with `walkResource` and assert no
  field is missing from the schema AND no schema field is missing from
  the parsed data. This is the single most valuable test — it catches
  every future drift.
- **Path resolution**: `resolveSchemaAtPath` on the root, a top-level
  primitive, a nested record, and a list-inside-list path. Verify the
  resolved field kinds match expectation.
- **Mutation**: `updateAtPath` a primitive two levels deep; assert the
  mutated top-level object is a new reference while siblings share
  references (structural sharing proof).
- **Byte round-trip**: `write(parsedModel)` must be sha1-identical to
  the fixture. Walking the tree read-only then writing must also be
  sha1-identical (walker doesn't mutate).
- **Labels**: spot-check each `label()` callback against real fixture data.

Run with `cd steward && eval "$(fnm env --shell=bash)" && fnm use 22 &&
node ./node_modules/vitest/vitest.mjs run src/lib/schema/resources/<key>.test.ts`.

### 3. EditorProfile + Workspace wiring

Generic schema-driven resources have **no** per-resource page and **no**
`/{key}` route. They are edited inside the Workspace editor
(`src/pages/WorkspacePage.tsx`, route `/workspace`) and surfaced by
registering an `EditorProfile` for them.

Create `src/lib/editor/profiles/<key>.ts` modeled after
`streetData.ts` (the minimal case) — bind the schema to the resource:

```ts
// src/lib/editor/profiles/<key>.ts
import { defineProfile } from '../types';
import type { Parsed<Name> } from '@/lib/core/<key>';
import { <key>ResourceSchema } from '@/lib/schema/resources/<key>';

export const <key>Profile = defineProfile<Parsed<Name>>({
  kind: 'default',
  displayName: 'Human Name',
  schema: <key>ResourceSchema,
});
```

For resources with multiple on-disk layout variants, declare one profile
per variant with a `matches` predicate (see `aiSections.ts`, which
registers `v4` / `v6` / `v12` profiles and uses `freezeSchema` for the
read-only prototype variants).

**Don't** add a `<Name>Page` or touch `src/App.tsx`. The `/workspace`
route already hosts every profile-registered resource. Only **bespoke**
editors (the ones in `EDITOR_PAGES` in `src/lib/core/registry/editors.ts`
— `attribSysVault`, `deformationSpec`, `renderable`, `texture`,
`polygonSoupList`, `shader`) get a per-resource page and an
auto-generated `/{key}` route in `App.tsx`.

### 4. Extension adapters (optional, for preserving existing tabs)

If the existing editor has a rich per-list UI (FlowTypesTab-style tables
with search, inline editing, reference badges), preserving it is usually
cheaper than reimplementing schema-first.

Create `src/components/schema-editor/extensions/<key>Extensions.tsx`
modeled after `trafficDataExtensions.tsx`:

- One `React.FC<SchemaExtensionProps>` adapter per tab that needs
  preserving.
- Root-level tabs take `{ data, setData }` and delegate to
  `<Tab data={data} onChange={setData} />`.
- Per-sub-list tabs extract an index from `path` (use
  `hullIndexFromPath`-style helpers) and forward to
  `<Tab data={...} hullIndex={...} onChange={setData} ... />`.
- Export a `<key>Extensions: ExtensionRegistry` object keyed by the
  string names used in the schema's `customRenderer` fields and
  `propertyGroups.component` references.

Then reference the extensions from the schema:

- In `recordList('TypeName', labelFn, 'TabName')` the third argument sets
  `customRenderer` on the list field.
- `propertyGroups: [{ title: 'X', component: 'TabName' }]` embeds an
  extension as a tab in the root form.

### 5. Viewport (optional, only if a 3D visualization exists)

If the resource needs a 3D viewport, register it as an **overlay** on the
resource's `EditorProfile`, not by branching in `ViewportPane.tsx` (only
`renderable` and `texture` are special-cased there; everything else flows
through `pickRenderBinding` + the profile overlay):

- Add the overlay component at
  `src/components/schema-editor/viewports/<Key>Overlay.tsx`, modeled after
  an existing overlay (`StreetDataOverlay.tsx`, `TriggerDataOverlay.tsx`,
  `TrafficDataOverlay.tsx`, `PolygonSoupListOverlay.tsx`,
  `ZoneListOverlay.tsx`, …). Overlays speak the shared `NodePath` contract
  (`data`, `selectedPath`, `onSelect`, `onChange`) and mount inside
  `<WorldViewport>`.
- Wire the overlay to the resource through the editor binding
  (`src/lib/editor/bindings.ts`) so `pickRenderBinding(resource.key, data)`
  resolves it. `ViewportPane` then mounts it automatically.
- If the overlay needs access to something outside the schema-editor
  context (multi-resource models, `loadedBundle`, selection callbacks),
  create a dedicated React context in the same viewports directory,
  modeled after `polygonSoupListContext.ts`.

### 6. Cleanup

Once the schema editor renders + round-trips + passes tests, delete the
old bespoke editor:

- Delete any old `<Name>Page.tsx` and its `EDITOR_PAGES` entry once the
  resource is edited in the Workspace via its profile.
- If the old page had a dedicated editor wrapper component
  (`<Name>Editor.tsx`) under `src/components/<key>/`, delete it after
  nothing imports it.
- Leave individual tab files if they're registered as extensions. Delete
  them only if the new schema-driven form fully replaces them.

## Verification checklist

Run in this order from `steward/`:

```bash
eval "$(fnm env --shell=bash)" && fnm use 22

# 1. Type check
node ./node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.app.json

# 2. Resource-specific schema test
node ./node_modules/vitest/vitest.mjs run src/lib/schema/resources/<key>.test.ts

# 3. Full test suite — must not regress
node ./node_modules/vitest/vitest.mjs run
```

Then verify in the browser:

- Preview server via `mcp__Claude_Preview__preview_start` (launch config
  `dev`).
- Load a fixture via `fetch('/@fs/...')` → `File` → dispatch `change` on
  the hidden file input.
- Navigate to `/workspace` via `history.pushState` + `popstate`.
- Confirm the hierarchy tree renders, the inspector shows the root
  record with the expected property groups, and at least one
  tree-driven navigation (click a list item, verify the inspector
  switches to that record) works.
- Edit a primitive, confirm the "Modified" badge lights up in the
  header.
- If relevant: click the `Export Bundle` button, intercept the download
  blob via a mocked `URL.createObjectURL`, verify the exported bundle
  starts with `bnd2` magic and has a reasonable size.

Don't submit until tsc is clean, the full suite passes, and at least the
"select → edit → Modified badge" round-trip works in the browser.

## Common pitfalls

Things hit during the traffic + PSL migrations that will save future
agents time:

1. **Count fields aren't array lengths.** `Section.muNumRungs` looks
   like a derived count but it's actually an offset into a hull-level
   pool. Only derive `parentHull.muNumSections` from `parentHull.sections.length`.
   When in doubt: check what the parser's reader does with the field.
2. **Parallel arrays must share a length.** `killZoneIds` and
   `killZones`, `vehicleTypes` and `vehicleTypesUpdate`, `coronaTypes`
   and `coronaPositions` — the writer validates these and throws. Your
   schema can't enforce it at the field level; document the coupling in
   the field's `description` and let custom renderers (or the user) keep
   them aligned.
3. **Fixed-size arrays vs variable-length lists.**
   `mauForwardHulls: u16[3]` is a fixed-length tuple —
   `fixedList(u16(), 3)`. `hullPvsSets` is variable-length —
   `recordList('PvsHullSet')`. A "fixed" list has
   `addable: false, removable: false, minLength === maxLength`.
4. **Vec3 vs vec4 vs record.** `{ x, y, z }` fields use `kind: 'vec3'`
   (a leaf with structured editing), NOT a nested record. Records are
   for things the tree should navigate INTO.
5. **u16 that reads signed.** PolygonSoup vertices are stored as u16
   but interpreted as i16 in world-space math. If your parser reads
   u16 for a signed field, the schema should still say `u16` to match
   binary layout, and the viewport/extension must handle sign extension
   in display code. Document this in the field's `description`.
6. **tabs + HMR state.** `useState(() => defaultTab)` captures the
   initial value once. After a navigation that changes the record type,
   use a `useEffect([record])` to reset the tab. InspectorPanel already
   does this — just be aware when copying the pattern.
7. **Schema labels throw sometimes.** Label callbacks run on every
   render. If a label reads `root.flowTypes[value.muFlowTypeId]` and the
   ref is stale, it'll throw and blow up the tree. Wrap label bodies in
   `try { ... } catch { return '#{index}'; }` or defensive chain
   (`root?.flowTypes?.[...]?.label`). The default helpers in
   `trafficData.ts` use optional chaining throughout.
8. **`example/` fixture availability.** The test infrastructure looks
   for fixtures by path. Check which ones are actually committed
   (`git ls-files example/`) before writing a test that depends on an
   untracked file. Commit the fixture if needed (reasonable size ≤ 15 MB).

---

# Per-resource notes (historical)

These sections describe how each resource was wired during the migration.
They are kept for reference; all of the resources below are now migrated
(schema + `EditorProfile`, most with extensions and/or a 3D overlay). Read
them alongside the actual schema/profile files, which are the ground truth.

---

## AISections (type `0x10001`)

**Handler key:** `aiSections`
**Type ID:** `0x10001`
**Parser:** `steward/src/lib/core/aiSections.ts`. It exports 3 enums
(`SectionSpeed`, `AISectionFlag`, `EResetSpeedType`), 9 local types, and
re-exports 4 `Legacy*` types from `aiSectionsLegacy.ts`. The parsed model
is a discriminated union over `kind`, with versioned roots
`ParsedAISectionsV4` / `ParsedAISectionsV6` / `ParsedAISectionsV12` (union
`ParsedAISections`). The schema is split into per-version files under
`src/lib/schema/resources/aiSections/{v4,v6,v12}.ts`, and the profile
(`src/lib/editor/profiles/aiSections.ts`) registers one variant per layout
(v4/v6 are frozen read-only via `freezeSchema`).

**Fixture:** `example/AI.DAT` (already committed).

**Spec doc:** `docs/AISections.md` at the repo root — binary layout
reference.

**Record types the schema covers:**
- `ParsedAISectionsV12` (retail root) — `version`, `sectionMinSpeeds[5]`,
  `sectionMaxSpeeds[5]`, `sections[]`, `sectionResetPairs[]`.
- `AISection` — `portals[]`, `noGoLines[]`, `corners[4]`, `id: u32`,
  `spanIndex: i16`, `speed: enum SectionSpeed`, `district: u8`,
  `flags: u8 (AISectionFlag)`.
- `Portal` — `position: Vector3` (three contiguous floats grouped into a
  swapped vec3), `boundaryLines[]`, `linkSection: u16`.
- `BoundaryLine` — `verts: vec4` (stores start + end as xy,zw pairs).
- `SectionResetPair` — `resetSpeed: enum EResetSpeedType`,
  `startSectionIndex: u16`, `resetSectionIndex: u16`.
- `Vector2` (`kind: 'vec2'`) for corners. (`Vector4` is an internal,
  non-exported alias — the vec4 lives inside `BoundaryLine.verts`.)

**Enums and flags** are in `src/lib/core/aiSections.ts` — `SectionSpeed`,
`AISectionFlag`, `EResetSpeedType`. They map to schema `enum` / `flags`
fields with user-friendly labels pulled from
`components/aisections/constants.ts`.

**Tree-label suggestions:**
- `sections[i]` → `"#{i} · 0x{id:hex} · {speed-label}"`
- `sectionResetPairs[i]` → `"#{i} · {reset-speed-label} · {start}→{reset}"`
- `portals[p]` inside a section → `"Portal {p} · →#{linkSection}"`

**Gotchas specific to AISections:**
- `BoundaryLine.verts` is a Vec4 that actually packs two 2D points
  (startX, startY, endX, endY). Default rendering as `x, y, z, w` is
  fine but the field description should call out the semantics.
- `AISection.corners` is always 4 in retail — use `fixedList(vec2(), 4)`.
- `spanIndex: i16` — signed. -1 means "no span".
- `district: u8` — always 0 in retail, but preserve the field.
- `EResetSpeedType` has 21 values — use the `RESET_SPEED_LABELS` constant
  as the source of truth.

**Verification:** the `example/AI.DAT` parse→write cycle must remain
sha1-identical (the existing `src/lib/core/registry/registry.test.ts`
already checks this via stress scenarios).

---

## StreetData (type `0x10018`)

**Handler key:** `streetData`
**Type ID:** `0x10018`
**Parser:** `steward/src/lib/core/streetData.ts` (9 exported types,
~2000 LOC — one of the more complex parsers)
**Schema:** `src/lib/schema/resources/streetData.ts`
(`streetDataResourceSchema`)
**Profile:** `src/lib/editor/profiles/streetData.ts`
**Extensions:** `src/components/schema-editor/extensions/streetDataExtensions.tsx`
**Overlay:** `src/components/schema-editor/viewports/StreetDataOverlay.tsx`

**Fixture:** `example/BTTSTREETDATA.DAT` (already committed).

**Spec doc:** `docs/StreetData.md` at the repo root.

**Context:** There's an upstream PR (BurnoutHints/Bundle-Manager#25) about
StreetData round-trip bugs. Check
`steward/src/lib/core/registry/handlers/streetData.ts` for stress
scenarios that document the known-good mutations. The domain logic around
spans / intersections / landmarks is nontrivial, so the editor keeps the
existing components as extensions rather than a clever schema-driven form.

**Record types the schema covers** (cross-reference `streetData.ts`):
every `export type` in the parser file. Count: 9. `walkResource`
coverage passes for a real bundle.

**Tree-label suggestions:**
- List items in the tree carry a computed summary (`spans[i]`,
  `intersections[i]`, etc.).

**Gotchas:**
- **Round-trip fidelity is critical here.** The schema round-trip test
  includes a byte-exact sha1 check against `example/BTTSTREETDATA.DAT`,
  and the stress scenarios in `registry/handlers/streetData.ts` must
  still pass.
- Some fields are "opaque" (the C# reference tool doesn't know their
  semantics either) — they carry a `description: 'Opaque — semantics TBD
  on the wiki'` rather than invented labels.

---

## TriggerData (type `0x10003`)

**Handler key:** `triggerData`
**Type ID:** `0x10003`
**Parser:** `steward/src/lib/core/triggerData.ts` — exports 12 `type`
declarations (the base `TriggerRegion` is intentionally not exported),
plus several enums and `const …Schema` validators. Triggers come in
several shapes (box, sphere, …), handled via custom renderers /
discriminated unions.
**Schema:** `src/lib/schema/resources/triggerData.ts`
**Profile:** `src/lib/editor/profiles/triggerData.ts`
**Extensions:** `src/components/schema-editor/extensions/triggerDataExtensions.tsx`
**Overlay:** `src/components/schema-editor/viewports/TriggerDataOverlay.tsx`

**Fixture:** `example/TRIGGERS.DAT` (already committed).

**Spec doc:** `docs/TriggerData.md` at the repo root.

**Migration approach:** Extensions-first. The existing per-category tabs
(landmarks, triggers, challenges, drive-thrus, generic regions,
killzones, …) are the canonical UX, preserved via `customRenderer`. The
schema's main job is navigation (tree drill-down) + simple primitive
editing in the inspector.

**Tree labels:**
- `landmarks[i]` → `"#{i} · {name or id} · {position}"`
- `triggers[i]` → `"#{i} · {kind} · {position}"`

**Gotchas:**
- The drive-thru list has a fixed-size reservation (46 in v1.0, 53 in
  v1.9 / Remastered). Exceeding it crashes the game. A `validate`
  callback on the drive-thru list emits an error-severity
  `ValidationResult` when the length exceeds the platform's limit.
- The docs at `docs/TriggerData.md` have TODOs on many fields — the
  schema mirrors the parser rather than inventing semantics.
- `triggerData` tends to have the most bugs in round-trip — run the full
  stress-scenario suite frequently while iterating.

---

## ChallengeList (type `0x1001F`)

**Handler key:** `challengeList`
**Type ID:** `0x1001F`
**Parser:** `steward/src/lib/core/challengeList.ts` (7 exported types)
**Schema:** `src/lib/schema/resources/challengeList.ts`
**Profile:** `src/lib/editor/profiles/challengeList.ts`
**Extensions:** `src/components/schema-editor/extensions/challengeListExtensions.tsx`

Note the existing component directory is misspelled
(`src/components/challangelist/`, not `challengelist`). Keep the spelling.

**Fixture:** `example/ONLINECHALLENGES.BNDL` (already committed).

**Spec doc:** `docs/ChallengeList.md`.

**Record types:** 7 — challenges come in multiple types (billboards,
smashes, jumps, drive-thrus, super-jumps, …). Each has its own payload
shape. A classic polymorphic-record case, handled with a challenge-type
discriminator + per-type detail form preserved via `customRenderer`.

**Tree labels:**
- `challenges[i]` → `"#{i} · {type-label} · {name or id}"` where
  `type-label` is `'Billboard' / 'Smash' / 'Drive-thru' / …`.

**No 3D viewport.**

**Gotchas:**
- Challenge IDs are hashes; display as hex.
- The challenge type field is a discriminator — `enum` with every known
  type code. Unknown types don't crash the editor; the default `enum`
  renderer handles unknown values.

---

## VehicleList (type `0x10005`)

**Handler key:** `vehicleList`
**Type ID:** `0x10005`
**Parser:** `steward/src/lib/core/vehicleList.ts` (4 exported types —
small)
**Schema:** `src/lib/schema/resources/vehicleList.ts`
**Profile:** `src/lib/editor/profiles/vehicleList.ts`
**Extensions:** `src/components/schema-editor/extensions/vehicleListExtensions.tsx`

**Fixture:** `example/VEHICLELIST.BUNDLE` (already committed).

**Spec doc:** `docs/VehicleList.md`.

**Record types:** 4. The root has a header + a `vehicles: VehicleEntry[]`
list. VehicleEntry is rich — ~40 fields covering GameDB IDs, vehicle
class, handling parameters, boost flags, etc.

**Migration approach:** Schema-first with one extension. The per-vehicle
detail UI is preserved as a custom renderer on the `vehicles` list; the
old list page was dropped in favor of tree navigation. (The pre-migration
`/vehicleList/:id` nested route, `VehicleEditorPage.tsx`, and
`VehiclesPage.tsx` no longer exist — VehicleList is now edited in the
Workspace via its profile.)

**Tree labels:**
- `vehicles[i]` → `"#{i} · {vehicle-id-hex} · {class-label}"` where
  `class-label` comes from the vehicle class enum.

**No 3D viewport.**

**Gotchas:**
- GameDB IDs are u64. Use `bigint` with `hex: true` for display.
- Vehicle flags + boost flags are u32 bitmasks — use `flags` with bit
  labels pulled from the existing editor's constants.

---

## PlayerCarColours (type `0x1001E`)

**Handler key:** `playerCarColours`
**Type ID:** `0x1001E`
**Parser:** `steward/src/lib/core/playerCarColors.ts` (3 exported types —
tiny)
**Schema:** `src/lib/schema/resources/playerCarColours.ts`
**Profile:** `src/lib/editor/profiles/playerCarColours.ts`

**Fixture:** check `src/lib/core/registry/handlers/playerCarColors.ts` for
the `fixtures` array.

**Record types:** 3 — root with a `colors: ColorEntry[]` list + maybe a
header. Each entry is a color quad + some metadata.

**Migration approach:** Schema-first only. The default field renderers
(Vec4 + string) cover everything; no extensions needed unless a
swatch-grid UI is wanted, in which case `PlayerCarColours.tsx` can be
preserved as a `customRenderer` on the colors list.

**Tree labels:**
- `colors[i]` → `"#{i} · #{hex} · {name}"` where `hex` is the RGB
  converted from the 0.0–1.0 float channels.

**No 3D viewport.**

**Gotchas:**
- Colors are stored as Vec4 (RGBA 0.0–1.0). The default `vec4` field
  renderer shows 4 numeric inputs.

---

## IceTakeDictionary (type `0x41`)

**Handler key:** `iceTakeDictionary`
**Type ID:** `0x41`
**Parser:** `steward/src/lib/core/iceTakeDictionary.ts` (3 exported types)
**Schema:** `src/lib/schema/resources/iceTakeDictionary.ts`
**Profile:** `src/lib/editor/profiles/iceTakeDictionary.ts`

**Fixture:** `example/CAMERAS.BUNDLE` (already committed).

**Spec doc:** `docs/ICETakeDictionary.md`.

**Record types:** 3 — root with a list of camera "takes", each with a
few fields (position, rotation, duration, target, etc.).

**Migration approach:** Schema-first only — small, simple, default
renderers do the job.

**Tree labels:**
- `takes[i]` → `"#{i} · {name or id} · {duration}s"`

**No 3D viewport** (cameras are spatial data, so one would be nice — a
later add if the user asks).

---

## Renderable (world geometry, complex)

**Handler key:** `renderable`
**Type ID:** `RENDERABLE_TYPE_ID` — check
`src/lib/core/registry/handlers/renderable.ts` for the numeric value.
**Parser:** `steward/src/lib/core/renderable.ts` (8 exported types)
**Page:** `src/pages/RenderablePage.tsx` — **the 3D model viewer is the
main user-facing value of the resource.** Renderable is a bespoke editor
(it has an `EDITOR_PAGES` entry and a `/renderable` route).
**Extensions:** `src/components/schema-editor/extensions/renderableExtensions.tsx`

**Spec doc:** `docs/Renderable.md` + `docs/Renderable_findings.md` +
`docs/Renderable_PC.md` + `docs/VertexDescriptor.md`.

**Record types:** 8 — mesh data, materials, vertex descriptors, etc.

**Migration approach:** Extensions-first with a preserved 3D viewer. The
schema editor lets users inspect mesh / material / vertex descriptor
metadata in the right sidebar while the 3D viewer fills the center pane.

**3D viewport:** `RenderableViewport` is special-cased in `ViewportPane.tsx`
(`resource.key === 'renderable'`) — it runs a full three.js scene driven
by `RenderableDecodedProvider`.

**Tree labels:**
- `meshes[i]` → `"Mesh {i} · {material-name} · {N} tris"`
- `materials[i]` → `"Mat {i} · {shader-name}"`

**Gotchas:**
- Vertex data is bulk binary — mark as hidden in the schema, surface
  summary stats (count, stride, descriptor) instead.
- Materials reference textures via hash IDs — use `ref` targets when
  possible, or fall back to hex-display `bigint` fields.
- Some bundles have BROKEN renderables that the parser tolerates with
  warnings. The schema tolerates them too — don't throw in label
  callbacks on missing data.

---

## Texture (type `TEXTURE_TYPE_ID`)

**Handler key:** `texture`
**Type ID:** `TEXTURE_TYPE_ID` — check
`src/lib/core/registry/handlers/texture.ts` for the numeric value.
**Parser:** `steward/src/lib/core/texture.ts` (3 exported types)
**Page:** `src/pages/TexturePage.tsx` — 2D texture previewer. Texture is a
bespoke editor (it has an `EDITOR_PAGES` entry and a `/texture` route).

**Spec docs:** `docs/Texture_PC.md`, `docs/Texture_Remastered.md`.

**Record types:** 3 — header metadata (format, width, height, mip
count, flags) + the pixel data blob.

**Migration approach:** Schema-first with a 2D preview. The header fields
are trivially schema-driven (enums for format, u16 for width/height,
flags for texture flags). The pixel data is NOT editable through the
schema — it's `hidden`, and `TextureViewport` (special-cased in
`ViewportPane.tsx` as `resource.key === 'texture'`) renders the 2D preview
from `TextureContext`.

**Tree labels:**
- Texture is usually a single record per bundle, so the tree is
  minimal. No special label logic needed.

**Gotchas:**
- Pixel data is potentially megabytes. Don't include it in the schema
  walker's default visiting — tag it with some "opaque blob" marker.
- Texture format enum has many values (DXT1, DXT3, DXT5, ARGB8888, …)
  — grab the list from the existing decoder.

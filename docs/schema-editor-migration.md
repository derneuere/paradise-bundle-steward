# Schema-editor migration prompts

Prompts for migrating the remaining bundle resources to the schema-driven
editor framework. Copy the relevant section into a fresh agent session —
each per-resource prompt is self-contained and inherits the shared recipe
at the top.

## Context

There's a schema-driven editor framework at
`steward/src/components/schema-editor/` and `steward/src/lib/schema/`.
Two resources are already migrated as reference implementations:

- **TrafficData** (type `0x10002`) — full migration with extensions wrapping
  14 Phase 1/2 tabs, custom `propertyGroups`, and a 3D viewport shim.
  Schema at `src/lib/schema/resources/trafficData.ts`, page at
  `src/pages/TrafficDataPage.tsx`, extensions at
  `src/components/schema-editor/extensions/trafficDataExtensions.tsx`.
- **PolygonSoupList** (type `0x43`) — schema-first migration with a
  dedicated 3D viewport batching 1.5M triangles, a page-level resource
  picker, and `byResourceId` export support for bundles with hundreds of
  same-typed resources. Schema at `src/lib/schema/resources/polygonSoupList.ts`,
  page at `src/pages/PolygonSoupListPage.tsx`, viewport at
  `src/components/schema-editor/viewports/PolygonSoupListViewport.tsx`.

Read these before starting. Both pages + both schemas + both tests are
the ground truth for the patterns below.

## Framework quick reference

- `src/lib/schema/types.ts` — field/record types. Kinds: `u8`/`u16`/`u32`/
  `i8`/`i16`/`i32`/`f32`/`bigint`/`bool`/`string`/`enum`/`flags`/`vec2`/
  `vec3`/`vec4`/`matrix44`/`ref`/`record`/`list`/`custom`.
- `src/lib/schema/walk.ts` — `getAtPath`, `updateAtPath`, `resolveSchemaAtPath`,
  `walkResource` (depth-first visitor). All immutable with structural sharing.
- `src/components/schema-editor/SchemaEditor.tsx` — 3-pane layout that
  just needs a `SchemaEditorProvider` above it.
- `src/components/schema-editor/context.tsx` — `SchemaEditorProvider` and
  `useSchemaEditor` hook. Holds selection + mutation + extension registry.
- `src/components/schema-editor/fields/FieldRenderer.tsx` — dispatches by
  field kind. Existing renderers cover everything in `types.ts`.
- `src/components/schema-editor/ViewportPane.tsx` — dispatches by
  `resource.key`. Add new viewports here.

## Shared recipe

Every migration follows these steps. Deviate only where the per-resource
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

### 3. Page wiring

For a single-resource bundle (most types), replace the existing page:

```tsx
// src/pages/<Name>Page.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { <key>ResourceSchema } from '@/lib/schema/resources/<key>';
import { <key>Extensions } from '@/components/schema-editor/extensions/<key>Extensions';
import type { Parsed<Name> } from '@/lib/core/<key>';

const <Name>Page = () => {
  const { getResource, setResource } = useBundle();
  const data = getResource<Parsed<Name>>('<key>');
  if (!data) {
    return (
      <Card>
        <CardHeader><CardTitle><Human Name></CardTitle></CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Load a bundle containing <key> to begin.
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="h-full min-h-0">
      <SchemaEditorProvider
        resource={<key>ResourceSchema}
        data={data}
        onChange={(next) => setResource('<key>', next as Parsed<Name>)}
        extensions={<key>Extensions}
      >
        <SchemaEditor />
      </SchemaEditorProvider>
    </div>
  );
};

export default <Name>Page;
```

For a multi-resource bundle (only relevant if a bundle can hold N of the
same type, like PolygonSoupList), model after `PolygonSoupListPage.tsx`
with a resource picker + `setResourceAt`.

**Don't** touch `src/App.tsx` — the registry-driven `/{key}` route is
auto-generated from `src/lib/core/registry/editors.ts` which already
points at `src/pages/<Name>Page.tsx`.

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

If the existing page has a 3D viewport that should be preserved or
rebuilt:

- Add a new file at
  `src/components/schema-editor/viewports/<Key>Viewport.tsx`.
- Add a branch in `src/components/schema-editor/ViewportPane.tsx` that
  checks `resource.key === '<key>'` and renders your viewport.
- If the viewport needs access to something outside the schema-editor
  context (multi-resource models, `loadedBundle`, selection callbacks),
  create a dedicated React context in the same viewports directory,
  modeled after `polygonSoupListContext.ts`, and have the page wrap the
  `SchemaEditorProvider` in the context provider.

For simple cases that just visualize the currently-edited single resource,
consume `useSchemaEditor()` directly inside the viewport — no extra
context needed.

### 6. Cleanup

Once the schema editor renders + round-trips + passes tests, delete the
old files:

- The old page is already pointed at by `editors.ts` — rename-in-place
  (the file path stays, only the contents change).
- If the old page had a dedicated editor wrapper component
  (`<Name>Editor.tsx`) under `src/components/<key>/`, delete it after
  the new page stops importing it.
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
- Navigate to `/{key}` via `history.pushState` + `popstate`.
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

Things I hit during the traffic + PSL migrations that will save future
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

# Per-resource prompts

Copy the full section into an agent session. Each is self-contained and
references the shared recipe + context above by path.

---

## AISections (type `0x10001`)

Migrate the AISections resource to the schema-driven editor framework.

**Background:** Read
`steward/docs/schema-editor-migration.md` for the full migration recipe,
the framework quick reference, and the two reference implementations
(TrafficData + PolygonSoupList). Do not skip this — it has ~8 common
pitfalls that will bite you.

**Handler key:** `aiSections`
**Type ID:** `0x10001`
**Parser:** `steward/src/lib/core/aiSections.ts` (7 exported types)
**Existing editor:**
- `steward/src/pages/AISectionsPage.tsx`
- `steward/src/components/aisections/AISectionsEditor.tsx` — tab bar with Overview / Sections / Reset Pairs
- `steward/src/components/aisections/AISectionsViewport.tsx` — 3D viewport
- `steward/src/components/aisections/SectionsList.tsx` — virtualized section table
- `steward/src/components/aisections/SectionDetailDialog.tsx` — per-section detail editor with Portals / NoGo Lines / Corners sub-tabs
- `steward/src/components/aisections/AddSectionDialog.tsx` — add modal
- `steward/src/components/aisections/constants.ts` — `SPEED_LABELS`, `FLAG_NAMES`, `RESET_SPEED_LABELS`

**Fixture:** `example/AI.DAT` (already committed).

**Spec doc:** `docs/AISections.md` at the repo root — binary layout
reference.

**Record types the schema must cover:**
- `ParsedAISections` (root) — `version`, `sectionMinSpeeds[5]`, `sectionMaxSpeeds[5]`, `sections[]`, `sectionResetPairs[]`.
- `AISection` — `portals[]`, `noGoLines[]`, `corners[4]`, `id: u32`, `spanIndex: i16`, `speed: enum SectionSpeed`, `district: u8`, `flags: u8 (AISectionFlag)`.
- `Portal` — `positionX/Y/Z: f32`, `boundaryLines[]`, `linkSection: u16`.
- `BoundaryLine` — `verts: vec4` (stores start + end as xy,zw pairs).
- `SectionResetPair` — `resetSpeed: enum EResetSpeedType`, `startSectionIndex: u16`, `resetSectionIndex: u16`.
- `Vector2`, `Vector4` as structured primitives (kind: 'vec2' / 'vec4').

**Enums and flags** are in `src/lib/core/aiSections.ts` — `SectionSpeed`,
`AISectionFlag`, `EResetSpeedType`. Translate them into schema
`enum` / `flags` fields with user-friendly labels pulled from
`components/aisections/constants.ts`.

**Migration approach:** Extensions-first. Preserve the existing tabs as
custom renderers:
- `AISectionsOverview` → propertyGroup `component` on root (speed limits table + flag distribution)
- `SectionsList` → `customRenderer` on the `sections` list field
- `SectionDetailDialog` contents → `propertyGroups` on `AISection` with
  titles "Identity", "Portals", "NoGo Lines", "Corners"
- Reset pairs table → `customRenderer` on `sectionResetPairs`, OR a
  simple `propertyGroups` tab on root (it's small enough that the
  default schema form works)

**3D viewport:** `AISectionsViewport` exists. Wire it into
`ViewportPane.tsx` by adding a branch for `resource.key === 'aiSections'`.
The existing viewport takes `data`, `selected`, `onChange`,
`onSelect` — adapt the same way `TrafficDataViewportShim` does in
`ViewportPane.tsx`.

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

**Verification:** per shared checklist. Additionally, the
`example/AI.DAT` parse→write cycle must remain sha1-identical (the
existing `src/lib/core/registry/registry.test.ts` already checks this
via stress scenarios — your change should not break it).

---

## StreetData (type `0x10018`)

Migrate the StreetData resource to the schema-driven editor framework.

**Background:** Read
`steward/docs/schema-editor-migration.md` first.

**Handler key:** `streetData`
**Type ID:** `0x10018`
**Parser:** `steward/src/lib/core/streetData.ts` (9 exported types,
~2000 LOC — this is one of the more complex parsers)
**Existing editor:**
- `steward/src/pages/StreetDataPage.tsx`
- `steward/src/components/streetdata/` — full directory with editor,
  viewport, and per-section tabs. Inspect what's there before planning.

**Fixture:** `example/BTTSTREETDATA.DAT` (already committed).

**Spec doc:** `docs/StreetData.md` at the repo root.

**Context:** There's an in-flight PR on the upstream repo
(BurnoutHints/Bundle-Manager#25) about StreetData round-trip bugs. Check
`steward/src/lib/core/registry/handlers/streetData.ts` for stress
scenarios that document the known-good mutations. Prefer keeping the
existing editor components as extensions rather than rewriting — the
domain logic around spans / intersections / landmarks is nontrivial.

**Record types the schema must cover** (cross-reference `streetData.ts`):
every `export type` in the parser file. Count: 9. Do not ship until
`walkResource` coverage passes for a real bundle.

**Migration approach:** Extensions-first. This is the migration with the
highest risk of breaking user-facing behavior because the domain is
complex and the user is actively working on it. Prefer minimal schema
coverage + full-tab extensions over clever schema-driven forms.

**3D viewport:** Exists. Keep it as-is via a `ViewportPane` branch.

**Tree-label suggestions:**
- List items in the tree should carry a computed summary
  (`spans[i]`, `intersections[i]`, etc.). Spec out each list's label
  format before coding — a 2-minute design pass here saves 10 minutes of
  trial-and-error.

**Gotchas:**
- **Round-trip fidelity is critical here.** The user cares about this
  specifically. Every schema round-trip test MUST include a byte-exact
  sha1 check against `example/BTTSTREETDATA.DAT`, and the stress
  scenarios in `registry/handlers/streetData.ts` MUST still pass.
- The user has a PR in flight — if you see `// TODO` comments or
  missing fields in the parser, don't try to fix them. Mirror the
  parser's exact shape.
- Some fields are "opaque" (the C# reference tool doesn't know their
  semantics either). Give them `description: 'Opaque — semantics TBD on
  the wiki'` rather than inventing labels.

**Verification:** per shared checklist. Plus: `example/BTTSTREETDATA.DAT`
parse→walk→write must be sha1-identical after your changes.

---

## TriggerData (type `0x10003`)

Migrate the TriggerData resource to the schema-driven editor framework.

**Background:** Read
`steward/docs/schema-editor-migration.md` first.

**Handler key:** `triggerData`
**Type ID:** `0x10003`
**Parser:** `steward/src/lib/core/triggerData.ts` (13 exported types —
this has the LARGEST schema of any remaining resource)
**Existing editor:**
- `steward/src/pages/TriggerDataPage.tsx`
- `steward/src/components/triggerdata/` — full directory including
  viewport. Expect many per-category tabs (landmarks, triggers,
  challenges, drive-thrus, generic regions, killzones, …).

**Fixture:** `example/TRIGGERS.DAT` (already committed).

**Spec doc:** `docs/TriggerData.md` at the repo root.

**Record types:** 13 — walk `triggerData.ts` and cover each. Triggers
come in several shapes (box, sphere, …) so the schema may need
discriminated unions handled via custom renderers.

**Migration approach:** Extensions-first. The existing per-category tabs
are the canonical UX — preserve them via `customRenderer`. The schema's
main job is navigation (tree drill-down) + simple primitive editing in
the inspector.

**3D viewport:** Exists. Wire into `ViewportPane.tsx`.

**Tree labels:**
- `landmarks[i]` → `"#{i} · {name or id} · {position}"`
- `triggers[i]` → `"#{i} · {kind} · {position}"`
- Use the resource's naming convention — landmarks often have
  game-script names worth surfacing.

**Gotchas:**
- The drive-thru list has a fixed-size reservation (46 in v1.0, 53 in
  v1.9 / Remastered). Exceeding it crashes the game. Add this as a
  `validate` callback on the drive-thru list that emits an error-
  severity `ValidationResult` when the length exceeds the platform's
  limit.
- The docs at `docs/TriggerData.md` have TODOs on many fields. Same rule
  as StreetData: mirror the parser, don't invent semantics.
- `triggerData` tends to have the most bugs in round-trip — run the full
  stress-scenario suite frequently while iterating.

**Verification:** per shared checklist.

---

## ChallengeList (type `0x1001F`)

Migrate the ChallengeList resource to the schema-driven editor framework.

**Background:** Read
`steward/docs/schema-editor-migration.md` first.

**Handler key:** `challengeList`
**Type ID:** `0x1001F`
**Parser:** `steward/src/lib/core/challengeList.ts` (7 exported types)
**Existing editor:**
- `steward/src/pages/ChallengeListPage.tsx`
- `steward/src/components/challangelist/` — note the misspelled
  directory name (`challangelist` not `challengelist`). Keep the
  existing spelling.

**Fixture:** `example/ONLINECHALLENGES.BNDL` (already committed).

**Spec doc:** `docs/ChallengeList.md`.

**Record types:** 7 — challenges come in multiple types (billboards,
smashes, jumps, drive-thrus, super-jumps, …). Each has its own payload
shape. This is a classic polymorphic-record case.

**Migration approach:** Extensions-first. The challenge-type dropdown +
per-type detail form in the existing editor is the right UX — preserve
it via `customRenderer`. The schema describes the common header fields;
the per-type details are handled by the custom renderer.

**Tree labels:**
- `challenges[i]` → `"#{i} · {type-label} · {name or id}"` where
  `type-label` is `'Billboard' / 'Smash' / 'Drive-thru' / …`.
- Define a type-code → label map at the top of the schema file.

**No 3D viewport.** Don't add one.

**Gotchas:**
- Challenge IDs are hashes; display as hex.
- The challenge type field is a discriminator — schema should mark it
  `enum` with every known type code. Unknown types should not crash the
  editor; the default renderer for `enum` handles unknown values.

**Verification:** per shared checklist.

---

## VehicleList (type `0x10005`)

Migrate the VehicleList resource to the schema-driven editor framework.

**Background:** Read
`steward/docs/schema-editor-migration.md` first.

**Handler key:** `vehicleList`
**Type ID:** `0x10005`
**Parser:** `steward/src/lib/core/vehicleList.ts` (4 exported types —
small)
**Existing editor:**
- `steward/src/pages/VehiclesPage.tsx` — list view
- `steward/src/pages/VehicleEditorPage.tsx` — per-vehicle detail view at
  `/vehicleList/:id`
- `steward/src/components/VehicleList.tsx`, `VehicleEditor.tsx`,
  `VehicleCard/` — existing list + detail components

**Fixture:** `example/VEHICLELIST.BUNDLE` (already committed).

**Spec doc:** `docs/VehicleList.md`.

**Record types:** 4. The root has a header + a `vehicles: VehicleEntry[]`
list. VehicleEntry is rich — ~40 fields covering GameDB IDs, vehicle
class, handling parameters, boost flags, etc.

**Migration approach:** **Schema-first with one extension**. The
existing per-vehicle `VehicleEditor` is worth preserving as a custom
renderer on the `vehicles` list, but the list page itself (`VehiclesPage`)
can be replaced entirely by the tree navigation.

**Routing wrinkle:** `App.tsx` currently has a hardcoded
`/vehicleList/:id` nested route. After migration:
- Delete `src/pages/VehicleEditorPage.tsx` and the `/vehicleList/:id`
  route in `App.tsx`.
- Delete `src/pages/VehiclesPage.tsx` (replaced by schema-driven tree).
- The registry-generated `/vehicleList` route now points at a new page
  wired like the recipe shows.
- Selecting a vehicle in the tree drills into the per-vehicle detail
  view in the inspector. The `VehicleEditor` component becomes a
  `customRenderer` on... hmm, actually vehicles are records in a list,
  so you'd register it as a `propertyGroups.component` on the
  `VehicleEntry` record schema, or as a custom renderer for the entire
  record.

  See `TrafficDataExtensions` for the pattern.

**Tree labels:**
- `vehicles[i]` → `"#{i} · {vehicle-id-hex} · {class-label}"` where
  `class-label` comes from the vehicle class enum.

**No 3D viewport.** The existing 3D vehicle viewer (if any) lives in
`VehicleCard/`; decide case-by-case whether to preserve it as an
extension.

**Gotchas:**
- GameDB IDs are u64. Use `bigint` with `hex: true` for display.
- Vehicle flags + boost flags are u32 bitmasks — use `flags` with bit
  labels pulled from the existing editor's constants.

**Verification:** per shared checklist. Specifically: load
`example/VEHICLELIST.BUNDLE`, navigate to `/vehicleList`, expand the
vehicles list in the tree, click a vehicle, verify the per-vehicle
form renders.

---

## PlayerCarColours (type `0x1001E`)

Migrate the PlayerCarColours resource to the schema-driven editor framework.

**Background:** Read
`steward/docs/schema-editor-migration.md` first.

**Handler key:** `playerCarColours`
**Type ID:** `0x1001E`
**Parser:** `steward/src/lib/core/playerCarColors.ts` (3 exported types —
tiny)
**Existing editor:**
- `steward/src/pages/ColorsPage.tsx`
- `steward/src/components/PlayerCarColours.tsx`

**Fixture:** there may not be a dedicated small fixture. Check
`src/lib/core/registry/handlers/playerCarColors.ts` for `fixtures` and
use what's listed.

**Record types:** 3 — root with a `colors: ColorEntry[]` list + maybe a
header. Each entry is a color quad + some metadata.

**Migration approach:** **Schema-first only**. This is a perfect
candidate for pure schema-driven because the existing editor is
small and the default field renderers (Vec4 + string) cover
everything. No extensions needed unless you want a swatch-grid UI, in
which case preserve `PlayerCarColours.tsx` as a `customRenderer` on the
colors list.

**Tree labels:**
- `colors[i]` → `"#{i} · #{hex} · {name}"` where `hex` is the
  RGB converted from the 0.0–1.0 float channels.

**No 3D viewport.**

**Gotchas:**
- Colors are stored as Vec4 (RGBA 0.0–1.0). The default `vec4` field
  renderer shows 4 numeric inputs. If the existing editor has a color
  swatch UI, preserving it as an extension is worthwhile.

**Verification:** per shared checklist. The schema test can be trivial
(the parser is small) but MUST include the coverage walk + sha1
round-trip assertion.

---

## IceTakeDictionary (type `0x41`)

Migrate the IceTakeDictionary resource to the schema-driven editor framework.

**Background:** Read
`steward/docs/schema-editor-migration.md` first.

**Handler key:** `iceTakeDictionary`
**Type ID:** `0x41`
**Parser:** `steward/src/lib/core/iceTakeDictionary.ts` (3 exported types)
**Existing editor:**
- `steward/src/pages/IcePage.tsx`
- `steward/src/components/IceTakeDictionary.tsx`

**Fixture:** `example/CAMERAS.BUNDLE` (already committed).

**Spec doc:** `docs/ICETakeDictionary.md`.

**Record types:** 3 — root with a list of camera "takes", each with a
few fields (position, rotation, duration, target, etc.).

**Migration approach:** **Schema-first only**. Same logic as
PlayerCarColours — small, simple, default renderers do the job.

**Tree labels:**
- `takes[i]` → `"#{i} · {name or id} · {duration}s"`

**No 3D viewport** (though one would be nice — cameras are spatial
data. Skip for the first pass; add later if the user asks).

**Verification:** per shared checklist.

---

## Renderable (world geometry, complex)

Migrate the Renderable resource to the schema-driven editor framework.

**Background:** Read
`steward/docs/schema-editor-migration.md` first.

**Handler key:** `renderable`
**Type ID:** `RENDERABLE_TYPE_ID` — check
`src/lib/core/registry/handlers/renderable.ts` for the numeric value.
**Parser:** `steward/src/lib/core/renderable.ts` (8 exported types)
**Existing editor:**
- `steward/src/pages/RenderablePage.tsx` — **this is the 3D model viewer
  and is the main user-facing value of the resource**.

**Spec doc:** `docs/Renderable.md` + `docs/Renderable_findings.md` +
`docs/Renderable_PC.md` + `docs/VertexDescriptor.md`.

**Record types:** 8 — mesh data, materials, vertex descriptors, etc.

**Migration approach:** **Extensions-first with a preserved 3D viewer**.
The existing RenderablePage's strength is the 3D visualization — treat
that as the primary experience. The schema editor's job is to let users
inspect mesh / material / vertex descriptor metadata in the right
sidebar while the 3D viewer fills the center pane.

**3D viewport:** Exists. Keep it. Wire into `ViewportPane.tsx` as
`resource.key === 'renderable'`.

**Tree labels:**
- `meshes[i]` → `"Mesh {i} · {material-name} · {N} tris"`
- `materials[i]` → `"Mat {i} · {shader-name}"`

**Gotchas:**
- Vertex data is bulk binary — mark as hidden in the schema, surface
  summary stats (count, stride, descriptor) instead.
- Materials reference textures via hash IDs — use `ref` targets when
  possible, or fall back to hex-display `bigint` fields.
- Some bundles have BROKEN renderables that the parser tolerates with
  warnings. The schema must tolerate them too — don't throw in label
  callbacks on missing data.

**Verification:** per shared checklist.

---

## Texture (type `TEXTURE_TYPE_ID`)

Migrate the Texture resource to the schema-driven editor framework.

**Background:** Read
`steward/docs/schema-editor-migration.md` first.

**Handler key:** `texture`
**Type ID:** `TEXTURE_TYPE_ID` — check
`src/lib/core/registry/handlers/texture.ts` for the numeric value.
**Parser:** `steward/src/lib/core/texture.ts` (3 exported types)
**Existing editor:**
- `steward/src/pages/TexturePage.tsx` — 2D texture previewer

**Spec docs:** `docs/Texture_PC.md`, `docs/Texture_Remastered.md`.

**Record types:** 3 — header metadata (format, width, height, mip
count, flags) + the pixel data blob.

**Migration approach:** **Schema-first with a 2D preview extension**.
The header fields are trivially schema-driven (enums for format, u16
for width/height, flags for texture flags). The pixel data must NOT be
editable through the schema — mark it `hidden` and preserve the
existing 2D preview as an extension that renders alongside the header
form.

**Tree labels:**
- Texture is usually a single record per bundle, so the tree is
  minimal. No special label logic needed.

**Gotchas:**
- Pixel data is potentially megabytes. Don't include it in the schema
  walker's default visiting — tag it with some "opaque blob" marker.
- Texture format enum has many values (DXT1, DXT3, DXT5, ARGB8888, …)
  — grab the list from the existing decoder.

**Verification:** per shared checklist.

---

# Priority order

If the agents tackle these in sequence, this is the recommended order
(easiest → hardest, and highest-value first among the world resources):

1. **PlayerCarColours** — tiny, schema-first only. Good warm-up to
   validate the pattern works on a fresh resource.
2. **IceTakeDictionary** — tiny, similar.
3. **AISections** — medium, has a 3D viewport but small type set.
4. **ChallengeList** — medium, polymorphic challenge records but
   existing tabs preserve cleanly.
5. **Texture** — medium, pixel-data handling is the only wrinkle.
6. **VehicleList** — medium-large, routing wrinkle for the detail view.
7. **Renderable** — large, 3D viewer must be preserved.
8. **TriggerData** — largest, many polymorphic triggers.
9. **StreetData** — largest + highest fidelity bar. Do this LAST.
   The user is actively working on the parser; minimize churn here.

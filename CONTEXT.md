# Steward

A TypeScript/React editor for Burnout Paradise game **Bundle** files. The editor opens one or more **Bundles** into a **Workspace**, browses their typed **Resources**, edits them, and writes each **Bundle** back to its own file byte-for-byte. A separate Node CLI exercises the same parser/writer code without the UI.

## Language

**Bundle**:
A serialized container (BND2 or BND1, platform-aware LE/BE) holding a header, an import table, and a list of typed **Resources**. Both the on-disk file format and the loaded in-memory representation use this term — they are the same domain object, distinguished only by where they live.

**Workspace**:
The editor session that holds one or more loaded **Bundles**. Each **Bundle** in the **Workspace** retains its own file identity and its own dirty state and is saved back to its own file independently. Undo/redo, by contrast, is **Workspace**-wide — one chronological stack covering every edit across every **Bundle** (see ADR-0006). The **Workspace** is what the **WorldViewport** composes overlays *across* — a single 3D scene drawing on every loaded **Bundle** at once.
_Avoid_: project, session, bench (chosen: Workspace).

**Bundle addressing**:
Every API that reads or writes a **Resource** takes both a Bundle identifier and a **Resource** key — `(bundleId, resourceKey)`. The single-**Bundle** convention of bare `getResource(key)` does not survive multi-**Bundle** **Workspaces**: two **Bundles** can hold a **Resource** with the same key (e.g. two adjacent track-unit **Bundles** both have `streetData`), so the **Bundle** must always be named explicitly.

**Bundle filename**:
A **Bundle**'s on-disk filename is its identity throughout **Steward** — `bundleId` *is* the filename. The game references files by name, and renaming is not a validated capability, so the filename is treated as immutable: every save writes back to the original name, the editor exposes no rename UI, and a **Workspace** cannot hold two **Bundles** with the same filename (loading a second one with a name already present prompts Replace / Cancel, never "add as duplicate").

**Visibility**:
A per-tree-node toggle controlling whether a **Resource** contributes to the **WorldViewport** scene. Cascades down the tree — toggling a **Bundle**'s node off hides every **Resource** inside it. For **Resources** that have multiple instances per **Bundle** (PolygonSoupList: 0..N soups per **Bundle**), each instance has its own visibility — many can be visible at once. **Visibility** is independent of **Selection**. Meaningless for **Resources** in the **Standard viewport** family — they have no scene contribution.

**Selection**:
One or more focused **Resources** or sub-paths within them. In single-resource flows (legacy per-resource pages) the **Selection** is exactly one **Resource** or sub-path. In the **Workspace editor**'s **WorldViewport** the **Selection** can be multi-entity and mixed-resource, possibly spanning multiple **Bundles** — e.g. a marquee that lassos a set of AI sections, a few portals, and a trigger box across two **Bundles**. Drives the inspector content and the **Tools**. Independent of **Visibility**: you can have many **Resources** visible and one selected, or select something that isn't visible. There is no separate "active **Bundle**" concept — for single-entity **Selections** the **Bundle** is implicit; for cross-**Bundle** **Selections** every affected **Bundle** is dirtied independently when the **Selection** is mutated.

**Tools**:
The editing affordances available for the current **Selection**. Two kinds, dispatched on different axes:
- **Type-driven Tools** — type-specific edits (snap toggles, format-specific controls, "Add Portal" etc.). Driven by the type of a single-entity **Selection**, not by which **Bundle** it lives in: every AI section everywhere uses the same AI-section **Tools**, regardless of which **Bundle** holds it.
- **Selection-shape Tools** — affordances that work on any spatial **Selection** regardless of resource type. The **Bulk transform** is the canonical case: one universal translate/rotate affordance in the **WorldViewport**, used for both single-entity and multi-entity **Selections**.

**Bulk transform**:
A translate and/or rotate applied to the current **WorldViewport** **Selection** as one **Workspace**-undo step (one undo entry per gesture, not per drag-frame). Replaces today's per-entity drag affordances in the **WorldViewport**. The on-canvas affordance is a single translate/rotate handle anchored at the **Selection**'s **Pivot** — exactly one on screen at any time, regardless of **Selection** cardinality. Rotation around X and Z is auto-disabled when the **Selection** contains any resource whose spatial data is XZ-packed 2D (AI section corners, boundary/no-go lines, zone points, traffic yaw-packed boxes) — those resources have no Y-component to tip out of the plane. Cross-**Bundle** **Selections** apply the same delta per-**Bundle**, dirtying each affected **Bundle** for its own save.

**Pivot**:
The centre of a **Bulk transform**. Defaults to the median of the **Selection**'s positions; drag-repositionable on the transform handle before the user commits the gesture. Polygon soups have no world-space placement field and are excluded from **Bulk transforms** entirely (the handle refuses if a soup is in the **Selection**).

**Cascade**:
Propagation of a transform from the **Selection** to topologically connected entities *outside* the **Selection** — for AI sections this means dragging neighbour sections' reverse-portal anchors, shared corners on the boundary edge, and mirror-portal positions so connections stay geometrically coherent. Off by default for any **Bulk transform** (including single-entity **Selections**), opt-in via a held modifier. The legacy `translateSectionWithLinks` algorithm is the cascade-on implementation; its automatic-on behaviour was load-bearing in the per-resource viewports but is now explicit. The trade-off: with cascade off, moving a "stadium"-style island across the map leaves dangling outside-portal anchors that the user must re-wire — the alternative (cascade-on by default) would drag surrounding districts along with the stadium.

**Resource**:
A single typed entry inside a **Bundle** (e.g. StreetData, TrafficData, Texture). Identified by a numeric type ID and a string key.
_Avoid_: asset, entity, record (used inside specific resource shapes, not at this level).

**Handler**:
The registry entry for a **Resource** type. Owns the parser, the writer, capability flags (read/write, supported platforms), test fixtures, and stress scenarios. Lives in `src/lib/core/registry/handlers/`. UI-framework-agnostic — importable from Node so the CLI can use it.
_Avoid_: codec, plugin, adapter (overloaded — see `LANGUAGE.md` of `improve-codebase-architecture`).

**Schema**:
A declarative description of a **Resource**'s in-memory shape (fields, kinds, lengths, enums, refs, UI metadata). Hand-written to mirror the parser's `ParsedX` type. Lives in `src/lib/schema/resources/`. Powers the schema-driven editor's tree, form, and immutable-mutation logic.

**Extension**:
A React component that fills a per-resource gap in the generic schema-driven editor (virtualization, paired arrays, aggregate views, custom visuals). Registered per resource in `src/components/schema-editor/extensions/`.
_Avoid_: tab (legacy term — pre-schema-editor UI was tab-based; the surviving tab components are now wrapped as Extensions).

**Viewport**:
The visualisation surface a **Resource** is edited through — the centre region of the editor. Every **Resource** belongs to exactly one **Viewport** family; the family determines how the editor presents it. Today's families:

- **Standard viewport** — tree + inspector with no centre-pane visualisation. The default family, modelled on Unity's inspector for pure-configuration assets. Currently: challenge list, vehicle list, player car colours, ICE take dictionary, attrib sys vault.
- **World viewport** — three.js Canvas + camera + orbit controls in Burnout-world coordinates. Hosts overlays for any **Resource** whose data sits in level space. Currently: AI sections, street data, traffic data, trigger data, zone list, polygon soup list. All such **Resources** share one coordinate system (the single Burnout Paradise world), so the chrome uses one fixed camera/scene for every overlay — no per-resource auto-fit.
- **2D viewport** — image/canvas surface. Currently used by texture only; intended to grow into a shared surface for materials and other 2D data.
- **Decoded-mesh viewport** — three.js scene for a **Resource** whose meaning *is* the rendered geometry itself, not its position in the world. Currently: renderable.

Viewport families still being figured out:
- **Material viewport** — planned home for shaders once material editing exists.
- Deformation spec has no obvious viewport family yet — the data format isn't fully understood.

Multiple **Resources** in the same family share its chrome (Canvas, controls, scene bounds) and contribute only their own data overlays.

**CLI-validated**:
A **Resource** whose **Handler** has been exercised by the Node CLI through round-trip and stress-test fixtures. CLI validation is the prerequisite to building any UI for that resource — parser/writer correctness is proven before editor work begins.

**Schema-driven page**:
A route component that wires `BundleContext` → `SchemaEditorProvider` → `SchemaEditor` for one **CLI-validated** resource whose **Schema** is comprehensive enough that the generic form (plus optional **Extensions**) covers its UI needs. Currently 9 of these in `src/pages/`, all near-identical scaffolding.

**Bespoke page**:
A route component for a resource that needs custom UI beyond what the schema-driven form provides — synthetic roots, decode pipelines, format-specific previews, multi-resource pickers. Currently 6 of these in `src/pages/` (Renderable, Texture, AttribSysVault, DeformationSpec, PolygonSoupList, Shader). Not a target for genericization.

**Workspace editor**:
The single new top-level page that hosts a multi-**Bundle** **Workspace**. Combines the tree (multi-**Bundle**, with **Visibility** toggles), the **WorldViewport** (composing overlays from every visible **Resource**), and an inspector pane that shows the **Tools** for the current **Selection**. Distinct from the per-resource **Schema-driven page** / **Bespoke page** routes, which remain for single-**Bundle** focused workflows. Those legacy per-resource routes are pinned to the first-loaded **Bundle** (via `useFirstLoadedBundle` / `useFirstLoadedBundleId` in `WorkspaceContext`) — a single-**Bundle** convenience, not an "active **Bundle**" fallback — until they're either retired or refactored to take `bundleId` from the URL.

## Relationships

- A **Workspace** holds one or more **Bundles**
- A **Bundle** holds many **Resources**
- Each **Resource** type has exactly one **Handler**
- A **Handler** may have a **Schema** (required for a **Schema-driven page**, optional otherwise)
- A **Schema** may have zero or more **Extensions**
- A **Resource** belongs to at most one **Viewport** family; many **Resources** can share a family
- A **Resource** is **CLI-validated** before its UI (**Schema-driven page** or **Bespoke page**) is built

## Workflow

1. Author the **Handler** (parser + writer + fixtures + stress scenarios).
2. **CLI-validate** via round-trip + stress tests — no UI involvement.
3. If the resource's UI fits the generic form, author its **Schema** (+ any **Extensions**) and add a **Schema-driven page**.
4. If not, author a **Bespoke page**.

The registry deliberately stays UI-framework-agnostic so step 2 can run under Node without React.

## Flagged ambiguities

- "Tab" was previously the unit of resource UI (pre-schema-editor). Surviving tab components live in `src/components/<resource>/` and are wrapped as **Extensions**. Use **Extension** for the seam; "tab" only for the legacy implementation file when relevant.
</content>
</invoke>
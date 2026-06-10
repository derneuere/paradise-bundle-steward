# UX follow-ups

_Collected 2026-06-10 from the `suggestedWorkspaceUx` reports of the 30+ resource-type
implementations (solo slices + workflow batches 1–5). Parsers, writers, schemas, and
default editors all exist and round-trip byte-exact; everything here is editor-experience
polish on top. Grouped by leverage: the cross-cutting items each unlock several resource
types at once._

## Cross-cutting (highest leverage)

### 1. Colour-swatch rendering for colour fields
A generic schema-editor addition: render a swatch (and ideally a picker) next to vec3/vec4
and RGBA8 fields flagged as colours. The schema descriptions already consistently say
"Linear float RGB" where it applies. Benefits: **environmentKeyframe** (sky/light/tint
ramps — note HDR-overbright values up to ~3.5 must not be clamped), **flaptFile** (font
style colours, vertex RGBA8), **particleDescription** (Colour8 ramps), **guiPopup**/
**font** where colour bytes appear. Suggested shape: a `color: true` flag in field
metadata consumed by Vec3Field/Vec4Field/u32-RGBA renderers.

### 2. Cross-resource reference resolution
Many types reference siblings or companions by id/hash/name. A small framework (resolve a
ref against other loaded bundles/resources, render as a link + validity badge, optionally
a picker dropdown) would light up:
- **hudMessage** lines + **guiPopup** text keys → **language** strings (different
  mechanisms: symbolic id hashed against `muHash` vs char[32] key). Inline translated-text
  preview; warn on ids with no Language entry (a renamed id silently blanks in game).
- **aemsBank** interface refs → **csis** classes (u32 = system crc | class crc << 16; a
  picker over CSIS.BUNDLE classes beats hand-typing hex; linked/dangling badges).
- **snapshotData** channel MIXCHIDs → companion **nicotine** master-mix channels (72/72
  proven).
- **particleDescriptionCollection** slots → **particleDescription** effects (FNV-1a of
  gamedb URIs).
- **wheelList** entries → `WHE_<code>_GR.BNDL` wheel-graphics bundles (decoded CgsID code).
- **idList** ids → sibling **polygonSoupList** resources (1:1 bijection proven) as a
  clickable tree cross-reference.
- **environmentDictionary** season rows → their environment/colour-cube bundle paths
  (clickable open-in-workspace; warn when crc32(lowercase name) misses in the target).
- **registry** (0xA000): resolve hashes across ALL registries in a bundle — CSIS
  VoiceSpecs reference schemas defined in sibling registries and currently fall back to
  hex when absent from the local string pool.
- **aptData** / **flaptFile** texture retargets: dropdown listing the bundle's sibling
  Texture resources instead of bigint hex ids (flaptFile slot 52 needs a "special —
  resolved by name" badge).

### 3. Audio preview / decoders
Blocked on codec work, listed for completeness: **genericRwacWaveContent** is EALayer3
(export/import-raw-chunk-bytes would already enable external tools — vgmstream/ealayer3 —
with steward re-deriving sizes/pads/sample totals on import); **splicer** samples are
EA-XAS (a transcode-to-PCM preview is plausible); **aemsBank** SND10 sample banks need an
SND10 decoder. An "audio asset card" (codec/rate/channels/duration/loop badge) already
falls out of the schemas.

### 4. bundle-cli deep-clone drops Uint8Array fields
`scripts/bundle-cli.ts` stress/fuzz clones models via JSON (bigint-only replacer), which
loses `Uint8Array` preservation fields (`_payload`, `_aptData`, `_trailingPad`, …). The
vitest registry suite uses `structuredClone` and is unaffected; writers fail loudly rather
than corrupting. Fix: structuredClone (or a Uint8Array-aware reviver) in the CLI cloner.

## Per-resource

### World / spatial
- **worldPainter2D** — the paint overlay: one 384×256 nearest-filtered DataTexture from
  `cells` (23-colour palette + transparent 0xFF) on a single quad draped over the track
  geometry; legend mapping colours→names; hover shows cell (x, y) + district; click-to-
  paint with a selected swatch + drag brush. **Blocker to solve first:** the grid→world
  origin/scale lives in hardcoded `CgsWorld::WorldMap2D` values, not the resource — derive
  it once by aligning district boundaries to known track-unit positions, store as a
  steward constant. Accept an alternate palette when the debug name says Ambiences.
- **staticSoundMap** — rebucket op shipped in batch 5 (entity add/remove/move). Remaining:
  nothing major; markers/ring/fly-to landed in the original slice.
- **propPhysics** — render collision volumes (box/capsule/sphere at their local
  transforms) around placed props in the world viewport: cross-bundle join of the global
  catalogue onto **propInstanceData** placements via the shared PROP_TYPES index (same
  companion-bundle pattern PropGeometry uses for GLOBALPROPS models).
- **vfxPropCollection** — a prop-local 3D mini-viewport: locators as points, coronas as
  billboards positioned by transform row 3 around a unit prop box, coloured by material
  type (data is prop-relative; no track geometry needed). Also: a regroup/repack op
  (insert/remove state/material/locator with automatic run re-indexing) to unlock list
  edits.
- **vfxMeshCollection** — show the detected radius-cycle length next to the 32-slot grid
  so users edit whole cycles consistently.

### GUI / text
- **language** — a virtualized, searchable string-table view (columns: hash hex, text)
  with inline editing, replacing the 7,600-item tree for bulk work; a "hold size at
  0xD4800" toggle that grows/shrinks the trailing 'A'-filler entry to absorb edit deltas;
  longer term, a cross-bundle translation view keyed by hash (same string across all 14
  languages side by side).
- **guiPopup** — a card-style preview extension mocking the popup (title/message/buttons)
  for the selected entry, with Language-resolved text.
- **hudMessageSequence(+Dictionary)** — cross-resource validation: every dictionary entry
  must match a sequence name in the bundle and vice versa (catches the orphaned-rename
  foot-gun the schema descriptions already warn about).
- **aptData** — 2D canvas preview of GuiGeometry meshes (vertex-coloured triangle lists in
  movie screen space; optionally textured by decoding the imported sibling Texture and
  sampling UVs); click a mesh to select it.
- **flaptFile** — searchable read-only HUD-strings tab; texture-slot retarget dropdown;
  colour swatches (see cross-cutting #1); later, render the GuiVertex pool as a 2D overlay
  to preview HUD element shapes.
- **font** — glyph-atlas preview: decode the bundled Texture, draw each renderable glyph's
  UV rect over it, click-to-select the char record (tree labels already show the actual
  character). A live text-preview box laying out a typed string via mStart/mfAdvance/
  mScaleUV would make metric edits tangible. LIMITED Chinese fonts import page 1 from
  another bundle — show an "external texture" badge instead of a broken preview.

### Environment / grading
- **environmentKeyframe / environmentTimeLine** — beyond colour swatches: a 24-hour strip
  viewport per timeline — one column per keyframe previewing sky zenith/horizon colours
  and key light, with drag-to-retime markers (the picker's time-of-day sort already orders
  them).
- **colourCube** — a CLUT preview extension: render a test strip (hue sweep + greyscale
  ramp + sample photo swatch) raw vs mapped through the cube; since retail cubes are
  separable, plot the three per-channel tone curves as an editable curve widget (dragging
  regenerates pixels); a "neutralize to linear identity" button; a z-slice scrubber
  showing each 32×32 RGB slice magnified.

### Audio (beyond decoders)
- **nicotine** — render mixData attenuation as a dB slider pair (values are i16 lanes in
  hundredths of a dB with a −100 dB floor).
- **snapshotData** — a matrix view (snapshots × channels) fits the data shape.
- **splicer** — a "duplicate splice" op that auto-assigns the next free SpliceIndex
  (adding splices stays disabled until then).
- **registry** — per-kind field visibility: entity payload sub-records are null on kinds
  that don't use them and render as empty record navs in the generic inspector; purely
  cosmetic.

### Misc small ops
- **particleDescription** — colour-ramp swatch renderer for the ramp + time-array pairs;
  the schema's grouped Emission/Lifetime/Colour/Size layout already targets hand-tuning.
- **hudMessage** — nothing beyond cross-resource text (renames already re-derive the
  CgsID via the derive hook).

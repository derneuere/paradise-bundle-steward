# Crash-deformation rigging tools

`scripts/` tools for per-vehicle crash deformation (`DeformationSpec`, resource
type `0x1001C`) and its graphics layout (`GraphicsSpec`, `0x10006`). They give a
custom body (a modded car, usually with no deformation of its own) a working
crash rig by borrowing a retail car's spec and fitting it to the new body.

| Script | What it does |
|---|---|
| `deform-rig-mvp.ts` | Soft-skin rig: the whole body dents, nothing ever comes off. Works for any body. |
| `deform-rig-full.ts` | Panel rig: donor panels are matched to the target's own separate meshes, so doors, bumpers, spoilers etc. hinge and break off where the target has them. |
| `preview-deform.ts` | Headless render of a body with a spec's sensors (red) and tag points (cyan), or with `--explode` the meshes that can come off pushed outward. |
| `parts-taxonomy.ts` | Per-partType statistics over a whole `VEHICLES/` folder: the evidence for the slot names below. |

Shared code lives in `scripts/lib/deform-rig/` (with tests in its `__tests__/`).

## How the format behaves

These facts drive every decision in the riggers. They were measured over the
~500 retail `VEH_*_AT.BIN` / `_GR.BIN` pairs and hold for every one of them
unless a count is given.

**Two coordinate frames.** Every point in a DeformationSpec (sensors, tag and
driven points, joint pivots, FX/camera/light locators, header wheels) is in the
*handling-body* frame: the mesh frame shifted by the translation of
`carModelSpaceToHandlingBodySpace` (it never rotates; the shift is `-meshOffset`).
Only `IKPart.graphicsTransform` is in the mesh frame, and it always equals the
locator of the GraphicsSpec part the IK part drives. Getting the frame wrong
puts the whole rig ~0.6 m off the body.

**Skin rows.** Each car has one 128-row deformation array: the leading run of
skinned tag points, then every IK part's driven points in part order. Every
body vertex reads its row by blend index, and on every retail car the mesh's
highest blend index + 1 equals that row count exactly. So the riggers never
delete or reorder parts or points; unwanted parts are *neutralised* in place
(no mesh, no joints, never detach) and keep their rows. A mod mesh skinned
against a different row layout than the donor will still deform, but the dents
land on the wrong vertices; the riggers warn when the counts differ (`--veh`
lists donors with a matching count).

**Header wheels.** The four `WheelSpec`s are stored FL, FR, RL, RR (+x is the
car's right). `iValue` is the index of the wheel's tag point (a root-part tag
sitting exactly on the wheel centre), which the engine reads every frame. The
wheel centre is a handling value: a wheel-arch mesh's locator sits well above
the axle, so the riggers take wheel positions from the target's own spec.

**How a part leaves the car.**
- A part drives no mesh (`partGraphics = -1`) or has every tag point at/above
  the never-detach threshold (`fDetachThresholdSquared >= 9995`; retail uses
  `1e16`): it only dents.
- A detachable part with a *jointed* tag point first hinges, and comes off only
  if the joint breaks: never when `jointDetachThreshold <= -0.9`, never for the
  bonnet (type 3, it pops open and stays), and never for the last exhaust.
- A detachable part with no jointed tag points flies straight off.
- A tag's `jointIndex` must be below its own part's joint count; the engine
  asserts on it.

**Glass.** A glass pane only shatters when paired with a GraphicsSpec
shattered-glass model. Bodies without those keep a dangling smash reference, so
the riggers strip all panes.

## The partType slots

`IKPart.partType` is a stable slot id. Positions measured over all retail cars:

| partType | slot |
|---|---|
| `999` | root: no mesh, holds the four wheel tags |
| `46` | body shell: the bulk of the soft-skin tags, never detaches |
| `48` / `49` / `50` / `51` | wheel arches FL / FR / RL / RR (anchor each wheel's suspension) |
| `130` / `131` | rear / front axle pair (one part for both arches of an axle) |
| `1` / `2` | front / rear bumper |
| `3` / `4` | bonnet / boot |
| `8` / `10`, `12` / `13` | front / rear doors, R / L |
| `24` / `25` | sills R / L |
| `26` / `27`, `28` / `29` | front wings R / L, rear quarters L / R |
| `40`–`43` | head / tail lights |
| `84` / `85` | exhausts |

Bumpers, wings and types 108–115 are *toughened*: light taps don't remove them.

## Usage

All riggers write only to `--out`; copy the result into the game yourself.

```
npx tsx scripts/deform-rig-mvp.ts  --donor <car_AT> --donor-gr <car_GR> \
  --target-gr <mod_GR> --target-at <mod_AT> --out <out_AT> [--corners a,b,c,d] [--veh <VEHICLES>]

npx tsx scripts/deform-rig-full.ts --donor <car_AT> --donor-gr <car_GR> \
  --target-gr <mod_GR> --target-at <mod_AT> --out <out_AT> \
  [--corners a,b,c,d] [--max-match 0.6] [--fused 0.35] [--veh <VEHICLES>]
```

- **Donor**: ideally the retail car the mod's mesh was built from (same skin
  rows). `--donor-gr` is optional but makes the box fit exact; without it the
  donor's tag-point extent is used.
- **Target `_AT`**: the mod's own `_AT`. Its attribs, audio, handling box,
  centre-of-mass/mesh offsets, inertia and wheel positions are kept; only the
  deformation content comes from the donor.
- **Corners**: the wheel-arch meshes the arch parts drive. Taken from the
  target's own spec when it names them, else the four meshes sitting off the
  body origin; pass `--corners` when neither works.
- **Panel rig only**: big meshes besides the shell (≥ `--fused` of its volume)
  are treated as fused body sections and are never driven by a panel, so the
  body can't fly off. Donor panels with no target mesh within `--max-match`
  metres are neutralised. The script prints which target mesh each panel drives
  and how it behaves.

Each rigger re-reads its output and fails on anything the engine would trip
over (index ranges, joint indices, wheel tags, skin rows, points off the body).

Check a rig visually under node 22 (needs `gl`, `npm install --no-save gl`):

```
fnm exec --using=22 node node_modules/tsx/dist/cli.mjs scripts/preview-deform.ts \
  --gr <mod_GR> --at <out_AT> --tex <VEHICLETEX.BIN> --out <dir> [--explode 0.9]
```

## Limits

- A body whose panels are welded into one mesh can't shed them: splitting a mesh
  needs a GraphicsSpec/renderable writer, which the codebase does not have. The
  same writer would be needed to give a mod shattering glass.
- Skin rows can't be fixed from the spec side. If no retail car matches the
  mod mesh's row count, dents land on the wrong vertices.

# Crash-deformation rigging tools

Three `scripts/` tools for working with per-vehicle crash deformation
(`DeformationSpec`, resource type `0x1001C`) and its companion graphics layout
(`GraphicsSpec`, `0x10006`). They exist to give a **single-mesh vehicle** — a
custom car whose body is one welded mesh plus wheels, with no separate panels —
a working crash rig without re-modelling it.

## Why single-mesh cars need special handling

A normal Burnout car crumples because its body is split into ~26 separate
graphics parts (bonnet, doors, bumpers, wings, …), each driven by its own IK
part in the DeformationSpec: a hinge that bends and, past a threshold, detaches.
A one-piece body has nothing to hinge, so grafting a paneled car's spec onto it
drives the *wrong* meshes — panels fly off, a frame hovers, and FX locators land
in empty space. The fix is a **minimal rig** that any body can carry: root + one
soft body-shell + four wheels, no hinged panels and no glass. The whole body
then dents as a single soft skin and never disintegrates.

## The partType slot convention

Across every retail vehicle spec, `IKPart.partType` is a stable slot id. The
ones this toolset relies on:

| partType | slot | notes |
|---|---|---|
| `999` | root / handling body | one per car, no graphics part |
| `46` | body shell | carries the bulk of the soft-body tag points, no hinge |
| `48` / `49` / `50` / `51` | wheels FL/FR/RL/RR | fixed IK parts; wheels detach via the wheel system, not an IK hinge |
| `1`/`2`, `3`, `4`, `8`/`10`, `26`–`29`, … | bumpers, bonnet, boot, doors, wings | hinged, detachable panels |

`scripts/parts-taxonomy.ts` derives the full table (position, hinge axis, fold
angle, detach behaviour) empirically from a whole `VEHICLES/` folder.

## Tools

### `parts-taxonomy.ts` — learn the part template
Joins every car's DeformationSpec IK parts to its real GraphicsSpec part
positions and aggregates per-partType statistics.
```
npx tsx scripts/parts-taxonomy.ts --veh <VEHICLES dir> [--out parts-taxonomy.json]
```

### `deform-rig-mvp.ts` — auto-rig a single-mesh car
Takes a **donor** car's spec (any normal car), keeps only the 6 IK parts above,
deletes every panel and all glass, then box→box remaps every point (sensors, tag
points, driven points, and the FX/camera/light locators) from the donor body
extent onto the **target**'s real graphics-body AABB (decoded from its `_GR`).
Wheels are placed at the target's real wheel-locator positions. The new spec is
written into the target's own `_AT` bundle wrapper, so the target keeps its
attribs/audio resources. Writes only to `--out`; never touches the game folder.
```
npx tsx scripts/deform-rig-mvp.ts \
  --donor <normalCar_AT.BIN> --target-gr <target_GR.BIN> \
  --target-at <target_AT.BIN> --out <out_AT.BIN> [--corners 0,1,21,22]
```
`--corners` names the gfx-part indices of the four wheels; omit it to
auto-detect (the parts whose locator sits off the body origin). The script
re-parses its own output and asserts the intended 6-part, no-glass, no-joint,
all-points-inside-the-body rig before finishing.

### `preview-deform.ts` — see whether a spec fits a body
Renders a car body (GraphicsSpec-driven, LOD0, part-tinted) with every sensor
(red) and tag point (cyan) drawn as a marker in the body's own model space, so a
mis-aligned spec is visible as markers floating off the bodywork. Needs
`headless-gl` (as `render-car.ts` does) and must run under node 22:
```
fnm exec --using=22 node node_modules/tsx/dist/cli.mjs scripts/preview-deform.ts \
  --gr <_GR.BIN> --at <_AT.BIN> --tex <VEHICLETEX.BIN> --out <dir> [--size WxH]
```

## Scope

This is an MVP: soft whole-body denting plus wheels, no detachable panels. Giving
a single-mesh car *real* crumpling panels needs the body split into separate
graphics parts first, which requires a GraphicsSpec/renderable writer that the
codebase does not yet have.

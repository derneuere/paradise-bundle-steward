// The crash controls both crash views share: speed, obstacle, glance, force
// crash, the pedals after the hit, absorption table, presets, reset, markers /
// damage map / flat shading, particles, slow motion / pause, the skin-row
// mismatch warning, the run's outcome (crash or knock, and why) and the
// hinged / knocked-off / broken-glass readout.

import type { ReactNode } from 'react';
import type * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { AbsorptionSet } from '@/lib/core/deformationSim';
import type { ParsedDeformationSpec, Vec3 } from '@/lib/core/deformationSpec';
import { specRows } from './crashSetup';
import type { CrashInput } from '@/lib/core/vehicleSim';
import type { CrashSession, Obstacle } from './useCrashSession';

type Box = { min: Vec3; max: Vec3; center: Vec3 };
type Preset = { name: string; at: (b: Box) => { point: Vec3; normal: Vec3 } };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const GLANCES = [-60, -45, -30, -15, 0, 15, 30, 45, 60];
const TIME_SCALES: [number, string][] = [[1, 'real time'], [0.25, '¼ speed'], [0.1, '⅒ speed'], [0, 'paused']];
const PRESETS: Preset[] = [
	{ name: 'front', at: (b) => ({ point: [b.center[0], lerp(b.min[1], b.max[1], 0.35), b.max[2]], normal: [0, 0, 1] }) },
	{ name: 'front-left', at: (b) => ({ point: [lerp(b.center[0], b.min[0], 0.7), lerp(b.min[1], b.max[1], 0.35), b.max[2]], normal: [0, 0, 1] }) },
	{ name: 'left side', at: (b) => ({ point: [b.min[0], lerp(b.min[1], b.max[1], 0.4), b.center[2]], normal: [-1, 0, 0] }) },
	{ name: 'rear', at: (b) => ({ point: [b.center[0], lerp(b.min[1], b.max[1], 0.35), b.min[2]], normal: [0, 0, -1] }) },
	{ name: 'roof', at: (b) => ({ point: [b.center[0], b.max[1], b.center[2]], normal: [0, 1, 0] }) },
];

type Props = {
	session: CrashSession;
	spec: ParsedDeformationSpec;
	box: THREE.Box3;
	skinRows: number;
	title: string;
	// Bundle pickers etc., shown at the start of the first control row.
	children?: ReactNode;
};

export function CrashControls({ session: s, spec, box: b3, skinRows, title, children }: Props) {
	const box: Box = {
		min: b3.min.toArray() as Vec3, max: b3.max.toArray() as Vec3,
		center: b3.getCenter(b3.min.clone()).toArray() as Vec3,
	};
	const rows = specRows(spec);
	return (
		<>
			<div className="shrink-0 px-3 py-2 border-b space-y-2 text-xs text-muted-foreground">
				<div className="flex flex-row items-center justify-between">
					<span className="text-sm font-medium text-foreground">{title}</span>
					<span title="Front hits drive in nose first with the throttle pinned; side and rear hits are launched sliding along the hit direction off the pedals (no car drives into them); a roof hit drops the car onto its roof">click the car where it should hit · {s.hits} run{s.hits === 1 ? '' : 's'} · {Math.round(s.sim?.state.vehicle.params.mass ?? 0)} kg</span>
				</div>
				<div className="flex flex-row flex-wrap items-center gap-2">
					{children}
					<span className="font-medium">speed:</span>
					<input type="range" min={10} max={250} step={5} value={s.speedKmh} onChange={(e) => s.setSpeedKmh(Number(e.target.value))} className="w-28" />
					<span className="tabular-nums w-16" title="Start speed; a front hit gains a little over its quarter-second run-up">{s.speedKmh} km/h</span>
					<select value={s.obstacle} onChange={(e) => s.setObstacle(e.target.value as Obstacle)} className="bg-muted rounded px-1 py-0.5">
						<option value="wall">into a wall</option>
						<option value="pole">into a pole</option>
					</select>
					<select value={s.glance} onChange={(e) => s.setGlance(Number(e.target.value))} className="bg-muted rounded px-1 py-0.5" title="Turn the obstacle's face off square to the car's travel so the car slides along it: sliding is what scratches the paint">
						{GLANCES.map((g) => <option key={g} value={g}>{g === 0 ? 'head-on' : `glancing ${g}°`}</option>)}
					</select>
					<Button variant={s.forceCrash ? 'default' : 'outline'} size="sm" onClick={s.toggleForceCrash} title="The game crashes a car hitting the world head-on at 40.5 m/s (146 km/h) of closing speed, side-on at 50 m/s at the hit point, or rolled onto its roof; anything less is a knock (a fifth of the crush budget, inside the drive-time limits) and the car drives on. Force crash crashes it on the first obstacle contact, as the game's own debug option does; real crashes also happen at lower speeds through car-on-car hits the preview has no part in.">force crash</Button>
					<select value={s.crashInput} onChange={(e) => s.setCrashInput(e.target.value as CrashInput)} className="bg-muted rounded px-1 py-0.5" title="The pedals once the car has hit: released, the wreck freezes a second after it goes quiet; held, it keeps driving and only the game's crash clock (4 to 11.5 s) ends the crash">
						<option value="release">pedals released</option>
						<option value="hold">throttle held</option>
					</select>
					<select value={s.absorption} onChange={(e) => s.setAbsorption(Number(e.target.value))} className="bg-muted rounded px-1 py-0.5" title="Which absorption table the crash uses">
						<option value={AbsorptionSet.Normal}>player crash</option>
						<option value={AbsorptionSet.PlayerExtremeCrash}>player, near top speed</option>
						<option value={AbsorptionSet.AiCrashing}>rival / AI crash</option>
					</select>
					<Button variant="outline" size="sm" onClick={s.reset}>reset</Button>
					<Button variant={s.showPoints ? 'default' : 'outline'} size="sm" onClick={s.togglePoints}>points</Button>
					<Button variant={s.showHeat ? 'default' : 'outline'} size="sm" onClick={s.toggleHeat} title="Colour each vertex by how far it has been pushed (white = 0.3 m)">damage map</Button>
					<Button variant={s.flat ? 'default' : 'outline'} size="sm" onClick={s.toggleFlat} title="The game keeps the undamaged normals, so dents barely shade; flat shading makes them readable">flat shading</Button>
					<Button variant={s.showParticles ? 'default' : 'outline'} size="sm" onClick={s.toggleParticles} title="Sparks, debris, glass, dust and smoke, fired by the crash the way the game fires them">particles</Button>
					<select value={s.timeScale} onChange={(e) => s.setTimeScale(Number(e.target.value))} className="bg-muted rounded px-1 py-0.5" title="Slow the crash down or pause it">
						{TIME_SCALES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
					</select>
					{s.timeScale === 0 && <Button variant="outline" size="sm" onClick={s.stepOnce} title="Advance one 1/60 s simulator step">step</Button>}
				</div>
				<div className="flex flex-row flex-wrap items-center gap-2">
					<span className="font-medium">hit:</span>
					{PRESETS.map((p) => (
						<Button key={p.name} variant="outline" size="sm" onClick={() => { const h = p.at(box); s.hit(h.point, h.normal); }}>
							{p.name}
						</Button>
					))}
				</div>
			</div>
			{skinRows > 0 && skinRows !== rows && (
				<div className="shrink-0 px-3 py-1 border-b text-xs text-red-300/90">
					This body's meshes read {skinRows} deformation rows but the spec provides {rows}: dents land on the
					wrong vertices (the game does the same). Use a donor whose layout matches the mesh.
				</div>
			)}
			{s.outcome && <div className="shrink-0 px-3 py-1 border-b text-xs text-sky-300/90">{s.outcome}</div>}
			{s.parts && <div className="shrink-0 px-3 py-1 border-b text-xs text-amber-300/90">{s.parts}</div>}
		</>
	);
}

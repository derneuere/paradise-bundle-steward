// The crash controls both crash views share: speed, obstacle, crash vs knock,
// absorption table, presets, reset, markers / damage map / flat shading, the
// skin-row mismatch warning and the hinged / knocked-off readout.

import type { ReactNode } from 'react';
import type * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { AbsorptionSet } from '@/lib/core/deformationSim';
import type { ParsedDeformationSpec, Vec3 } from '@/lib/core/deformationSpec';
import { specRows } from './crashSetup';
import type { CrashSession, Obstacle } from './useCrashSession';

type Box = { min: Vec3; max: Vec3; center: Vec3 };
type Preset = { name: string; at: (b: Box) => { point: Vec3; normal: Vec3 } };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const GLANCES = [-60, -45, -30, -15, 0, 15, 30, 45, 60];
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
					<span>click the car to hit it · {s.hits} hit{s.hits === 1 ? '' : 's'} · {Math.round(s.sim?.state.attribs.mass ?? 0)} kg</span>
				</div>
				<div className="flex flex-row flex-wrap items-center gap-2">
					{children}
					<span className="font-medium">speed:</span>
					<input type="range" min={10} max={250} step={5} value={s.speedKmh} onChange={(e) => s.setSpeedKmh(Number(e.target.value))} className="w-28" />
					<span className="tabular-nums w-16">{s.speedKmh} km/h</span>
					<select value={s.obstacle} onChange={(e) => s.setObstacle(e.target.value as Obstacle)} className="bg-muted rounded px-1 py-0.5">
						<option value="wall">into a wall</option>
						<option value="pole">into a pole</option>
					</select>
					<select value={s.glance} onChange={(e) => s.setGlance(Number(e.target.value))} className="bg-muted rounded px-1 py-0.5" title="Turn the car's travel off the hit direction so it slides along the obstacle: sliding is what scratches the paint">
						{GLANCES.map((g) => <option key={g} value={g}>{g === 0 ? 'head-on' : `glancing ${g}°`}</option>)}
					</select>
					<select value={s.crash ? 'crash' : 'knock'} onChange={(e) => s.setCrash(e.target.value === 'crash')} className="bg-muted rounded px-1 py-0.5" title="A knock is a hit below the car's crash speed: a fifth of the crush budget, inside its drive-time limits">
						<option value="crash">crash</option>
						<option value="knock">knock (no crash)</option>
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
			{s.parts && <div className="shrink-0 px-3 py-1 border-b text-xs text-amber-300/90">{s.parts}</div>}
		</>
	);
}

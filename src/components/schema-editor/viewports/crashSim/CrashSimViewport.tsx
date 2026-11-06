// Crash preview for a vehicle DeformationSpec (_AT): runs the game's
// deformation pipeline on the matching body (_GR) loaded in the workspace, so
// a rig can be judged without starting the game. Click the car to hit it, or
// use a preset; the speed slider sets the closing speed.

import { useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useSchemaEditor } from '../../context';
import { AbsorptionSet, applyImpact, createCrashSim, resetCrashSim, setAbsorptionSet, type CarAttribs, type CrashSim } from '@/lib/core/deformationSim';
import type { ParsedAttribSys } from '@/lib/core/attribSys';
import type { ParsedDeformationSpec, Vec3 } from '@/lib/core/deformationSpec';
import { decodeCrashBody, hasGraphicsSpec } from './crashBody';
import { makeRowsUniform } from './deformMaterial';
import { CrashSimScene } from './CrashSimScene';

const BACKGROUND = '#15171c';
const KMH = 1 / 3.6;

type Preset = { name: string; at: (b: THREE_Box) => { point: Vec3; normal: Vec3 } };
type THREE_Box = { min: Vec3; max: Vec3; center: Vec3 };
const PRESETS: Preset[] = [
	{ name: 'front', at: (b) => ({ point: [b.center[0], lerp(b.min[1], b.max[1], 0.35), b.max[2]], normal: [0, 0, 1] }) },
	{ name: 'front-left', at: (b) => ({ point: [lerp(b.center[0], b.min[0], 0.7), lerp(b.min[1], b.max[1], 0.35), b.max[2]], normal: [0, 0, 1] }) },
	{ name: 'left side', at: (b) => ({ point: [b.min[0], lerp(b.min[1], b.max[1], 0.4), b.center[2]], normal: [-1, 0, 0] }) },
	{ name: 'rear', at: (b) => ({ point: [b.center[0], lerp(b.min[1], b.max[1], 0.35), b.min[2]], normal: [0, 0, -1] }) },
	{ name: 'roof', at: (b) => ({ point: [b.center[0], b.max[1], b.center[2]], normal: [0, 1, 0] }) },
];
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

// Rows the spec fills: the leading run of skinned tag points, then every
// part's driven points.
function specRows(spec: ParsedDeformationSpec): number {
	let run = 0;
	while (run < spec.tagPoints.length && spec.tagPoints[run].skinnedPoint) run++;
	return run + spec.ikParts.reduce((n, p) => n + p.numberOfDrivenPoints, 0);
}

// Mass, crash-entry velocity boost and drive-time crush limits come from the
// car's own attribs (the _AT's AttribSys vault).
function carAttribs(vault: unknown): Partial<CarAttribs> {
	const fields: Record<string, unknown> = {};
	for (const a of (vault as ParsedAttribSys | undefined)?.attributes ?? []) Object.assign(fields, a.fields);
	const num = (k: string) => (typeof fields[k] === 'number' ? (fields[k] as number) : undefined);
	const out: Partial<CarAttribs> = {};
	const mass = num('DrivingMass');
	if (mass && mass > 0) out.mass = mass;
	const extra = num('CrashExtraLinearVelocityFactor');
	if (extra !== undefined) out.crashExtraLinearVelocity = extra;
	const lim = ['DriveTimeDeformLimitX', 'DriveTimeDeformLimitNegY', 'DriveTimeDeformLimitPosZ', 'DriveTimeDeformLimitNegZ'].map(num);
	if (lim.every((v) => v !== undefined)) out.driveTimeLimits = lim as [number, number, number, number];
	return out;
}

export function CrashSimViewport() {
	const { data } = useSchemaEditor();
	const { bundles, selection } = useWorkspace();
	const spec = data as ParsedDeformationSpec;

	const bodyBundles = useMemo(() => bundles.filter((b) => hasGraphicsSpec(b.parsed)), [bundles]);
	const twinId = selection?.bundleId.replace(/_AT(\.[^.]+)$/i, '_GR$1');
	const [chosenId, setChosenId] = useState('');
	const bodyBundle = bodyBundles.find((b) => b.id === chosenId)
		?? bodyBundles.find((b) => b.id.toLowerCase() === twinId?.toLowerCase())
		?? bodyBundles[0];
	const body = useMemo(
		() => (bodyBundle ? decodeCrashBody(bodyBundle.parsed, bodyBundle.originalArrayBuffer) : null),
		[bodyBundle],
	);

	const specBundle = bundles.find((b) => b.id === selection?.bundleId);
	const vault = specBundle?.parsedResources.get('attribSysVault');
	const attribs = useMemo(() => carAttribs(vault), [vault]);
	const rows = useMemo(() => makeRowsUniform(), []);
	const heat = useMemo(() => ({ value: 0 }), []);
	const [showHeat, setShowHeat] = useState(false);
	heat.value = showHeat ? 1 : 0;
	const simRef = useRef<CrashSim | null>(null);
	const sim = useMemo(() => createCrashSim(spec, { attribs }), [spec, attribs]);
	simRef.current = sim;

	const [speedKmh, setSpeedKmh] = useState(80);
	const [obstacle, setObstacle] = useState<'wall' | 'pole'>('wall');
	const [crash, setCrash] = useState(true);
	const [absorption, setAbsorption] = useState(AbsorptionSet.Normal);
	const [showPoints, setShowPoints] = useState(false);
	const [hits, setHits] = useState(0);
	const [parts, setParts] = useState('');

	const hit = (pointMesh: Vec3, normalMesh: Vec3) => {
		setAbsorptionSet(sim, absorption);
		applyImpact(sim, { pointMesh, direction: [-normalMesh[0], -normalMesh[1], -normalMesh[2]], speed: speedKmh * KMH, obstacle, crash });
		setHits((h) => h + 1);
	};

	if (!body) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
				Load the car's body bundle (VEH_*_GR.BIN) into the workspace to preview crashes.
			</div>
		);
	}
	const box: THREE_Box = {
		min: body.box.min.toArray() as Vec3, max: body.box.max.toArray() as Vec3,
		center: body.box.getCenter(body.box.min.clone()).toArray() as Vec3,
	};
	const size = body.box.getSize(body.box.min.clone()).length();

	return (
		<div className="h-full flex flex-col min-h-0">
			<div className="shrink-0 px-3 py-2 border-b space-y-2 text-xs text-muted-foreground">
				<div className="flex flex-row items-center justify-between">
					<span className="text-sm font-medium text-foreground">Crash Preview</span>
					<span>click the car to hit it · {hits} hit{hits === 1 ? '' : 's'} · {Math.round(sim.state.attribs.mass)} kg</span>
				</div>
				<div className="flex flex-row flex-wrap items-center gap-2">
					<span className="font-medium">body:</span>
					<select value={bodyBundle?.id ?? ''} onChange={(e) => setChosenId(e.target.value)} className="bg-muted rounded px-1 py-0.5 max-w-[200px]">
						{bodyBundles.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
					</select>
					<span className="font-medium ml-2">speed:</span>
					<input type="range" min={10} max={250} step={5} value={speedKmh} onChange={(e) => setSpeedKmh(Number(e.target.value))} className="w-28" />
					<span className="tabular-nums w-16">{speedKmh} km/h</span>
					<select value={obstacle} onChange={(e) => setObstacle(e.target.value as 'wall' | 'pole')} className="bg-muted rounded px-1 py-0.5">
						<option value="wall">into a wall</option>
						<option value="pole">into a pole</option>
					</select>
					<select value={crash ? 'crash' : 'knock'} onChange={(e) => setCrash(e.target.value === 'crash')} className="bg-muted rounded px-1 py-0.5" title="A knock is a hit below the car's crash speed: a fifth of the crush budget, inside its drive-time limits">
						<option value="crash">crash</option>
						<option value="knock">knock (no crash)</option>
					</select>
					<select value={absorption} onChange={(e) => setAbsorption(Number(e.target.value))} className="bg-muted rounded px-1 py-0.5" title="Which absorption table the crash uses">
						<option value={AbsorptionSet.Normal}>player crash</option>
						<option value={AbsorptionSet.PlayerExtremeCrash}>player, near top speed</option>
						<option value={AbsorptionSet.AiCrashing}>rival / AI crash</option>
					</select>
					<Button variant="outline" size="sm" onClick={() => { resetCrashSim(sim); setHits(0); }}>reset</Button>
					<Button variant={showPoints ? 'default' : 'outline'} size="sm" onClick={() => setShowPoints((s) => !s)}>points</Button>
					<Button variant={showHeat ? 'default' : 'outline'} size="sm" onClick={() => setShowHeat((s) => !s)} title="Colour each vertex by how far it has been pushed (white = 0.3 m)">damage map</Button>
				</div>
				<div className="flex flex-row flex-wrap items-center gap-2">
					<span className="font-medium">hit:</span>
					{PRESETS.map((p) => (
						<Button key={p.name} variant="outline" size="sm" onClick={() => { const h = p.at(box); hit(h.point, h.normal); }}>
							{p.name}
						</Button>
					))}
				</div>
			</div>
			{body.skinRows > 0 && body.skinRows !== specRows(spec) && (
				<div className="shrink-0 px-3 py-1 border-b text-xs text-red-300/90">
					This body's meshes read {body.skinRows} deformation rows but the spec provides {specRows(spec)}: dents land on the
					wrong vertices (the game does the same). Use a donor whose layout matches the mesh.
				</div>
			)}
			{parts && <div className="shrink-0 px-3 py-1 border-b text-xs text-amber-300/90">{parts}</div>}
			<div className="flex-1 min-h-0" style={{ background: BACKGROUND }}>
				<Canvas camera={{ position: [box.center[0] + size * 1.1, box.center[1] + size * 0.55, box.center[2] + size * 1.1], fov: 40, near: 0.05, far: 500 }}>
					<color attach="background" args={[BACKGROUND]} />
					<ambientLight intensity={0.5} />
					<hemisphereLight args={['#c8d8f0', '#3a3228', 0.5]} />
					<directionalLight position={[6, 10, 4]} intensity={1.2} />
					<directionalLight position={[-6, 6, -8]} intensity={0.5} />
					<Grid args={[40, 40]} position={[0, sim.groundMesh, 0]} cellSize={0.5} sectionSize={2.5} fadeDistance={30} infiniteGrid />
					<CrashSimScene body={body} simRef={simRef} rows={rows} heat={heat} showPoints={showPoints} onHit={hit} onParts={setParts} />
					<OrbitControls target={box.center} enableDamping dampingFactor={0.1} makeDefault />
				</Canvas>
			</div>
		</div>
	);
}

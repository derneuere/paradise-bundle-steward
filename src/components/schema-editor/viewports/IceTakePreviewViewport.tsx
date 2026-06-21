// ICE take camera-preview viewport (resources 0x41 ICE Take Dictionary and
// 0x1000D ICE Data).
//
// Purpose: to judge a big-jump camera you have to see the car flying its arc
// with the track falling away beneath it. So this viewport plays the selected
// ICE take back as a CAMERA while a car proxy flies a ballistic jump arc through
// a loaded track unit's world geometry — all in one Y-up, right-handed, raw
// world-unit scene.
//
// The compose step (the load-bearing bit): a single normalized timeline
// t01 ∈ [0,1] drives BOTH the take (sampleIceCameraTrack) and the car arc
// (carStateAt over [0, durationS]). ICE jump cameras are CAR-RELATIVE, so each
// frame we build the car's world matrix `carM` from its arc state and, when a
// sample's reference token is Car (SPACE_EYE/SPACE_LOOK = 0), transform the
// take's eye/look from car space into world space with `carM`. World-space
// tokens (1) are used as-is. See iceTakeSampler.ts for the sampler and
// iceJumpArc.ts for the arc + the car-space→world matrix.
//
// Two modes:
//   - "Through lens": the take camera IS the active camera — what the player
//     sees. OrbitControls disabled; fov / position / look / dutch-roll come
//     from the sample.
//   - "Inspect": free orbit; the take camera is drawn as a frustum gizmo, the
//     car as a box at carM, and the arc as a polyline, so you can see the rig in
//     the world. Default, so the rig is visible before you switch to the lens.

import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/context/WorkspaceContext';
import { INSTANCE_LIST_TYPE_ID } from '@/lib/core/instanceList';
import { isStructuredDictionary, type IceTakeDictionaryModel } from '@/lib/core/iceTakeDictionary';
import type { ParsedIceData } from '@/lib/core/iceData';
import type { IceTake } from '@/lib/core/iceVariableData';
import { buildIceCameraTrack, sampleIceCameraTrack } from '@/lib/ice/iceTakeSampler';
import {
	carStateAt,
	carWorldMatrix,
	transformPointByMatrix,
	DEFAULT_JUMP_ARC,
	type JumpArcParams,
} from '@/lib/ice/iceJumpArc';
import { useAnimationClock } from '@/hooks/useAnimationClock';
import { useLatestRef } from '@/hooks/useLatestRef';
import { TrackGeometry } from './TrackGeometry';
import { useSchemaEditor } from '../context';

// Scene-wide camera limits — match WorldViewport so the island-scale track and a
// few-hundred-unit jump arc both stay in range.
const CAM_NEAR = 1;
const CAM_FAR = 200000;
const BACKGROUND = '#0a0e14';

// Car proxy dimensions in world units (≈ a road car: 2 wide, 1.2 tall, 4.5 long).
const CAR_W = 2;
const CAR_H = 1.2;
const CAR_L = 4.5;

const TAKE_PREVIEW_FPS = 30;

// ---------------------------------------------------------------------------
// Take resolution from the schema editor selection
// ---------------------------------------------------------------------------

/**
 * Resolve the selected IceTake from the schema-editor model. For an ICE Take
 * Dictionary the selection's entry index comes from `selectedPath` (the dict's
 * paths are rooted at `['entries', i, ...]`); default to entry 0. ICE Data holds
 * a single take. Heuristic-fallback dictionaries (no structured entries) have no
 * keyframe stream to sample, so they yield null.
 */
export function resolveSelectedTake(data: unknown, selectedPath: (string | number)[]): IceTake | null {
	if (data && typeof data === 'object' && 'take' in (data as ParsedIceData)) {
		return (data as ParsedIceData).take ?? null;
	}
	const model = data as IceTakeDictionaryModel | undefined;
	if (model && isStructuredDictionary(model)) {
		if (model.entries.length === 0) return null;
		let idx = 0;
		if (selectedPath[0] === 'entries' && typeof selectedPath[1] === 'number') {
			idx = selectedPath[1];
		}
		return model.entries[idx]?.take ?? model.entries[0].take;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Per-frame scene driver
// ---------------------------------------------------------------------------

type SceneDriverProps = {
	take: IceTake;
	params: JumpArcParams;
	mode: 'lens' | 'inspect';
	/** Live clock position; read every frame via a ref so playback is lag-free. */
	t01Ref: React.MutableRefObject<number>;
};

/**
 * Computes the world-space eye/look for a sample at `t01`, resolving the
 * car-relative reference tokens against the car's world matrix. This is the
 * exact compose step the preview exists to demonstrate.
 */
export function composeCameraWorld(
	track: ReturnType<typeof buildIceCameraTrack>,
	params: JumpArcParams,
	t01: number,
): { eye: THREE.Vector3; look: THREE.Vector3; fovDeg: number; rollRad: number; carM: THREE.Matrix4 } {
	const sample = sampleIceCameraTrack(track, t01);
	const carState = carStateAt(params, t01 * params.durationS);
	const carM16 = carWorldMatrix(carState);
	const carM = new THREE.Matrix4().fromArray(carM16);

	// SPACE token 0 = Car (offset is car-relative), 1 = World (offset is absolute).
	const eyeWorld = sample.spaceEye === 0 ? transformPointByMatrix(carM16, sample.eye) : sample.eye;
	const lookWorld = sample.spaceLook === 0 ? transformPointByMatrix(carM16, sample.look) : sample.look;

	return {
		eye: new THREE.Vector3(eyeWorld[0], eyeWorld[1], eyeWorld[2]),
		look: new THREE.Vector3(lookWorld[0], lookWorld[1], lookWorld[2]),
		fovDeg: sample.fovDeg,
		rollRad: sample.dutchRollRad,
		carM,
	};
}

function SceneDriver({ take, params, mode, t01Ref }: SceneDriverProps) {
	const track = useMemo(() => buildIceCameraTrack(take), [take]);
	const { camera } = useThree();

	const carRef = useRef<THREE.Group>(null);
	const gizmoRef = useRef<THREE.Group>(null);
	// A throwaway perspective camera whose helper draws the take's frustum in
	// Inspect mode. Rebuilt only when params (near/far framing) are stable.
	const frustumCam = useMemo(() => new THREE.PerspectiveCamera(45, 1.6, 1, 60), []);
	const helper = useMemo(() => new THREE.CameraHelper(frustumCam), [frustumCam]);

	useFrame(() => {
		const t01 = t01Ref.current;
		const { eye, look, fovDeg, rollRad, carM } = composeCameraWorld(track, params, t01);

		// Car proxy follows the arc in both modes.
		if (carRef.current) {
			carRef.current.matrixAutoUpdate = false;
			carRef.current.matrix.copy(carM);
			carRef.current.matrixWorldNeedsUpdate = true;
		}

		if (mode === 'lens') {
			const cam = camera as THREE.PerspectiveCamera;
			cam.position.copy(eye);
			cam.up.set(0, 1, 0);
			cam.lookAt(look);
			cam.fov = fovDeg;
			cam.rotateZ(rollRad); // dutch roll about the view axis
			cam.near = CAM_NEAR;
			cam.far = CAM_FAR;
			cam.updateProjectionMatrix();
		} else if (gizmoRef.current) {
			// Inspect: pose the frustum gizmo to match the take camera so the rig
			// is visible from the orbit view.
			frustumCam.position.copy(eye);
			frustumCam.up.set(0, 1, 0);
			frustumCam.lookAt(look);
			frustumCam.fov = fovDeg;
			frustumCam.rotateZ(rollRad);
			frustumCam.updateProjectionMatrix();
			frustumCam.updateMatrixWorld(true);
			helper.update();
		}
	});

	// Arc polyline — sampled once per params change over the full duration.
	const arcPoints = useMemo(() => {
		const pts: [number, number, number][] = [];
		const STEPS = 64;
		for (let i = 0; i <= STEPS; i++) {
			const s = carStateAt(params, (i / STEPS) * params.durationS);
			pts.push([s.position[0], s.position[1], s.position[2]]);
		}
		return pts;
	}, [params]);

	return (
		<>
			{/* Car proxy — a box + a forward arrow to read orientation. */}
			<group ref={carRef}>
				<mesh>
					<boxGeometry args={[CAR_W, CAR_H, CAR_L]} />
					<meshStandardMaterial color="#e8b84b" metalness={0.3} roughness={0.5} transparent opacity={0.85} />
				</mesh>
				{/* Forward arrow: the car frame's +Z is forward, so the nose is at +Z. */}
				<Line points={[[0, 0, 0], [0, 0, CAR_L]]} color="#ff5555" lineWidth={2} />
			</group>

			{mode === 'inspect' && (
				<>
					<Line points={arcPoints} color="#5fa8ff" lineWidth={1.5} />
					<group ref={gizmoRef}>
						<primitive object={helper} />
					</group>
				</>
			)}
		</>
	);
}

// ---------------------------------------------------------------------------
// Jump-arc parameter controls
// ---------------------------------------------------------------------------

const DEG = 180 / Math.PI;

function ArcParamControls({
	params,
	setParams,
}: {
	params: JumpArcParams;
	setParams: (next: JumpArcParams) => void;
}) {
	const row = (label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void) => (
		<label className="flex items-center gap-2">
			<span className="w-20 text-muted-foreground">{label}</span>
			<input
				type="range" min={min} max={max} step={step} value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				className="flex-1"
			/>
			<span className="w-12 text-right tabular-nums">{value.toFixed(step < 1 ? 1 : 0)}</span>
		</label>
	);
	return (
		<div className="px-3 pb-2 space-y-1 text-xs">
			{row('speed', params.speed, 5, 200, 1, (v) => setParams({ ...params, speed: v }))}
			{row('pitch°', params.launchPitchRad * DEG, 0, 80, 1, (v) => setParams({ ...params, launchPitchRad: v / DEG }))}
			{row('heading°', params.headingRad * DEG, -180, 180, 1, (v) => setParams({ ...params, headingRad: v / DEG }))}
			{row('gravity', params.gravity, 1, 100, 1, (v) => setParams({ ...params, gravity: v }))}
			{row('duration', params.durationS, 0.5, 8, 0.1, (v) => setParams({ ...params, durationS: v }))}
			<div className="flex items-center gap-2">
				<span className="w-20 text-muted-foreground">launch</span>
				{(['x', 'y', 'z'] as const).map((axis, i) => (
					<input
						key={axis}
						type="number"
						value={params.launch[i]}
						onChange={(e) => {
							const next: [number, number, number] = [...params.launch];
							next[i] = Number(e.target.value);
							setParams({ ...params, launch: next });
						}}
						className="w-16 bg-muted rounded px-1 py-0.5 text-right tabular-nums"
						title={`launch ${axis}`}
					/>
				))}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IceTakePreviewViewport() {
	const { data, selectedPath } = useSchemaEditor();
	const { bundles } = useWorkspace();

	const take = useMemo(() => resolveSelectedTake(data, selectedPath), [data, selectedPath]);

	const worldBundles = useMemo(
		() => bundles.filter((b) => b.parsed.resources.some((r) => r.resourceTypeId === INSTANCE_LIST_TYPE_ID)),
		[bundles],
	);

	const [mode, setMode] = useState<'lens' | 'inspect'>('inspect');
	const [params, setParams] = useState<JumpArcParams>(DEFAULT_JUMP_ARC);
	const [worldBundleId, setWorldBundleId] = useState<string>('');
	const [speed, setSpeed] = useState(1);
	const [loop, setLoop] = useState(true);
	const [showArcControls, setShowArcControls] = useState(false);

	const lengthSeconds = take?.lengthSeconds && take.lengthSeconds > 0 ? take.lengthSeconds : params.durationS;
	const clock = useAnimationClock({ durationS: lengthSeconds, speed, loop, autoPlay: false });
	// The scene driver reads t01 every frame via a ref to stay lag-free; the
	// transport readout uses the state copy.
	const t01Ref = useLatestRef(clock.t01);

	const chosenWorld = useMemo(
		() => worldBundles.find((b) => b.id === worldBundleId) ?? null,
		[worldBundles, worldBundleId],
	);

	if (!take) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
				No camera take to preview. Select a take in an ICE Take Dictionary (0x41) or open an ICE Data (0x1000D) resource.
			</div>
		);
	}

	const frame = Math.round(clock.t01 * lengthSeconds * TAKE_PREVIEW_FPS);
	const totalFrames = Math.max(1, Math.round(lengthSeconds * TAKE_PREVIEW_FPS));
	const timeS = clock.t01 * lengthSeconds;

	return (
		<div className="h-full flex flex-col min-h-0">
			{/* Header */}
			<div className="shrink-0 px-3 py-2 border-b space-y-2">
				<div className="flex flex-row items-center justify-between">
					<span className="text-sm font-medium">Camera Take Preview</span>
					<span className="text-xs text-muted-foreground">
						{take.name && take.name.length > 0 ? take.name : `guid ${take.guid}`} · {lengthSeconds.toFixed(2)}s
					</span>
				</div>
				<div className="flex flex-row flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<span className="font-medium">view:</span>
					<Button variant={mode === 'inspect' ? 'default' : 'outline'} size="sm" onClick={() => setMode('inspect')} title="Free orbit; the take camera is drawn as a frustum with the car box and the arc path.">
						inspect
					</Button>
					<Button variant={mode === 'lens' ? 'default' : 'outline'} size="sm" onClick={() => setMode('lens')} title="Ride the take camera — what the player sees.">
						through lens
					</Button>
					<span className="font-medium ml-2">world:</span>
					<select
						value={worldBundleId}
						onChange={(e) => setWorldBundleId(e.target.value)}
						className="bg-muted rounded px-1 py-0.5 text-xs max-w-[200px]"
					>
						<option value="">None — flat grid</option>
						{worldBundles.map((b) => (
							<option key={b.id} value={b.id}>{b.id}</option>
						))}
					</select>
					<Button variant={showArcControls ? 'default' : 'outline'} size="sm" onClick={() => setShowArcControls((s) => !s)} title="Tune the ballistic jump arc the car proxy flies.">
						arc…
					</Button>
				</div>
				{showArcControls && <ArcParamControls params={params} setParams={setParams} />}
				{/* Transport */}
				<div className="flex flex-row flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<Button variant="outline" size="sm" onClick={clock.toggle} className="w-16">
						{clock.playing ? 'pause' : 'play'}
					</Button>
					<input
						type="range" min={0} max={1} step={0.001} value={clock.t01}
						onChange={(e) => clock.seek(Number(e.target.value))}
						className="flex-1 min-w-[120px]"
						title="Scrub the timeline"
					/>
					<span className="tabular-nums w-28 text-right">
						{timeS.toFixed(2)}s · f{frame}/{totalFrames}
					</span>
					<span className="font-medium ml-2">speed:</span>
					<input
						type="range" min={0.1} max={3} step={0.1} value={speed}
						onChange={(e) => setSpeed(Number(e.target.value))}
						className="w-24"
					/>
					<span className="tabular-nums w-8">{speed.toFixed(1)}x</span>
					<Button variant={loop ? 'default' : 'outline'} size="sm" onClick={() => setLoop((l) => !l)}>
						loop
					</Button>
				</div>
			</div>

			{/* Canvas */}
			<div className="flex-1 min-h-0" style={{ background: BACKGROUND }}>
				<Canvas
					camera={{ position: [60, 50, 120], fov: 45, near: CAM_NEAR, far: CAM_FAR }}
					gl={{ antialias: true, logarithmicDepthBuffer: true }}
				>
					<color attach="background" args={[BACKGROUND]} />
					<ambientLight intensity={0.6} />
					<hemisphereLight args={['#b1c8e8', '#4a3f2f', 0.4]} />
					<directionalLight position={[10, 20, 5]} intensity={0.9} />
					<directionalLight position={[-8, 15, -10]} intensity={0.4} />

					{chosenWorld ? (
						<TrackGeometry bundle={chosenWorld.parsed} buffer={chosenWorld.originalArrayBuffer} />
					) : (
						<Grid
							args={[400, 400]}
							cellSize={5}
							cellThickness={0.5}
							sectionSize={25}
							sectionThickness={1}
							fadeDistance={1500}
							infiniteGrid
						/>
					)}

					<SceneDriver take={take} params={params} mode={mode} t01Ref={t01Ref} />

					{/* Orbit only in Inspect; in lens mode the take drives the camera. */}
					{mode === 'inspect' && (
						<OrbitControls target={params.launch} enableDamping dampingFactor={0.1} makeDefault />
					)}
				</Canvas>
			</div>
		</div>
	);
}

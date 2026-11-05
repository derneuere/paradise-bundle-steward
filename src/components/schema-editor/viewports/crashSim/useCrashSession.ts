// Everything a crash view keeps between frames and clicks: the simulator for
// one DeformationSpec (driven by the car's own handling attribs from its
// AttribSys vault), its particle effects, the rows / damage-map uniforms its
// materials read, and the controls' state. Shared by the Deformation Spec's
// Crash Preview and the Renderable view's crash test so both behave the same.

import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ParsedAttribSys } from '@/lib/core/attribSys';
import {
	applyImpact, createCrashSim, resetCrashSim, setDriver, worldDirToMesh, worldToMesh, type CrashSim, type Driver,
} from '@/lib/core/deformationSim';
import type { ParsedDeformationSpec, Vec3 } from '@/lib/core/deformationSpec';
import type { CrashInput } from '@/lib/core/vehicleSim';
import { createCrashEffects, resetCrashEffects, type CrashEffects } from '@/lib/core/crashEffects';
import { makeRowsUniform, type HeatUniform, type RowsUniform } from './deformMaterial';

const KMH = 1 / 3.6;

export type Obstacle = 'wall' | 'pole';

export type CrashSession = {
	sim: CrashSim | null;
	simRef: MutableRefObject<CrashSim | null>;
	// The 128 x vec4 deformation rows (xyz = vertex offset), refreshed from the
	// simulator every frame by useCrashStepper. Any material that draws the car
	// reads this one array.
	rows: RowsUniform;
	heat: HeatUniform;
	speedKmh: number; setSpeedKmh: (v: number) => void;
	obstacle: Obstacle; setObstacle: (v: Obstacle) => void;
	// Degrees the obstacle's face is turned off square to the car's travel.
	glance: number; setGlance: (v: number) => void;
	// The game's crash-speed thresholds lowered to 0 (its debug menu's knob).
	forceCrash: boolean; toggleForceCrash: () => void;
	// The pedals once the car has met the obstacle.
	crashInput: CrashInput; setCrashInput: (v: CrashInput) => void;
	// Who drives the car; the game picks the absorption table from it and the
	// crash, step by step.
	driver: Driver; setDriver: (v: Driver) => void;
	showPoints: boolean; togglePoints: () => void;
	showHeat: boolean; toggleHeat: () => void;
	flat: boolean; toggleFlat: () => void;
	// Crash particles, stepped with the simulator (see crashEffects).
	effects: CrashEffects;
	showParticles: boolean; toggleParticles: () => void;
	// Simulated seconds per real second: 1, slow motion, or 0 = paused.
	timeScale: number; setTimeScale: (v: number) => void;
	// Written by the stepper every frame: how far real time has run past the
	// last simulator step (lead, simulated seconds), and steps queued while
	// paused (the "step" button).
	clock: { lead: number; pendingSteps: number };
	stepOnce: () => void;
	hits: number;
	// "hinged: ... · knocked off: ..." readout, set by the stepper.
	parts: string; setParts: (s: string) => void;
	// How the current run went (see runSummary), set by the stepper.
	outcome: string; setOutcome: (s: string) => void;
	// A hit at a point on the car's body mesh (mesh frame, outward normal).
	hit: (pointMesh: Vec3, normalMesh: Vec3) => void;
	// A hit at a clicked point (world frame, outward normal), wherever the car is.
	hitAt: (pointWorld: Vec3, normalWorld: Vec3) => void;
	reset: () => void;
};

export function useCrashSession(spec: ParsedDeformationSpec | null, vault: unknown, opts: { flat: boolean }): CrashSession {
	const rows = useMemo(() => makeRowsUniform(), []);
	const heat = useMemo<HeatUniform>(() => ({ value: 0 }), []);
	// TODO(types): the workspace keeps parsed resources as `unknown`; this one is the _AT's AttribSys vault.
	const sim = useMemo(() => (spec ? createCrashSim(spec, { vault: vault as ParsedAttribSys | undefined }) : null), [spec, vault]);
	const simRef = useRef<CrashSim | null>(null);
	simRef.current = sim;

	const [speedKmh, setSpeedKmh] = useState(100);
	const [obstacle, setObstacle] = useState<Obstacle>('wall');
	const [glance, setGlance] = useState(0);
	const [forceCrash, setForceCrash] = useState(false);
	const [crashInput, setCrashInput] = useState<CrashInput>('release');
	const [driver, setDriverState] = useState<Driver>('player');
	const [showPoints, setShowPoints] = useState(false);
	const [showHeat, setShowHeat] = useState(false);
	const [flat, setFlat] = useState(opts.flat);
	const [showParticles, setShowParticles] = useState(true);
	const [timeScale, setTimeScale] = useState(1);
	// A fresh effects state for every simulator.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const effects = useMemo(() => createCrashEffects(), [sim]);
	const clock = useMemo(() => ({ lead: 0, pendingSteps: 0 }), []);
	// Counted per simulator, so a different car or spec starts at zero.
	const [hitLog, setHitLog] = useState<{ sim: CrashSim | null; n: number }>({ sim: null, n: 0 });
	const hits = hitLog.sim === sim ? hitLog.n : 0;
	const [parts, setParts] = useState('');
	const [outcome, setOutcome] = useState('');
	heat.value = showHeat ? 1 : 0;

	const hit = (pointMesh: Vec3, normalMesh: Vec3) => {
		if (!sim) return;
		setDriver(sim, driver);
		applyImpact(sim, {
			pointMesh, direction: [-normalMesh[0], -normalMesh[1], -normalMesh[2]], speed: speedKmh * KMH,
			obstacle, glance, forceCrash, crashInput,
		});
		setHitLog({ sim, n: hits + 1 });
	};

	return {
		sim, simRef, rows, heat,
		speedKmh, setSpeedKmh, obstacle, setObstacle, glance, setGlance,
		forceCrash, toggleForceCrash: () => setForceCrash((f) => !f), crashInput, setCrashInput,
		driver, setDriver: setDriverState,
		showPoints, togglePoints: () => setShowPoints((s) => !s),
		showHeat, toggleHeat: () => setShowHeat((s) => !s),
		flat, toggleFlat: () => setFlat((s) => !s),
		effects, showParticles, toggleParticles: () => setShowParticles((s) => !s),
		timeScale, setTimeScale, clock, stepOnce: () => { clock.pendingSteps++; },
		hits, parts, setParts, outcome, setOutcome,
		hit,
		hitAt: (pointWorld, normalWorld) => {
			if (sim) hit(worldToMesh(sim.state, pointWorld), worldDirToMesh(sim.state, normalWorld));
		},
		reset: () => {
			if (sim) resetCrashSim(sim);
			resetCrashEffects(effects);
			setHitLog({ sim, n: 0 });
		},
	};
}

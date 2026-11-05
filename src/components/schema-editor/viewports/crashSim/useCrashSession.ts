// Everything a crash view keeps between frames and clicks: the simulator for
// one DeformationSpec, the rows / damage-map uniforms its materials read, and
// the controls' state. Shared by the Deformation Spec's Crash Preview and the
// Renderable view's crash test so both behave the same.

import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import { AbsorptionSet, applyImpact, createCrashSim, resetCrashSim, setAbsorptionSet, type CrashSim } from '@/lib/core/deformationSim';
import type { ParsedDeformationSpec, Vec3 } from '@/lib/core/deformationSpec';
import { carAttribs } from './crashSetup';
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
	crash: boolean; setCrash: (v: boolean) => void;
	absorption: AbsorptionSet; setAbsorption: (v: AbsorptionSet) => void;
	showPoints: boolean; togglePoints: () => void;
	showHeat: boolean; toggleHeat: () => void;
	flat: boolean; toggleFlat: () => void;
	hits: number;
	// "hinged: ... · knocked off: ..." readout, set by the stepper.
	parts: string; setParts: (s: string) => void;
	hit: (pointMesh: Vec3, normalMesh: Vec3) => void;
	reset: () => void;
};

export function useCrashSession(spec: ParsedDeformationSpec | null, vault: unknown, opts: { flat: boolean }): CrashSession {
	const attribs = useMemo(() => carAttribs(vault), [vault]);
	const rows = useMemo(() => makeRowsUniform(), []);
	const heat = useMemo<HeatUniform>(() => ({ value: 0 }), []);
	const sim = useMemo(() => (spec ? createCrashSim(spec, { attribs }) : null), [spec, attribs]);
	const simRef = useRef<CrashSim | null>(null);
	simRef.current = sim;

	const [speedKmh, setSpeedKmh] = useState(80);
	const [obstacle, setObstacle] = useState<Obstacle>('wall');
	const [crash, setCrash] = useState(true);
	const [absorption, setAbsorption] = useState(AbsorptionSet.Normal);
	const [showPoints, setShowPoints] = useState(false);
	const [showHeat, setShowHeat] = useState(false);
	const [flat, setFlat] = useState(opts.flat);
	// Counted per simulator, so a different car or spec starts at zero.
	const [hitLog, setHitLog] = useState<{ sim: CrashSim | null; n: number }>({ sim: null, n: 0 });
	const hits = hitLog.sim === sim ? hitLog.n : 0;
	const [parts, setParts] = useState('');
	heat.value = showHeat ? 1 : 0;

	return {
		sim, simRef, rows, heat,
		speedKmh, setSpeedKmh, obstacle, setObstacle, crash, setCrash, absorption, setAbsorption,
		showPoints, togglePoints: () => setShowPoints((s) => !s),
		showHeat, toggleHeat: () => setShowHeat((s) => !s),
		flat, toggleFlat: () => setFlat((s) => !s),
		hits, parts, setParts,
		hit: (pointMesh, normalMesh) => {
			if (!sim) return;
			setAbsorptionSet(sim, absorption);
			applyImpact(sim, { pointMesh, direction: [-normalMesh[0], -normalMesh[1], -normalMesh[2]], speed: speedKmh * KMH, obstacle, crash });
			setHitLog({ sim, n: hits + 1 });
		},
		reset: () => {
			if (sim) resetCrashSim(sim);
			setHitLog({ sim, n: 0 });
		},
	};
}

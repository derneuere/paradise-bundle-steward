// The crash views' fixed 60 Hz stepper: advances the simulator, copies its
// rows into the shared uniform, poses the hinged / knocked-off parts and
// reports which parts came loose. Plus click-to-hit.

import { useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { partName, stepCrashSim, type CrashSim } from '@/lib/core/deformationSim';
import type { Vec3 } from '@/lib/core/deformationSpec';
import { isDragRelease } from '../selection';
import type { CrashSession } from './useCrashSession';

const STEP = 1 / 60;

// Objects drawn for a GraphicsSpec part (a group per part in the Crash
// Preview, every mesh of the part in the Renderable view). Each frame their
// matrix becomes the part's pose delta (mesh frame) times its locator, so an
// object with no pose sits exactly at its locator again.
export type PartPoser = {
	ref: (key: string, gfx: number, locator: THREE.Matrix4) => (obj: THREE.Object3D | null) => void;
	pose: (sim: CrashSim) => void;
};

export function makePartPoser(): PartPoser {
	const entries = new Map<string, { obj: THREE.Object3D; gfx: number; locator: THREE.Matrix4 }>();
	const delta = new THREE.Matrix4();
	return {
		ref: (key, gfx, locator) => (obj) => {
			if (obj) entries.set(key, { obj, gfx, locator });
			else entries.delete(key);
		},
		pose: (sim) => {
			for (const { obj, gfx, locator } of entries.values()) {
				const pose = sim.partPoses.get(gfx);
				if (pose) delta.fromArray(pose.meshDelta);
				else delta.identity();
				obj.matrix.multiplyMatrices(delta, locator);
				obj.matrixWorldNeedsUpdate = true;
			}
		},
	};
}

export function useCrashStepper(session: CrashSession, poser: PartPoser, afterStep?: (sim: CrashSim) => void) {
	const accumulator = useRef(0);
	const lastSummary = useRef('');
	useFrame((_, dt) => {
		const sim = session.simRef.current;
		if (!sim) return;
		accumulator.current = Math.min(accumulator.current + dt, 0.25);
		while (accumulator.current >= STEP) {
			stepCrashSim(sim, STEP);
			accumulator.current -= STEP;
		}
		session.rows.value.set(sim.rows);
		poser.pose(sim);
		afterStep?.(sim);
		const summary = partSummary(sim);
		if (summary !== lastSummary.current) { lastSummary.current = summary; session.setParts(summary); }
	});
}

export function crashHitHandler(onHit: (pointMesh: Vec3, normalMesh: Vec3) => void) {
	return (e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (!e.face || isDragRelease(e.nativeEvent.clientX, e.nativeEvent.clientY)) return;
		const n = e.face.normal.clone().transformDirection(e.object.matrixWorld);
		if (n.dot(e.ray.direction) > 0) n.negate();
		onHit([e.point.x, e.point.y, e.point.z], [n.x, n.y, n.z]);
	};
}

function partSummary(sim: CrashSim): string {
	const name = (p: number) => partName(sim.state.spec.ikParts[p].partType);
	const hinged = [...sim.state.hinges.keys()].map(name);
	const off = [...sim.state.free.keys()].map(name);
	return [hinged.length ? `hinged: ${hinged.join(', ')}` : '', off.length ? `knocked off: ${off.join(', ')}` : ''].filter(Boolean).join(' · ');
}

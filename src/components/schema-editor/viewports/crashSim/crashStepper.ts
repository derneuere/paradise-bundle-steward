// The crash views' fixed 60 Hz stepper: advances the simulator and its
// particle effects (at the session's time scale), copies the rows into the
// shared uniform, poses the hinged / knocked-off parts, hides smashed windows
// and reports which parts came loose and which windows broke. Plus
// click-to-hit.

import { useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { GlassState, partName, smashedPaneBits, stepCrashSim, type CrashSim } from '@/lib/core/deformationSim';
import { stepCrashEffects } from '@/lib/core/crashEffects';
import type { Vec3 } from '@/lib/core/deformationSpec';
import { isDragRelease } from '../selection';
import type { CrashSession } from './useCrashSession';

const STEP = 1 / 60;

// Objects drawn for a GraphicsSpec part (a group per part in the Crash
// Preview, every mesh of the part in the Renderable view). Each frame their
// matrix becomes the part's pose delta (mesh frame) times its locator, so an
// object with no pose sits exactly at its locator again. A window mesh (its
// mesh flags carry its pane's bit) is hidden once that pane smashes, leaving
// the hole the game leaves.
export type PartPoser = {
	ref: (key: string, gfx: number, locator: THREE.Matrix4, meshFlags?: number) => (obj: THREE.Object3D | null) => void;
	pose: (sim: CrashSim) => void;
};

export function makePartPoser(): PartPoser {
	const entries = new Map<string, { obj: THREE.Object3D; gfx: number; locator: THREE.Matrix4; flags: number }>();
	const delta = new THREE.Matrix4();
	return {
		ref: (key, gfx, locator, meshFlags = 0) => (obj) => {
			if (obj) entries.set(key, { obj, gfx, locator, flags: meshFlags & 0xff });
			else entries.delete(key);
		},
		pose: (sim) => {
			const smashed = smashedPaneBits(sim.state);
			for (const { obj, gfx, locator, flags } of entries.values()) {
				if (flags) obj.visible = (flags & smashed) === 0;
				const pose = sim.partPoses.get(gfx);
				if (pose) delta.fromArray(pose.meshDelta);
				else delta.identity();
				obj.matrix.multiplyMatrices(delta, locator);
				obj.matrixWorldNeedsUpdate = true;
			}
		},
	};
}

// Real seconds -> simulator steps at `timeScale`, plus any steps queued
// while paused; leaves the unspent remainder (simulated seconds) in `lead`.
export function advanceClock(clock: { lead: number; pendingSteps: number }, dt: number, timeScale: number): number {
	let steps = 0;
	clock.lead = Math.min(clock.lead + dt * timeScale, 0.25);
	while (clock.lead >= STEP) { steps++; clock.lead -= STEP; }
	steps += clock.pendingSteps;
	clock.pendingSteps = 0;
	return steps;
}

export function useCrashStepper(session: CrashSession, poser: PartPoser, afterStep?: (sim: CrashSim) => void) {
	const lastSummary = useRef('');
	useFrame((_, dt) => {
		const sim = session.simRef.current;
		if (!sim) return;
		const steps = advanceClock(session.clock, dt, session.timeScale);
		for (let i = 0; i < steps; i++) {
			stepCrashSim(sim, STEP);
			stepCrashEffects(session.effects, sim, STEP);
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

export function partSummary(sim: CrashSim): string {
	const name = (p: number) => partName(sim.state.spec.ikParts[p].partType);
	const hinged = [...sim.state.hinges.keys()].map(name);
	const off = [...sim.state.free.keys()].map(name);
	const panes = (state: GlassState) => sim.state.spec.glassPanes
		.filter((_, i) => sim.state.glass[i]?.state === state).map((g) => partName(g.partType));
	const cracked = panes(GlassState.Cracked), smashed = panes(GlassState.Smashed);
	return [
		hinged.length ? `hinged: ${hinged.join(', ')}` : '', off.length ? `knocked off: ${off.join(', ')}` : '',
		cracked.length ? `cracked: ${cracked.join(', ')}` : '', smashed.length ? `smashed: ${smashed.join(', ')}` : '',
	].filter(Boolean).join(' · ');
}

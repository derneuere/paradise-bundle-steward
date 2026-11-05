// Spec for how the crash views move hinged / knocked-off parts: every object
// registered for a GraphicsSpec part is drawn at (pose delta x locator), and
// an un-posed part sits exactly on its locator.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CrashSim, PartPose } from '@/lib/core/deformationSim';
import { makePartPoser } from '../crashStepper';

const simWith = (poses: [number, PartPose][]) => ({ partPoses: new Map(poses) }) as unknown as CrashSim;

describe('makePartPoser', () => {
	const locator = new THREE.Matrix4().makeTranslation(0.5, 0.2, 1.4);
	const delta = new THREE.Matrix4().makeRotationY(0.6).setPosition(0, 0.1, 0);

	it('poses every object of a hinged part by its mesh-frame delta', () => {
		const poser = makePartPoser();
		const a = new THREE.Object3D(), b = new THREE.Object3D();
		poser.ref('0-0', 7, locator)(a);
		poser.ref('0-1', 7, locator)(b);
		poser.pose(simWith([[7, { meshDelta: delta.toArray(), state: 'hinged' }]]));
		const want = delta.clone().multiply(locator);
		expect(a.matrix.equals(want)).toBe(true);
		expect(b.matrix.equals(want)).toBe(true);
		expect(a.matrixWorldNeedsUpdate).toBe(true);
	});

	it('puts parts without a pose back on their locator', () => {
		const poser = makePartPoser();
		const a = new THREE.Object3D();
		poser.ref('k', 3, locator)(a);
		poser.pose(simWith([[3, { meshDelta: delta.toArray(), state: 'detached' }]]));
		poser.pose(simWith([]));
		expect(a.matrix.equals(locator)).toBe(true);
	});

	it('forgets an object once React detaches it', () => {
		const poser = makePartPoser();
		const a = new THREE.Object3D();
		const ref = poser.ref('k', 3, locator);
		ref(a);
		ref(null);
		poser.pose(simWith([[3, { meshDelta: delta.toArray(), state: 'hinged' }]]));
		expect(a.matrix.equals(new THREE.Matrix4())).toBe(true);
	});
});

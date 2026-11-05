// Spec for how the crash views move hinged / knocked-off parts: every object
// registered for a GraphicsSpec part is drawn at (pose delta x locator), and
// an un-posed part sits exactly on its locator. Window meshes disappear once
// their pane cracks or smashes, a cracked pane shows its shattered-glass model
// with the pane's fracture constants, and the clock turns real time into simulator steps at
// the chosen slow-motion factor.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLASS_FRACTURE_UV_OFFSETS, GlassState, type CrashSim, type PartPose } from '@/lib/core/deformationSim';
import { advanceClock, makePartPoser } from '../crashStepper';
import { applyFracture, crackedGlassCopy } from '../crackedGlassMaterial';

const simWith = (poses: [number, PartPose][], brokenPartType?: number, state = GlassState.Smashed) => ({
	partPoses: new Map(poses),
	state: {
		spec: { glassPanes: brokenPartType === undefined ? [] : [{ partType: brokenPartType }] },
		glass: [{ state, crack: 0.5, width: 1.2, equalisation: 0.5 }],
	},
}) as unknown as CrashSim;

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

describe('broken windows', () => {
	it('hides a mesh flagged with the bit of a smashed pane and leaves other meshes alone', () => {
		const poser = makePartPoser();
		const windscreen = new THREE.Object3D(), side = new THREE.Object3D(), body = new THREE.Object3D();
		const locator = new THREE.Matrix4();
		poser.ref('w', 20, locator, 1 << 4)(windscreen);   // pane slot 4 = body-part type 20
		poser.ref('s', 6, locator, 1 << 0)(side);
		poser.ref('b', 20, locator, 0)(body);
		poser.pose(simWith([], 20));
		expect(windscreen.visible).toBe(false);
		expect(side.visible).toBe(true);
		expect(body.visible).toBe(true);
		poser.pose(simWith([]));
		expect(windscreen.visible).toBe(true);
	});

	it("hides a cracked pane's window meshes and shows its shattered model with the pane's fracture constants", () => {
		const poser = makePartPoser();
		const locator = new THREE.Matrix4();
		const windscreen = new THREE.Mesh();
		const material = crackedGlassCopy(new THREE.MeshStandardMaterial(), new THREE.Texture());
		const cracked = new THREE.Mesh(new THREE.BufferGeometry(), material);
		poser.ref('w', 20, locator, 1 << 4)(windscreen);
		poser.ref('c', 20, locator, 1 << 4, { bodyPartType: 20, glassIndex: 2 })(cracked);
		poser.pose(simWith([]));
		expect(windscreen.visible).toBe(true);
		expect(cracked.visible).toBe(false);
		poser.pose(simWith([], 20, GlassState.Cracked));
		expect(windscreen.visible).toBe(false);
		expect(cracked.visible).toBe(true);
		const u = material.userData.fracture;
		expect(u.uFractureStrength.value.toArray()).toEqual([1, 2, 0, 0]);
		expect(u.uFractureUvScale.value.toArray()).toEqual([1.2, 0.6, 1.2, 0.6]);
		expect(u.uFractureUvOffsets.value.toArray()).toEqual([...GLASS_FRACTURE_UV_OFFSETS[2]]);
		poser.pose(simWith([], 20, GlassState.Smashed));
		expect(windscreen.visible).toBe(false);
		expect(cracked.visible).toBe(false);
	});

	it("writes the fracture constants into a translated window shader's cb0 slots", () => {
		const cb0 = Array.from({ length: 4 }, () => new THREE.Vector4());
		const material = new THREE.ShaderMaterial({ uniforms: { cb0: { value: cb0 } } });
		material.userData.cbSlots = new Map([['g_glassFractureStrength', 1], ['g_glassFractureUVOffsets', 2], ['g_glassFractureFresnelRanges', 3]]);
		applyFracture(material, { strength: [1, 2, 0, 0], uvOffsets: [0.1, 0.2, 0.3, 0.4], uvScale: [5, 6, 7, 8] });
		expect(cb0.map((v) => v.toArray())).toEqual([[0, 0, 0, 1], [1, 2, 0, 0], [0.1, 0.2, 0.3, 0.4], [5, 6, 7, 8]]);
	});
});

describe('advanceClock', () => {
	it('runs one step per 1/60 s at real time and keeps the remainder', () => {
		const clock = { lead: 0, pendingSteps: 0 };
		expect(advanceClock(clock, 0.05, 1)).toBe(3);
		expect(clock.lead).toBeCloseTo(0, 9);
		expect(advanceClock(clock, 0.01, 1)).toBe(0);
		expect(clock.lead).toBeCloseTo(0.01, 9);
	});

	it('slows down by the time scale, stops when paused, and runs queued single steps', () => {
		const clock = { lead: 0, pendingSteps: 0 };
		expect(advanceClock(clock, 1 / 15, 0.25)).toBe(1);
		expect(advanceClock(clock, 1, 0)).toBe(0);
		clock.pendingSteps = 2;
		expect(advanceClock(clock, 1, 0)).toBe(2);
		expect(clock.pendingSteps).toBe(0);
	});
});

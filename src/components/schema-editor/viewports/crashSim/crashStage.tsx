// three.js pieces both crash views put in their Canvas besides the car: the
// obstacle, the sensor / tag markers and the camera that follows the car.
// Everything is in the simulator's world (ground at y = 0).

import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { CrashSim } from '@/lib/core/deformationSim';
import type { Vec3 } from '@/lib/core/deformationSpec';

const WALL_HEIGHT = 2;
const POLE_HEIGHT = 3;

export function CrashObstacle({ simRef }: { simRef: MutableRefObject<CrashSim | null> }) {
	const root = useRef<THREE.Group>(null);
	const wall = useRef<THREE.Mesh>(null);
	const pole = useRef<THREE.Mesh>(null);
	const q = useMemo(() => new THREE.Quaternion(), []);
	useFrame(() => {
		const sim = simRef.current;
		if (!sim || !root.current || !wall.current || !pole.current) return;
		const o = sim.state.obstacle;
		root.current.visible = !!o;
		if (!o) return;
		const n = new THREE.Vector3(...o.normal);
		wall.current.visible = o.kind === 'wall';
		pole.current.visible = o.kind === 'pole';
		// Both stand on the ground; the wall's face is the simulated plane.
		if (o.kind === 'wall') {
			wall.current.quaternion.copy(q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n));
			wall.current.position.set(o.point[0], o.point[1], o.point[2]).addScaledVector(n, 0.15);
			wall.current.position.y = WALL_HEIGHT / 2;
		} else {
			pole.current.quaternion.copy(q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...o.poleAxis)));
			pole.current.position.set(o.point[0], o.point[1], o.point[2]).addScaledVector(n, o.poleRadius);
			pole.current.position.y = POLE_HEIGHT / 2;
		}
	});
	return (
		<group ref={root} visible={false}>
			{/* The simulated wall is endless; a glancing car slides a long way along it before it stops. */}
			<mesh ref={wall}>
				<boxGeometry args={[140, WALL_HEIGHT, 0.3]} />
				<meshStandardMaterial color="#6b7280" transparent opacity={0.35} depthWrite={false} />
			</mesh>
			<mesh ref={pole}>
				<cylinderGeometry args={[0.15, 0.15, POLE_HEIGHT, 20]} />
				<meshStandardMaterial color="#9ca3af" />
			</mesh>
		</group>
	);
}

// Deformation sensors (red) and tag points (cyan), drawn through the body.
export function CrashMarkers({ sim }: { sim: CrashSim }) {
	const sensors = useRef<THREE.InstancedMesh>(null);
	const tags = useRef<THREE.InstancedMesh>(null);
	const m = useMemo(() => new THREE.Matrix4(), []);
	useFrame(() => {
		drawMarkers(sensors.current, sim.sensorPositionsWorld(), m);
		drawMarkers(tags.current, sim.tagPositionsWorld(), m);
	});
	return (
		<>
			<instancedMesh ref={sensors} args={[undefined, undefined, sim.sensorCount]} renderOrder={10} frustumCulled={false}>
				<sphereGeometry args={[0.04, 10, 8]} />
				<meshBasicMaterial color="#ff4040" depthTest={false} />
			</instancedMesh>
			<instancedMesh ref={tags} args={[undefined, undefined, sim.tagCount]} renderOrder={10} frustumCulled={false}>
				<sphereGeometry args={[0.025, 8, 6]} />
				<meshBasicMaterial color="#30d8f0" depthTest={false} />
			</instancedMesh>
		</>
	);
}

function drawMarkers(mesh: THREE.InstancedMesh | null, points: Vec3[], m: THREE.Matrix4) {
	if (!mesh) return;
	points.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p[0], p[1], p[2])));
	mesh.instanceMatrix.needsUpdate = true;
}

// Keeps the orbit camera on the car: it first centres on the car's centre of
// mass, then each frame the camera and its target move by however far that
// moved, so the user's own orbit and zoom are kept. A new run puts the car
// back at the start, and the camera jumps back with it.
export function CrashCameraFollow({ simRef }: { simRef: MutableRefObject<CrashSim | null> }) {
	// TODO(types): drei's OrbitControls registers itself as the default controls; R3F types them loosely.
	const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
	const camera = useThree((s) => s.camera);
	const last = useRef<{ sim: CrashSim; pos: THREE.Vector3 } | null>(null);
	const d = useMemo(() => new THREE.Vector3(), []);
	useFrame(() => {
		const sim = simRef.current;
		if (!sim || !controls) return;
		const p = sim.state.body.pos;
		if (!last.current || last.current.sim !== sim) {
			last.current = { sim, pos: new THREE.Vector3(p[0], p[1], p[2]) };
			d.set(p[0], p[1], p[2]).sub(controls.target);
		} else {
			d.set(p[0], p[1], p[2]).sub(last.current.pos);
			last.current.pos.set(p[0], p[1], p[2]);
		}
		if (d.lengthSq() === 0) return;
		camera.position.add(d);
		controls.target.add(d);
		controls.update();
	});
	return null;
}

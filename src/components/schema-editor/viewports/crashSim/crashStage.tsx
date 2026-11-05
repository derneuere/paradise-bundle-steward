// three.js pieces both crash views put in their Canvas besides the car: the
// obstacle and the sensor / tag markers.

import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { CrashSim } from '@/lib/core/deformationSim';
import type { Vec3 } from '@/lib/core/deformationSpec';

// The obstacle stays put while the car moves into it; the scene keeps the
// car fixed, so the obstacle is drawn relative to it.
export function CrashObstacle({ simRef }: { simRef: MutableRefObject<CrashSim | null> }) {
	const root = useRef<THREE.Group>(null);
	const wall = useRef<THREE.Mesh>(null);
	const pole = useRef<THREE.Mesh>(null);
	const q = useMemo(() => new THREE.Quaternion(), []);
	useFrame(() => {
		const sim = simRef.current;
		if (!sim || !root.current || !wall.current || !pole.current) return;
		const o = sim.obstacleMesh();
		root.current.visible = !!o;
		if (!o) return;
		const n = new THREE.Vector3(...o.normal);
		wall.current.visible = o.kind === 'wall';
		pole.current.visible = o.kind === 'pole';
		// Upright obstacles stand on the ground rather than centring on the hit.
		const upright = Math.abs(n.y) < 0.5;
		if (o.kind === 'wall') {
			wall.current.quaternion.copy(q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n));
			wall.current.position.set(...o.point).addScaledVector(n, 0.15);
			if (upright) wall.current.position.y = sim.groundMesh + 1;
		} else {
			pole.current.quaternion.copy(q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...o.poleAxis)));
			pole.current.position.set(...o.point).addScaledVector(n, o.poleRadius);
			if (upright) pole.current.position.y = sim.groundMesh + 1.5;
		}
	});
	return (
		<group ref={root} visible={false}>
			{/* The simulated wall is endless; a long one keeps a glancing car beside it. */}
			<mesh ref={wall}>
				<boxGeometry args={[24, 2, 0.3]} />
				<meshStandardMaterial color="#6b7280" transparent opacity={0.35} depthWrite={false} />
			</mesh>
			<mesh ref={pole}>
				<cylinderGeometry args={[0.15, 0.15, 3, 20]} />
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
		drawMarkers(sensors.current, sim.sensorPositionsMesh(), m);
		drawMarkers(tags.current, sim.tagPositionsMesh(), m);
	});
	return (
		<>
			<instancedMesh ref={sensors} args={[undefined, undefined, sim.sensorCount]} renderOrder={10}>
				<sphereGeometry args={[0.04, 10, 8]} />
				<meshBasicMaterial color="#ff4040" depthTest={false} />
			</instancedMesh>
			<instancedMesh ref={tags} args={[undefined, undefined, sim.tagCount]} renderOrder={10}>
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

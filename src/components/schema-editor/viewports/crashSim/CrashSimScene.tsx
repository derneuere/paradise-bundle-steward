// three.js side of the crash simulator: the body parts (deformed by the sim's
// rows, posed and tinted by their hinge/detach state), the obstacle,
// click-to-hit picking and optional sensor / tag-point markers. The sim steps
// at a fixed 60 Hz inside useFrame.

import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { partName, stepCrashSim, type CrashSim } from '@/lib/core/deformationSim';
import type { Vec3 } from '@/lib/core/deformationSpec';
import type { CrashBody } from './crashBody';
import { isSkinned, makeDeformMaterial, type HeatUniform, type RowsUniform } from './deformMaterial';

const STEP = 1 / 60;
const COLORS = { paint: '#c8352b', hinged: '#e8b23a', detached: '#3ab0e8' };

type Props = {
	body: CrashBody;
	simRef: MutableRefObject<CrashSim | null>;
	rows: RowsUniform;
	heat: HeatUniform;
	showPoints: boolean;
	onHit: (pointMesh: Vec3, normalMesh: Vec3) => void;
	// Called when the set of hinged / knocked-off parts changes.
	onParts: (summary: string) => void;
};

export function CrashSimScene({ body, simRef, rows, heat, showPoints, onHit, onParts }: Props) {
	const groups = useRef(new Map<number, THREE.Group>());
	const accumulator = useRef(0);
	const lastSummary = useRef('');
	const materials = useMemo(() => ({
		paint: makeDeformMaterial(rows, COLORS.paint, heat),
		hinged: makeDeformMaterial(rows, COLORS.hinged, heat),
		detached: makeDeformMaterial(rows, COLORS.detached, heat),
		plain: new THREE.MeshStandardMaterial({ color: '#2a2f38', roughness: 0.8, side: THREE.DoubleSide }),
	}), [rows, heat]);
	const sensorMesh = useRef<THREE.InstancedMesh>(null);
	const tagMesh = useRef<THREE.InstancedMesh>(null);
	const obstacle = useRef<THREE.Group>(null);
	const wall = useRef<THREE.Mesh>(null);
	const pole = useRef<THREE.Mesh>(null);
	const scratch = useMemo(() => ({ m: new THREE.Matrix4(), d: new THREE.Matrix4(), q: new THREE.Quaternion() }), []);

	useFrame((_, dt) => {
		const sim = simRef.current;
		if (!sim) return;
		accumulator.current = Math.min(accumulator.current + dt, 0.25);
		while (accumulator.current >= STEP) {
			stepCrashSim(sim, STEP);
			accumulator.current -= STEP;
		}
		rows.value.set(sim.rows);
		for (const part of body.parts) {
			const g = groups.current.get(part.gfx);
			if (!g) continue;
			const pose = sim.partPoses.get(part.gfx);
			if (pose) scratch.d.fromArray(pose.meshDelta);
			else scratch.d.identity();
			g.matrix.multiplyMatrices(scratch.d, part.locator);
			g.matrixWorldNeedsUpdate = true;
			const mat = pose ? materials[pose.state] : materials.paint;
			for (const child of g.children) {
				const mesh = child as THREE.Mesh;
				if (isSkinned(mesh.geometry)) mesh.material = mat;
			}
		}
		placeObstacle(sim, obstacle.current, wall.current, pole.current, scratch.q);
		const summary = partSummary(sim);
		if (summary !== lastSummary.current) { lastSummary.current = summary; onParts(summary); }
		if (showPoints) {
			drawMarkers(sensorMesh.current, sim.sensorPositionsMesh(), scratch.m);
			drawMarkers(tagMesh.current, sim.tagPositionsMesh(), scratch.m);
		}
	});

	const hit = (e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (!e.face) return;
		const n = e.face.normal.clone().transformDirection(e.object.matrixWorld);
		if (n.dot(e.ray.direction) > 0) n.negate();
		onHit([e.point.x, e.point.y, e.point.z], [n.x, n.y, n.z]);
	};

	return (
		<group>
			{body.parts.map((part) => (
				<group
					key={part.gfx}
					matrixAutoUpdate={false}
					matrix={part.locator}
					ref={(g) => { if (g) groups.current.set(part.gfx, g); else groups.current.delete(part.gfx); }}
				>
					{part.geometries.map((geometry, i) => (
						<mesh key={i} geometry={geometry} material={isSkinned(geometry) ? materials.paint : materials.plain} onClick={hit} />
					))}
				</group>
			))}
			<group ref={obstacle} visible={false}>
				<mesh ref={wall}>
					<boxGeometry args={[4, 2, 0.3]} />
					<meshStandardMaterial color="#6b7280" transparent opacity={0.35} />
				</mesh>
				<mesh ref={pole}>
					<cylinderGeometry args={[0.15, 0.15, 3, 20]} />
					<meshStandardMaterial color="#9ca3af" />
				</mesh>
			</group>
			{showPoints && simRef.current && (
				<>
					<instancedMesh ref={sensorMesh} args={[undefined, undefined, simRef.current.sensorCount]}>
						<sphereGeometry args={[0.04, 10, 8]} />
						<meshBasicMaterial color="#ff4040" depthTest={false} />
					</instancedMesh>
					<instancedMesh ref={tagMesh} args={[undefined, undefined, simRef.current.tagCount]}>
						<sphereGeometry args={[0.025, 8, 6]} />
						<meshBasicMaterial color="#30d8f0" depthTest={false} />
					</instancedMesh>
				</>
			)}
		</group>
	);
}

// The obstacle stays put while the car moves into it; the scene keeps the
// car fixed, so the obstacle is drawn relative to it.
function placeObstacle(sim: CrashSim, root: THREE.Group | null, wall: THREE.Mesh | null, pole: THREE.Mesh | null, q: THREE.Quaternion) {
	if (!root || !wall || !pole) return;
	const o = sim.obstacleMesh();
	root.visible = !!o;
	if (!o) return;
	const n = new THREE.Vector3(...o.normal);
	wall.visible = o.kind === 'wall';
	pole.visible = o.kind === 'pole';
	// Upright obstacles stand on the ground rather than centring on the hit.
	const upright = Math.abs(n.y) < 0.5;
	if (o.kind === 'wall') {
		wall.quaternion.copy(q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n));
		wall.position.set(...o.point).addScaledVector(n, 0.15);
		if (upright) wall.position.y = sim.groundMesh + 1;
	} else {
		pole.quaternion.copy(q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...o.poleAxis)));
		pole.position.set(...o.point).addScaledVector(n, o.poleRadius);
		if (upright) pole.position.y = sim.groundMesh + 1.5;
	}
}

function partSummary(sim: CrashSim): string {
	const name = (p: number) => partName(sim.state.spec.ikParts[p].partType);
	const hinged = [...sim.state.hinges.keys()].map(name);
	const off = [...sim.state.free.keys()].map(name);
	return [hinged.length ? `hinged: ${hinged.join(', ')}` : '', off.length ? `knocked off: ${off.join(', ')}` : ''].filter(Boolean).join(' · ');
}

function drawMarkers(mesh: THREE.InstancedMesh | null, points: Vec3[], m: THREE.Matrix4) {
	if (!mesh) return;
	points.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p[0], p[1], p[2])));
	mesh.instanceMatrix.needsUpdate = true;
}

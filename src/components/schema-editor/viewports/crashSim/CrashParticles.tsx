// Draws the crash effects (sparks, debris, glass, dust, smoke) both crash
// views share. The effects live in the simulator's world frame while the
// views keep the car still, so the whole batch is drawn through the
// world -> car-mesh transform, like the obstacle.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vec3 } from '@/lib/core/deformationSpec';
import {
	CRASH_SPARKS, DEBRIS_FADE_OUT, DEBRIS_MESH_RADIUS, debrisFade, DebrisKind, puffLook, sparkPosition, type CrashEffects, type Puff,
} from '@/lib/core/crashEffects';
import type { CrashSim } from '@/lib/core/deformationSim';
import { useDisposeOnDepsChange } from '@/hooks/useDisposeOnDepsChange';
import { chipGeometry, puffGeometry, puffMaterial, ribbonGeometry, setQuad, shardGeometry, sparkMaterial } from './particleMaterials';
import type { ParticleTextures } from './particleTextures';
import type { CrashSession } from './useCrashSession';

const SPARK_CAP = 4000;
const PUFF_CAP = 600;
const KINDS = [DebrisKind.Coloured, DebrisKind.Shiny, DebrisKind.Dark, DebrisKind.HighDetail, DebrisKind.Glass];

// world -> mesh frame: undo the car's pose, then the handling -> mesh shift.
function worldToMesh(sim: CrashSim, out: THREE.Matrix4): THREE.Matrix4 {
	const r = sim.state.carRot, p = sim.state.carPos, sh = sim.meshShift;
	out.set(r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, 0, 0, 0, 1);
	const t = new THREE.Vector3(...p).applyMatrix4(out);
	out.setPosition(-t.x - sh[0], -t.y - sh[1], -t.z - sh[2]);
	return out;
}

export function CrashParticles({ session, paint, textures }: { session: CrashSession; paint: Vec3; textures: ParticleTextures }) {
	const root = useRef<THREE.Group>(null);
	const parts = useMemo(() => {
		const debrisMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3 });
		const glassMat = new THREE.MeshStandardMaterial({ color: '#dfeef5', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.75 });
		const chip = chipGeometry(), shard = shardGeometry();
		const debris = KINDS.map((k) => {
			const mesh = new THREE.InstancedMesh(k === DebrisKind.Glass ? shard : chip, k === DebrisKind.Glass ? glassMat : debrisMat, session.effects.debris[k].budget);
			mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			mesh.setColorAt(0, new THREE.Color());
			mesh.frustumCulled = false;
			mesh.count = 0;
			return mesh;
		});
		return {
			sparks: new THREE.Mesh(ribbonGeometry(SPARK_CAP), sparkMaterial(textures.spark)),
			puffs: new THREE.Mesh(puffGeometry(PUFF_CAP), puffMaterial(textures.smoke)),
			debris, debrisMat, glassMat, chip, shard,
		};
	}, [session.effects, textures]);
	useDisposeOnDepsChange(() => {
		for (const m of [parts.sparks, parts.puffs]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
		for (const m of parts.debris) m.dispose();
		parts.debrisMat.dispose(); parts.glassMat.dispose(); parts.chip.dispose(); parts.shard.dispose();
	}, [parts]);

	const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), axis: new THREE.Vector3(), c: new THREE.Color(), a: [0, 0, 0] as Vec3, b: [0, 0, 0] as Vec3 }), []);

	useFrame(() => {
		const sim = session.simRef.current, g = root.current;
		if (!sim || !g) return;
		g.visible = session.showParticles;
		if (!session.showParticles) return;
		const fx = session.effects;
		fx.paint = paint;
		g.matrix.copy(worldToMesh(sim, tmp.m));
		g.matrixWorldNeedsUpdate = true;
		// Analytic particles are drawn between simulator steps too, so slow
		// motion stays smooth.
		const now = fx.time + session.clock.lead;
		drawSparks(fx, now, sim.state.carVel, parts.sparks.geometry, tmp.a, tmp.b);
		drawPuffs([...fx.smoke.items, ...fx.dust.items], now, parts.puffs.geometry);
		KINDS.forEach((k, i) => drawDebris(fx, k, now, parts.debris[i], tmp));
	});

	return (
		<group ref={root} matrixAutoUpdate={false}>
			<primitive object={parts.sparks} />
			{parts.debris.map((m, i) => <primitive key={i} object={m} />)}
			<primitive object={parts.puffs} />
		</group>
	);
}

// The game blurs each spark over the camera's last 25 ms, and its camera
// rides with the car; here the view rides with the car, so the streak's tail
// is where the spark was relative to the car back then.
function drawSparks(fx: CrashEffects, now: number, carVel: Vec3, geo: THREE.BufferGeometry, a: Vec3, b: Vec3): void {
	const A = geo.getAttribute('position') as THREE.BufferAttribute, B = geo.getAttribute('b') as THREE.BufferAttribute;
	const C = geo.getAttribute('rgba') as THREE.BufferAttribute, W = geo.getAttribute('width') as THREE.BufferAttribute;
	let n = 0;
	for (const s of fx.sparks.items) {
		const t = now - s.birth;
		if (t < 0 || t >= s.life || n >= SPARK_CAP) continue;
		const back = Math.min(CRASH_SPARKS.blurTime, t);
		sparkPosition(s, t - back, a);
		sparkPosition(s, t, b);
		for (let k = 0; k < 3; k++) a[k] += carVel[k] * back;
		const c = CRASH_SPARKS.colours[s.colour];
		setQuad(A, n, a[0], a[1], a[2]);
		setQuad(B, n, b[0], b[1], b[2]);
		setQuad(C, n, c[0], c[1], c[2], 1);
		setQuad(W, n, s.size * CRASH_SPARKS.radius);
		n++;
	}
	for (const x of [A, B, C, W]) x.needsUpdate = true;
	geo.setDrawRange(0, n * 6);
}

function drawPuffs(puffs: Puff[], now: number, geo: THREE.BufferGeometry): void {
	const P = geo.getAttribute('position') as THREE.BufferAttribute, C = geo.getAttribute('rgba') as THREE.BufferAttribute;
	const S = geo.getAttribute('size') as THREE.BufferAttribute, R = geo.getAttribute('angle') as THREE.BufferAttribute;
	let n = 0;
	for (const p of puffs) {
		const t = now - p.birth;
		if (t < 0 || t >= p.life || n >= PUFF_CAP) continue;
		const look = puffLook(p, t);
		setQuad(P, n, ...look.pos);
		setQuad(C, n, ...look.rgba);
		setQuad(S, n, look.size);
		setQuad(R, n, look.angle);
		n++;
	}
	for (const x of [P, C, S, R]) x.needsUpdate = true;
	geo.setDrawRange(0, n * 6);
}

type Tmp = { m: THREE.Matrix4; q: THREE.Quaternion; v: THREE.Vector3; s: THREE.Vector3; axis: THREE.Vector3; c: THREE.Color };

function drawDebris(fx: CrashEffects, kind: DebrisKind, now: number, mesh: THREE.InstancedMesh, tmp: Tmp): void {
	const items = fx.debris[kind].items;
	let n = 0;
	const lead = now - fx.time;
	for (const d of items) {
		const age = now - d.birth;
		// Fades by shrinking: the instanced material has one opacity. The
		// chip / shard meshes have radius 0.5.
		const k = 2 * DEBRIS_MESH_RADIUS[kind] * d.size * debrisFade(d, age, DEBRIS_FADE_OUT);
		if (k <= 0) continue;
		tmp.v.set(d.p[0] + d.v[0] * lead, d.p[1] + d.v[1] * lead, d.p[2] + d.v[2] * lead);
		tmp.q.setFromAxisAngle(tmp.axis.set(...d.axis), d.angle);
		mesh.setMatrixAt(n, tmp.m.compose(tmp.v, tmp.q, tmp.s.setScalar(k)));
		mesh.setColorAt(n, tmp.c.setRGB(d.colour[0], d.colour[1], d.colour[2]));
		n++;
	}
	mesh.count = n;
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

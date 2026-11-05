// Draws the crash debris (body chips, big body bits, glass) as instanced
// meshes. With PARTICLES.BUNDLE loaded each piece is the game's own mesh for
// its place in its batch of 32, at its size as the mesh's scale; without it a
// stand-in chip / shard is drawn at the collection's mean bounding radius.
// A new piece grows in over its preset's fade-in and its alpha fades out over
// its last 0.8 s, as the game draws them. Lives inside CrashParticles' group,
// so it draws in the simulator's world frame.

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
	DEBRIS_FADE_OUT, DEBRIS_MESH_RADIUS, debrisAlpha, debrisGrowth, DebrisKind, type CrashEffects,
} from '@/lib/core/crashEffects';
import { DEBRIS_PRESETS } from '@/lib/core/crashEffects/tables';
import { meshForSlot, type VFXMeshSet } from '@/lib/core/vfxMeshCollectionMeshes';
import { useDisposeOnDepsChange } from '@/hooks/useDisposeOnDepsChange';
import { chipGeometry, shardGeometry } from './particleMaterials';
import { debrisMaterial, vfxMeshGeometry, type DebrisLooks } from './debrisLooks';
import type { CrashSession } from './useCrashSession';

const KINDS = [DebrisKind.Coloured, DebrisKind.Shiny, DebrisKind.Dark, DebrisKind.HighDetail, DebrisKind.Glass];

type KindDraw = {
	kind: DebrisKind;
	set: VFXMeshSet | null;  // null: one stand-in mesh
	standInScale: number;    // stand-in chips have radius 0.5
	material: THREE.MeshPhongMaterial;
	meshes: THREE.InstancedMesh[];
};

function buildKinds(fx: CrashEffects, looks: DebrisLooks): KindDraw[] {
	return KINDS.map((kind) => {
		const look = looks.get(DEBRIS_PRESETS[kind].mesh);
		const budget = fx.debris[kind].budget;
		const material = debrisMaterial(kind, look);
		const geometries = look
			? look.set.meshes.map(vfxMeshGeometry)
			: [kind === DebrisKind.Glass ? shardGeometry() : chipGeometry()];
		const meshes = geometries.map((g) => {
			const alpha = new THREE.InstancedBufferAttribute(new Float32Array(budget), 1);
			alpha.setUsage(THREE.DynamicDrawUsage);
			g.setAttribute('instanceAlpha', alpha);
			const mesh = new THREE.InstancedMesh(g, material, budget);
			mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			mesh.setColorAt(0, new THREE.Color());
			mesh.frustumCulled = false;
			mesh.count = 0;
			return mesh;
		});
		return { kind, set: look?.set ?? null, standInScale: look ? 1 : 2 * DEBRIS_MESH_RADIUS[kind], material, meshes };
	});
}

type Tmp = { m: THREE.Matrix4; q: THREE.Quaternion; v: THREE.Vector3; s: THREE.Vector3; axis: THREE.Vector3; c: THREE.Color; n: number[] };

function drawKind(fx: CrashEffects, k: KindDraw, now: number, tmp: Tmp): void {
	const lead = now - fx.time;
	const n = tmp.n;
	n.length = k.meshes.length;
	n.fill(0);
	for (const d of fx.debris[k.kind].items) {
		const age = now - d.birth;
		const grow = debrisGrowth(d, age), alpha = debrisAlpha(d, age, DEBRIS_FADE_OUT);
		if (grow <= 0 || alpha <= 0) continue;
		const which = k.set ? meshForSlot(k.set, d.slot) : 0;
		if (which < 0) continue;
		const mesh = k.meshes[which], i = n[which]++;
		tmp.v.set(d.p[0] + d.v[0] * lead, d.p[1] + d.v[1] * lead, d.p[2] + d.v[2] * lead);
		tmp.q.setFromAxisAngle(tmp.axis.set(...d.axis), d.angle);
		mesh.setMatrixAt(i, tmp.m.compose(tmp.v, tmp.q, tmp.s.setScalar(d.size * grow * k.standInScale)));
		mesh.setColorAt(i, tmp.c.setRGB(d.colour[0], d.colour[1], d.colour[2]));
		(mesh.geometry.getAttribute('instanceAlpha') as THREE.InstancedBufferAttribute).setX(i, alpha);
	}
	k.meshes.forEach((mesh, j) => {
		mesh.count = n[j];
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		mesh.geometry.getAttribute('instanceAlpha').needsUpdate = true;
	});
}

export function CrashDebris({ session, looks }: { session: CrashSession; looks: DebrisLooks }) {
	const kinds = useMemo(() => buildKinds(session.effects, looks), [session.effects, looks]);
	useDisposeOnDepsChange(() => {
		for (const k of kinds) {
			for (const m of k.meshes) { m.geometry.dispose(); m.dispose(); }
			k.material.dispose();
		}
	}, [kinds]);
	const tmp = useMemo<Tmp>(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), axis: new THREE.Vector3(), c: new THREE.Color(), n: [] }), []);

	useFrame(() => {
		if (!session.showParticles) return;
		const fx = session.effects, now = fx.time + session.clock.lead;
		for (const k of kinds) drawKind(fx, k, now, tmp);
	});

	return <>{kinds.flatMap((k) => k.meshes.map((m, i) => <primitive key={`${k.kind}-${i}`} object={m} />))}</>;
}

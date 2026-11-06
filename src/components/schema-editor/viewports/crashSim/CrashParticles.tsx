// Draws the crash effects (sparks, debris, glass, dust, smoke) both crash
// views share, in the simulator's world frame like everything else.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vec3 } from '@/lib/core/deformationSpec';
import { CRASH_SPARKS, puffLook, sparkPosition, type CrashEffects, type Puff } from '@/lib/core/crashEffects';
import { useDisposeOnDepsChange } from '@/hooks/useDisposeOnDepsChange';
import { CrashDebris } from './CrashDebris';
import { puffGeometry, puffMaterial, ribbonGeometry, setQuad, sparkMaterial } from './particleMaterials';
import type { ParticleTextures } from './particleTextures';
import type { CrashSession } from './useCrashSession';

const SPARK_CAP = 4000;
const PUFF_CAP = 600;

export function CrashParticles({ session, paint, textures }: { session: CrashSession; paint: Vec3; textures: ParticleTextures }) {
	const root = useRef<THREE.Group>(null);
	const parts = useMemo(() => ({
		sparks: new THREE.Mesh(ribbonGeometry(SPARK_CAP), sparkMaterial(textures.spark)),
		puffs: new THREE.Mesh(puffGeometry(PUFF_CAP), puffMaterial(textures.smoke)),
	}), [textures]);
	useDisposeOnDepsChange(() => {
		for (const m of [parts.sparks, parts.puffs]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
	}, [parts]);

	const tmp = useMemo(() => ({ a: [0, 0, 0] as Vec3, b: [0, 0, 0] as Vec3 }), []);

	useFrame(() => {
		const sim = session.simRef.current, g = root.current;
		if (!sim || !g) return;
		g.visible = session.showParticles;
		if (!session.showParticles) return;
		const fx = session.effects;
		fx.paint = paint;
		// Analytic particles are drawn between simulator steps too, so slow
		// motion stays smooth.
		const now = fx.time + session.clock.lead;
		drawSparks(fx, now, sim.state.body.v, parts.sparks.geometry, tmp.a, tmp.b);
		drawPuffs([...fx.smoke.items, ...fx.dust.items], now, parts.puffs.geometry);
	});

	return (
		<group ref={root}>
			<primitive object={parts.sparks} />
			<CrashDebris session={session} looks={textures.debris} />
			<primitive object={parts.puffs} />
		</group>
	);
}

// The game blurs each spark over the camera's last 25 ms, and its camera
// rides with the car; so does the preview's, so the streak's tail is where the
// spark was relative to the car back then.
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

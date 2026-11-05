// The Crash Preview's car: the body parts in flat paint, deformed by the
// sim's rows, posed and tinted by their hinge/detach state, plus the shared
// obstacle, markers and crash particles.

import { useMemo } from 'react';
import * as THREE from 'three';
import type { CrashSim } from '@/lib/core/deformationSim';
import { useDisposeOnDepsChange } from '@/hooks/useDisposeOnDepsChange';
import type { CrashBody } from './crashBody';
import { isSkinned, makeDeformMaterial } from './deformMaterial';
import { CrashMarkers, CrashObstacle } from './crashStage';
import { CrashParticles } from './CrashParticles';
import type { ParticleTextures } from './particleTextures';
import { crashHitHandler, makePartPoser, useCrashStepper } from './crashStepper';
import type { CrashSession } from './useCrashSession';

const IDENTITY = new THREE.Matrix4();
const COLORS = { paint: '#c8352b', hinged: '#e8b23a', detached: '#3ab0e8' };
const PAINT = new THREE.Color(COLORS.paint).toArray() as [number, number, number];

export function CrashSimScene({ body, session, textures }: { body: CrashBody; session: CrashSession; textures: ParticleTextures }) {
	const { rows, heat, flat } = session;
	const materials = useMemo(() => ({
		paint: makeDeformMaterial(rows, COLORS.paint, heat, flat),
		hinged: makeDeformMaterial(rows, COLORS.hinged, heat, flat),
		detached: makeDeformMaterial(rows, COLORS.detached, heat, flat),
		plain: new THREE.MeshStandardMaterial({ color: '#2a2f38', roughness: 0.8, side: THREE.DoubleSide }),
	}), [rows, heat, flat]);
	useDisposeOnDepsChange(() => { for (const m of Object.values(materials)) m.dispose(); }, [materials]);
	const poser = useMemo(() => makePartPoser(), []);
	const groups = useMemo(() => new Map<number, THREE.Group>(), []);

	useCrashStepper(session, poser, (sim: CrashSim) => {
		for (const [gfx, g] of groups) {
			const pose = sim.partPoses.get(gfx);
			const mat = pose ? materials[pose.state] : materials.paint;
			for (const child of g.children) {
				const mesh = child as THREE.Mesh;
				if (isSkinned(mesh.geometry)) mesh.material = mat;
			}
		}
	});
	const hit = crashHitHandler(session.hit);

	return (
		<group>
			{body.parts.map((part) => {
				const pose = poser.ref(String(part.gfx), part.gfx, part.locator);
				return (
					<group
						key={part.gfx}
						matrixAutoUpdate={false}
						matrix={part.locator}
						ref={(g) => { pose(g); if (g) groups.set(part.gfx, g); else groups.delete(part.gfx); }}
					>
						{part.geometries.map((geometry, i) => (
							<mesh
								key={i}
								geometry={geometry}
								material={isSkinned(geometry) ? materials.paint : materials.plain}
								onClick={hit}
								// Windows: posed with their part's group, hidden on their own once smashed.
								ref={part.meshFlags[i] & 0xff ? poser.ref(`${part.gfx}:${i}`, -1, IDENTITY, part.meshFlags[i]) : undefined}
								matrixAutoUpdate={!(part.meshFlags[i] & 0xff)}
							/>
						))}
					</group>
				);
			})}
			<CrashObstacle simRef={session.simRef} />
			{session.showPoints && session.sim && <CrashMarkers sim={session.sim} />}
			<CrashParticles session={session} paint={PAINT} textures={textures} />
		</group>
	);
}

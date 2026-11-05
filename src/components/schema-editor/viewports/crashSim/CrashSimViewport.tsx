// Crash preview for a vehicle DeformationSpec (_AT): runs the game's
// deformation pipeline on the matching body (_GR) loaded in the workspace, so
// a rig can be judged without starting the game. Click the car to hit it, or
// use a preset; the speed slider sets the closing speed. The Renderable view
// of the body offers the same crash on the textured car.

import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useSchemaEditor } from '../../context';
import type { ParsedDeformationSpec } from '@/lib/core/deformationSpec';
import { decodeCrashBody, hasGraphicsSpec } from './crashBody';
import { pickTwin } from './crashSetup';
import { CrashControls } from './CrashControls';
import { CrashSimScene } from './CrashSimScene';
import { useCrashSession } from './useCrashSession';
import { particleTextures } from './particleTextures';

const BACKGROUND = '#15171c';

export function CrashSimViewport() {
	const { data } = useSchemaEditor();
	const { bundles, selection } = useWorkspace();
	const spec = data as ParsedDeformationSpec;

	const bodyBundles = useMemo(() => bundles.filter((b) => hasGraphicsSpec(b.parsed)), [bundles]);
	const [chosenId, setChosenId] = useState('');
	const bodyBundle = pickTwin(bodyBundles, selection?.bundleId, 'GR', chosenId);
	const body = useMemo(
		() => (bodyBundle ? decodeCrashBody(bodyBundle.parsed, bodyBundle.originalArrayBuffer) : null),
		[bodyBundle],
	);
	const specBundle = bundles.find((b) => b.id === selection?.bundleId);
	const session = useCrashSession(spec, specBundle?.parsedResources.get('attribSysVault'), { flat: true });
	const textures = useMemo(() => particleTextures(bundles), [bundles]);

	if (!body) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
				Load the car's body bundle (VEH_*_GR.BIN) into the workspace to preview crashes.
			</div>
		);
	}
	const center = body.box.getCenter(body.box.min.clone());
	const size = body.box.getSize(body.box.min.clone()).length();

	return (
		<div className="h-full flex flex-col min-h-0">
			<CrashControls session={session} spec={spec} box={body.box} skinRows={body.skinRows} title="Crash Preview">
				<span className="font-medium">body:</span>
				<select value={bodyBundle?.id ?? ''} onChange={(e) => setChosenId(e.target.value)} className="bg-muted rounded px-1 py-0.5 max-w-[200px]">
					{bodyBundles.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
				</select>
			</CrashControls>
			<div className="flex-1 min-h-0" style={{ background: BACKGROUND }}>
				<Canvas camera={{ position: [center.x + size * 1.1, center.y + size * 0.55, center.z + size * 1.1], fov: 40, near: 0.05, far: 500 }}>
					<color attach="background" args={[BACKGROUND]} />
					<ambientLight intensity={0.5} />
					<hemisphereLight args={['#c8d8f0', '#3a3228', 0.5]} />
					<directionalLight position={[6, 10, 4]} intensity={1.2} />
					<directionalLight position={[-6, 6, -8]} intensity={0.5} />
					<Grid args={[40, 40]} position={[0, session.sim?.groundMesh ?? 0, 0]} cellSize={0.5} sectionSize={2.5} fadeDistance={30} infiniteGrid />
					<CrashSimScene body={body} session={session} textures={textures} />
					<OrbitControls target={center} enableDamping dampingFactor={0.1} makeDefault />
				</Canvas>
			</div>
		</div>
	);
}

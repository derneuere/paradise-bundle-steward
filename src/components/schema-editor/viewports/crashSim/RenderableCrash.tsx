// The Renderable view's crash-test controls and in-Canvas rig (see
// useRenderableCrash).

import { useMemo } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';

import { Button } from '@/components/ui/button';
import type { DecodeMode } from '@/lib/core/renderableDecode';
import { CrashControls } from './CrashControls';
import { CrashCameraFollow, CrashMarkers, CrashObstacle } from './crashStage';
import { CrashParticles } from './CrashParticles';
import { particleTextures } from './particleTextures';
import type { Vec3 } from '@/lib/core/deformationSpec';
import { useCrashStepper, type PartPoser } from './crashStepper';
import type { CrashSession } from './useCrashSession';
import type { RenderableCrash } from './useRenderableCrash';

export function RenderableCrashPanel({ crash, setDecodeMode }: { crash: RenderableCrash; setDecodeMode: (m: DecodeMode) => void }) {
	if (!crash.enabled || !crash.spec) return null;
	if (!crash.body) {
		return (
			<div className="shrink-0 px-3 py-2 border-b text-xs text-muted-foreground flex items-center gap-2">
				The crash test poses GraphicsSpec parts.
				<Button variant="outline" size="sm" onClick={() => setDecodeMode('graphics')}>switch source to GraphicsSpec</Button>
			</div>
		);
	}
	return (
		<CrashControls session={crash.session} spec={crash.spec} box={crash.body.box} skinRows={crash.body.skinRows} title="Crash test">
			<span className="font-medium">spec:</span>
			<select value={crash.specBundle?.id ?? ''} onChange={(e) => crash.chooseSpec(e.target.value)} className="bg-muted rounded px-1 py-0.5 max-w-[200px]">
				{crash.specBundles.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
			</select>
		</CrashControls>
	);
}

// Inside the Canvas: steps the simulator, poses the registered meshes in the
// world, draws the obstacle and markers and keeps the camera on the car.
const GREY_PAINT: Vec3 = [0.6, 0.62, 0.65];

// `paint` is the car's colour (paint-coloured debris), when the view has one.
export function RenderableCrashRig({ crash, paint }: { crash: RenderableCrash; paint: Vec3 | null }) {
	const { session, deform } = crash;
	if (!deform) return null;
	return <CrashRigInner session={session} poser={deform.poser} paint={paint ?? GREY_PAINT} />;
}

function CrashRigInner({ session, poser, paint }: { session: CrashSession; poser: PartPoser; paint: Vec3 }) {
	const { bundles } = useWorkspace();
	const textures = useMemo(() => particleTextures(bundles), [bundles]);
	useCrashStepper(session, poser);
	return (
		<>
			<CrashObstacle simRef={session.simRef} />
			<CrashCameraFollow simRef={session.simRef} />
			{session.showPoints && session.sim && <CrashMarkers sim={session.sim} />}
			<CrashParticles session={session} paint={paint} textures={textures} />
		</>
	);
}

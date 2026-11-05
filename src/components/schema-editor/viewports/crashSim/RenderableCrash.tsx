// The Renderable view's crash-test controls and in-Canvas rig (see
// useRenderableCrash).

import { Button } from '@/components/ui/button';
import type { DecodeMode } from '@/lib/core/renderableDecode';
import { CrashControls } from './CrashControls';
import { CrashMarkers, CrashObstacle } from './crashStage';
import { useCrashStepper, type PartPoser } from './crashStepper';
import type { CrashSession } from './useCrashSession';
import type { RenderableCrash } from './useRenderableCrash';

export function RenderableCrashPanel({ crash, setDecodeMode, translated }: { crash: RenderableCrash; setDecodeMode: (m: DecodeMode) => void; translated: boolean }) {
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
		<>
			<CrashControls session={crash.session} spec={crash.spec} box={crash.body.box} skinRows={crash.body.skinRows} title="Crash test">
				<span className="font-medium">spec:</span>
				<select value={crash.specBundle?.id ?? ''} onChange={(e) => crash.chooseSpec(e.target.value)} className="bg-muted rounded px-1 py-0.5 max-w-[200px]">
					{crash.specBundles.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
				</select>
			</CrashControls>
			{translated && (
				<div className="shrink-0 px-3 py-1 border-b text-xs text-amber-300/90">
					Translated shaders draw the undamaged car for now; switch them off to see the dents.
				</div>
			)}
		</>
	);
}

// Inside the Canvas: steps the simulator, poses the registered meshes and
// draws the obstacle and markers.
export function RenderableCrashRig({ crash }: { crash: RenderableCrash }) {
	const { session, deform } = crash;
	if (!deform) return null;
	return <CrashRigInner session={session} poser={deform.poser} />;
}

function CrashRigInner({ session, poser }: { session: CrashSession; poser: PartPoser }) {
	useCrashStepper(session, poser);
	return (
		<>
			<CrashObstacle simRef={session.simRef} />
			{session.showPoints && session.sim && <CrashMarkers sim={session.sim} />}
		</>
	);
}

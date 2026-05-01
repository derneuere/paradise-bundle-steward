// Camera auto-fit — positions the active perspective camera to frame a
// sphere of `radius` around `center` once on mount, then steps out of the
// way so OrbitControls / user input owns the camera afterwards. Every
// resource viewport in this codebase had a near-identical copy of this;
// shared here so they all behave the same and stay in sync.
//
// Latches inside `useAutoFitCamera` so subsequent prop changes (e.g. the
// user switching resources, which produces a new center/radius) don't
// snap the camera back to the fit position mid-edit. If a viewport
// actually wants to refit on prop change, it can mount a fresh
// `<AutoFit key={resourceId} />`.

import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAutoFitCamera } from '@/hooks/useAutoFitCamera';

export type AutoFitProps = {
	center: THREE.Vector3;
	radius: number;
	/** Multiplier applied to `radius` for the camera distance. The default
	 *  (1.5×) gives a comfortable margin around the scene without zooming
	 *  out so far that small features become unreadable. */
	distanceFactor?: number;
	/** Multiplier applied to `radius` for the camera's `far` plane. Default
	 *  10× radius keeps depth precision reasonable while still rendering
	 *  the whole scene. */
	farFactor?: number;
	/** When false, leave the camera's `far` plane untouched. Useful when
	 *  the Canvas already sets a `far` value the viewport wants to keep. */
	setFar?: boolean;
	/** Offset factors of `d` (= radius × distanceFactor) added to `center`
	 *  to derive the camera position. Default `(0, 1, 0.3)` produces the
	 *  classic top-down-tilted-back framing. */
	offsetFactor?: { x: number; y: number; z: number };
};

const DEFAULT_OFFSET = { x: 0, y: 1, z: 0.3 };

export function AutoFit({
	center,
	radius,
	distanceFactor = 1.5,
	farFactor = 10,
	setFar = true,
	offsetFactor = DEFAULT_OFFSET,
}: AutoFitProps) {
	const { camera } = useThree();
	useAutoFitCamera({ camera, center, radius, distanceFactor, farFactor, setFar, offsetFactor });
	return null;
}

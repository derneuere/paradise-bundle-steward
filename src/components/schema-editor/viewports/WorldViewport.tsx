// WorldViewport — the shared three.js chrome for every level-space resource
// (AI sections, street data, traffic data, trigger data, zone list, polygon
// soup list). Owns the Canvas, the fixed Burnout-world camera, default
// lighting, OrbitControls, and a viewport-scoped error boundary. Overlays
// passed as children render meshes/lines on top.
//
// Three load-bearing decisions live as ADRs (see WorldViewport.types.ts):
//
//   - ADR-0001 — Overlays speak NodePath, not per-resource selection objects.
//   - ADR-0002 — Overlays receive resource data via React props.
//   - ADR-0003 — One fixed camera; no auto-fit, no overlay-supplied bounds.
//
// Camera position is chosen to frame the entire Burnout Paradise island:
// the playable region's bounding sphere has radius ~5000 world units, and
// the existing per-resource AutoFit hooks all produce roughly
// `(center.x, radius * 1.5, center.z + radius * 0.3)` framing. Hard-coding
// that reproduces the same default view without any per-resource bounds.

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ViewportErrorBoundary } from '@/components/common/ViewportErrorBoundary';
import type { WorldViewportComponent } from './WorldViewport.types';

const CAMERA_POSITION: [number, number, number] = [0, 15000, 3000];
const CAMERA_TARGET: [number, number, number] = [0, 0, 0];
const CAMERA_FOV = 45;
const CAMERA_NEAR = 1;
const CAMERA_FAR = 200000;
const BACKGROUND = '#0a0e14';

export const WorldViewport: WorldViewportComponent = ({ children }) => {
	return (
		<div
			className="relative h-full w-full"
			style={{ minHeight: 400, background: BACKGROUND }}
			onContextMenu={(e) => e.preventDefault()}
		>
			<ViewportErrorBoundary>
				<Canvas
					camera={{
						position: CAMERA_POSITION,
						fov: CAMERA_FOV,
						near: CAMERA_NEAR,
						far: CAMERA_FAR,
					}}
					gl={{ antialias: true, logarithmicDepthBuffer: true }}
				>
					<color attach="background" args={[BACKGROUND]} />
					<ambientLight intensity={0.6} />
					<hemisphereLight args={['#b1c8e8', '#4a3f2f', 0.3]} />
					<directionalLight position={[10, 20, 5]} intensity={0.9} />
					<directionalLight position={[-8, 15, -10]} intensity={0.4} />
					<OrbitControls
						target={CAMERA_TARGET}
						enableDamping
						dampingFactor={0.1}
						makeDefault
					/>
					{children}
				</Canvas>
			</ViewportErrorBoundary>
		</div>
	);
};

export default WorldViewport;

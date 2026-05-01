// Bridge useThree() values out of the <Canvas> tree into a parent ref so
// React code outside the canvas (HTML overlays, marquee selectors, custom
// click handlers that need camera math) can read the live camera + size
// without resorting to ad-hoc context plumbing.
//
// Mount as a child of <Canvas>:
//
//   const bridge = useRef<CameraBridgeData | null>(null);
//   <Canvas>
//     <CameraBridge bridge={bridge} />
//     ...
//   </Canvas>
//   <SomeOverlay bridge={bridge} />
//
// The ref's `current` is `null` until R3F mounts the child and fires the
// internal sync. Consumers that read on pointerdown won't see the issue
// (drag happens after mount), but anything that touches it during the
// first render must guard.
//
// Restricted to PerspectiveCamera because every viewport here uses one and
// downstream marquee math depends on it. If we add an orthographic
// viewport, generalize the data type then.

import { useThree } from '@react-three/fiber';
import { useCameraBridgeSync, type CameraBridgeData } from '@/hooks/useCameraBridgeSync';

export type { CameraBridgeData };

export function CameraBridge({ bridge }: { bridge: React.MutableRefObject<CameraBridgeData | null> }) {
	const { camera, size } = useThree();
	useCameraBridgeSync(bridge, camera, size);
	return null;
}

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
//
// HTML sibling slot
// -----------------
// Some overlay UI doesn't fit inside the Canvas — context menus, marquee
// rectangles, snap-toggle buttons. Overlays opt in via
// `useWorldViewportHtmlSlot()`, which returns a state setter the overlay
// calls (typically from a `useEffect`) with the JSX it wants rendered
// outside the Canvas. The chrome stores the JSX in state and renders it as
// an absolutely-positioned sibling of the Canvas, inside React-DOM-land —
// so portal-via-react-reconciler quirks across R3F never come into play.
// Pair an inside-Canvas `<CameraBridge>` with the slot when the DOM
// content needs to read camera state (e.g. marquee picking).

import {
	createContext, useContext, useEffect, useMemo, useState,
	type ReactNode,
} from 'react';
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

// ---------------------------------------------------------------------------
// HTML sibling slot — a state-backed register/unregister API so overlays
// inside the Canvas can ask the chrome to render DOM siblings of the Canvas.
// ---------------------------------------------------------------------------

type RegisterHtmlOverlay = (id: string, node: ReactNode) => void;
type UnregisterHtmlOverlay = (id: string) => void;

type HtmlSlotApi = {
	register: RegisterHtmlOverlay;
	unregister: UnregisterHtmlOverlay;
};

const HtmlSlotContext = createContext<HtmlSlotApi | null>(null);

/**
 * Register DOM JSX to render as a sibling of the Canvas (i.e. inside the
 * chrome's wrapping element, outside the WebGL surface). Use this for UI
 * that doesn't belong inside R3F's reconciler — context menus, marquee
 * rectangles, screen-space toggle buttons.
 *
 * Pass `node` reactively from your render: this hook re-registers on every
 * render where `node` changes, so closures stay live with overlay state.
 * Passing `null` or omitting the call removes the overlay's registration.
 *
 * The chrome positions the slot as `absolute inset-0` with
 * `pointer-events: none` so individual children opt into pointer events
 * locally (matches the marquee selector / snap-toggle conventions).
 */
export function useWorldViewportHtmlSlot(node: ReactNode): void {
	const api = useContext(HtmlSlotContext);
	// Stable id per hook-call site — generated lazily so React's strict-mode
	// double-invoke doesn't churn the registry.
	const id = useMemo(
		() => `html-overlay-${Math.random().toString(36).slice(2, 10)}`,
		[],
	);
	useEffect(() => {
		if (!api) return;
		api.register(id, node);
		return () => api.unregister(id);
	}, [api, id, node]);
}

export const WorldViewport: WorldViewportComponent = ({ children }) => {
	// Order-stable map from id → JSX so overlays can register and unregister
	// without re-arranging the rendering order on every change.
	const [overlays, setOverlays] = useState<ReadonlyMap<string, ReactNode>>(
		() => new Map(),
	);

	const api = useMemo<HtmlSlotApi>(
		() => ({
			register(id, node) {
				setOverlays((prev) => {
					const next = new Map(prev);
					next.set(id, node);
					return next;
				});
			},
			unregister(id) {
				setOverlays((prev) => {
					if (!prev.has(id)) return prev;
					const next = new Map(prev);
					next.delete(id);
					return next;
				});
			},
		}),
		[],
	);

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
					<HtmlSlotContext.Provider value={api}>
						{children}
					</HtmlSlotContext.Provider>
				</Canvas>
			</ViewportErrorBoundary>
			{/* DOM siblings of the Canvas — registered via
			    useWorldViewportHtmlSlot() from inside an overlay. The
			    wrapper has `pointer-events: none` so the Canvas keeps
			    receiving orbit / pick events; individual overlay children
			    re-enable pointer events on themselves where they need to
			    (a button sets pointer-events: auto on its own root, etc). */}
			<div
				className="absolute inset-0"
				style={{ pointerEvents: 'none', zIndex: 10 }}
			>
				{Array.from(overlays.entries()).map(([id, node]) => (
					<div key={id} style={{ position: 'absolute', inset: 0 }}>
						{node}
					</div>
				))}
			</div>
		</div>
	);
};

export default WorldViewport;

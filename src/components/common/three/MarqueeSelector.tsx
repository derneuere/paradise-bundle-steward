// Generic marquee (box-select) overlay for any R3F viewport.
//
// Activation model: a sticky toggle bound to the `B` key by default
// (matches Blender's "Box select" mnemonic, familiar from other 3D
// tools). When active, this component's div sits on top of the canvas
// with `pointer-events: auto`, so it intercepts the pointerdown that
// would otherwise hit OrbitControls — no orbit while dragging a
// selection rectangle. When inactive, `pointer-events: none` lets every
// pointer event pass through to the canvas as if the overlay isn't there.
//
// We chose a sticky modal toggle over a held modifier key (shift/alt+drag)
// because shift is already taken by the click-time range-extend gesture
// in some viewports, and a held key conflicts with cross-window focus
// changes during the drag. Press the key once to enter, press it again
// (or Esc) to exit.
//
// Modifier behaviour during the drag:
//   - default                → mode = 'add'    → consumer unions hits into selection
//   - alt held on pointerup  → mode = 'remove' → consumer subtracts hits
// We snapshot Alt at pointerup, not pointerdown, so users can decide
// add-vs-remove mid-drag.
//
// API: this component is purely the UI + drag state machine. The consumer
// implements the actual "what did the rectangle hit?" pass via the
// `onMarquee` callback, which receives a fully built `THREE.Frustum`
// (constructed via `buildMarqueeFrustum`) plus the chosen mode. Each
// viewport runs its own per-item containsPoint test against the frustum
// — keeps this component free of any data-shape assumptions.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { buildMarqueeFrustum } from '@/lib/three/marqueeFrustum';
import type { CameraBridgeData } from './CameraBridge';

export type MarqueeMode = 'add' | 'remove';

export type MarqueeSelectorProps = {
	bridge: React.MutableRefObject<CameraBridgeData | null>;
	/** Consumer hook — invoked once on pointerup with a frustum spanning
	 *  the dragged rectangle and the user's intent (add vs remove). The
	 *  consumer runs its own per-item hit test and updates its selection
	 *  store. Not invoked for sub-threshold drags or empty pulls. */
	onMarquee?: (frustum: THREE.Frustum, mode: MarqueeMode) => void;
	/** Far-plane distance for the frustum, in world units. Pick something
	 *  calibrated to your scene radius (e.g. 10× radius). Larger = picks
	 *  occluded items further away; smaller = stays close to camera. */
	far: number;
	/** Activation key (default `B`). Single character, case-insensitive. */
	activationKey?: string;
	/** Pixels of pointer movement below which a drag is treated as a stray
	 *  click and no marquee fires. Default 6 px is empirically calibrated
	 *  to be small enough to feel responsive but large enough to absorb a
	 *  clicking hand twitch. */
	dragThresholdPx?: number;
	/** Hint text shown when the mode is OFF — typically "press B for box
	 *  select". Pass null to suppress the hint badge entirely. */
	hintIdle?: string | null;
	/** Hint text shown when the mode is ON. Defaults reference the chosen
	 *  activation key. */
	hintActive?: string | null;
};

export function MarqueeSelector({
	bridge,
	onMarquee,
	far,
	activationKey = 'b',
	dragThresholdPx = 6,
	hintIdle: hintIdleProp,
	hintActive: hintActiveProp,
}: MarqueeSelectorProps) {
	const overlayRef = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState(false);
	const [drag, setDrag] = useState<{
		startX: number;
		startY: number;
		currentX: number;
		currentY: number;
		pointerId: number;
	} | null>(null);

	const keyLower = activationKey.toLowerCase();
	const keyUpper = activationKey.toUpperCase();
	const hintIdle = hintIdleProp === undefined
		? `press ${keyUpper} for box select`
		: hintIdleProp;
	const hintActive = hintActiveProp === undefined
		? `box select on — drag to add (alt = remove) · ${keyUpper} / Esc to exit`
		: hintActiveProp;

	// Toggle on the activation key, exit on Escape. Listening on window
	// (not the overlay) so the keystroke works regardless of where focus
	// is in the page. Ignore key events that originate inside an editable
	// element so typing the key into an input field doesn't toggle mode.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			const tag = target?.tagName;
			const isEditable =
				target?.isContentEditable ||
				tag === 'INPUT' ||
				tag === 'TEXTAREA' ||
				tag === 'SELECT';
			if (isEditable) return;
			const lower = e.key.toLowerCase();
			if (lower === keyLower) {
				e.preventDefault();
				setActive((a) => !a);
			} else if (e.key === 'Escape') {
				setActive(false);
				setDrag(null);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [keyLower]);

	// If the user toggles off mid-drag, abort cleanly so we don't leak
	// pointer capture or render a stale rectangle next time.
	useEffect(() => {
		if (!active) setDrag(null);
	}, [active]);

	const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		if (!active || e.button !== 0) return;
		e.preventDefault();
		overlayRef.current?.setPointerCapture(e.pointerId);
		setDrag({
			startX: e.clientX,
			startY: e.clientY,
			currentX: e.clientX,
			currentY: e.clientY,
			pointerId: e.pointerId,
		});
	};

	const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		if (!drag || drag.pointerId !== e.pointerId) return;
		setDrag({ ...drag, currentX: e.clientX, currentY: e.clientY });
	};

	const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
		if (!drag || drag.pointerId !== e.pointerId) return;
		overlayRef.current?.releasePointerCapture(e.pointerId);
		const dx = e.clientX - drag.startX;
		const dy = e.clientY - drag.startY;
		const moved = Math.hypot(dx, dy) >= dragThresholdPx;
		setDrag(null);
		if (!moved) return;

		const data = bridge.current;
		const overlay = overlayRef.current;
		if (!data || !overlay || !onMarquee) return;
		const rect = overlay.getBoundingClientRect();
		const startNDC = new THREE.Vector3(
			((drag.startX - rect.left) / rect.width) * 2 - 1,
			-((drag.startY - rect.top) / rect.height) * 2 + 1,
			0,
		);
		const endNDC = new THREE.Vector3(
			((e.clientX - rect.left) / rect.width) * 2 - 1,
			-((e.clientY - rect.top) / rect.height) * 2 + 1,
			0,
		);
		const frustum = buildMarqueeFrustum(data.camera, startNDC, endNDC, far);
		onMarquee(frustum, e.altKey ? 'remove' : 'add');
	};

	// CSS rectangle for the in-progress drag. Positioned in viewport (page)
	// coords because the pointer events deliver clientX/clientY in the same
	// frame; getBoundingClientRect on the overlay div would shift if the
	// page scrolls during a drag.
	const rectStyle = drag
		? (() => {
			const overlay = overlayRef.current;
			if (!overlay) return null;
			const rect = overlay.getBoundingClientRect();
			const left = Math.min(drag.startX, drag.currentX) - rect.left;
			const top = Math.min(drag.startY, drag.currentY) - rect.top;
			const width = Math.abs(drag.currentX - drag.startX);
			const height = Math.abs(drag.currentY - drag.startY);
			return { left, top, width, height };
		})()
		: null;

	return (
		<>
			<div
				ref={overlayRef}
				style={{
					position: 'absolute',
					inset: 0,
					pointerEvents: active ? 'auto' : 'none',
					cursor: active ? 'crosshair' : 'auto',
				}}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={() => setDrag(null)}
			>
				{rectStyle && (
					<div
						style={{
							position: 'absolute',
							left: rectStyle.left,
							top: rectStyle.top,
							width: rectStyle.width,
							height: rectStyle.height,
							border: '1px dashed rgba(255, 184, 51, 0.95)',
							background: 'rgba(255, 184, 51, 0.12)',
							pointerEvents: 'none',
						}}
					/>
				)}
			</div>
			{(hintIdle !== null || hintActive !== null) && (
				<div className="absolute bottom-2 right-2 text-[10px] font-mono text-white/70 bg-black/50 px-2 py-1 rounded pointer-events-none select-none">
					{active
						? hintActive !== null && <span className="text-amber-300">{hintActive}</span>
						: hintIdle !== null && <span>{hintIdle}</span>}
				</div>
			)}
		</>
	);
}

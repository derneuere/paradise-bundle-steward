// Sticky modal hotkey toggle for the MarqueeSelector overlay.
//
// Activation model: press the activation key (default `B`, matching
// Blender's "Box select" mnemonic) to enter marquee mode; press the same
// key again — or Escape — to exit. Held-modifier toggling was rejected
// because shift is taken by the click-time range-extend gesture in some
// viewports, and a held key conflicts with cross-window focus changes
// during a drag.
//
// Listens on `window` so the keystroke works regardless of where focus
// is. Key events that originate inside an editable element are ignored
// so typing the key into an input field doesn't toggle mode.
//
// `onDeactivate` is called whenever active transitions from true to
// false (via the activation key or Escape). Consumers use it to abort
// any in-flight drag state. The callback is captured in a ref, so it
// does not need a stable identity.

import { useEffect, useRef, useState } from 'react';

export function useMarqueeActivation(
	activationKey: string,
	onDeactivate?: () => void,
): boolean {
	const [active, setActive] = useState(false);
	const onDeactivateRef = useRef(onDeactivate);
	onDeactivateRef.current = onDeactivate;

	const keyLower = activationKey.toLowerCase();

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
				setActive((a) => {
					if (a) onDeactivateRef.current?.();
					return !a;
				});
			} else if (e.key === 'Escape') {
				setActive((a) => {
					if (a) onDeactivateRef.current?.();
					return false;
				});
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [keyLower]);

	return active;
}

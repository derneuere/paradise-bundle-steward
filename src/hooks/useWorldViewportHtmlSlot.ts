// Register DOM JSX to render as a sibling of the WorldViewport's Canvas
// (i.e. inside the chrome's wrapping element, outside the WebGL surface).
// Use this for UI that doesn't belong inside R3F's reconciler — context
// menus, marquee rectangles, screen-space toggle buttons.
//
// Pass `node` reactively from your render: this hook re-registers on
// every render where `node` changes, so closures stay live with overlay
// state. Pass `null` (or `false`) to skip / unregister — overlays that
// aren't the currently-active resource use this to avoid stacking their
// tools on top of the active overlay's (issue #24 inspector dispatch).
//
// The chrome positions the slot as `absolute inset-0` with
// `pointer-events: none` so individual children opt into pointer events
// locally (matches the marquee selector / snap-toggle conventions).
//
// Lives in src/hooks/ rather than next to WorldViewport so the
// component file stays declarative; the HtmlSlotContext + API types
// remain in WorldViewport.tsx since they're an implementation detail of
// the chrome.

import { useContext, useEffect, useMemo, type ReactNode } from 'react';
import { HtmlSlotContext } from '@/components/schema-editor/viewports/WorldViewport';

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
		// `null` / `false` means "do not register". The cleanup still
		// unregisters in case a previous render had a non-null node.
		if (node == null || node === false) {
			api.unregister(id);
			return;
		}
		api.register(id, node);
		return () => api.unregister(id);
	}, [api, id, node]);
}

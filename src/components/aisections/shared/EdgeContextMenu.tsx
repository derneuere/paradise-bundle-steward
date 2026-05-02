// DOM-portalled context menu shown when the user right-clicks an edge in
// the selected section. Mounted into the WorldViewport chrome's HTML slot
// (see `useWorldViewportHtmlSlot`) so it floats above the WebGL surface.
//
// Shadcn's `<ContextMenu>` primitive isn't reused because that component
// binds to a right-click on a DOM element — but our trigger is a Three.js
// mesh `onContextMenu`, so the menu has to open programmatically with
// pre-resolved screen coords.
//
// Action list is caller-supplied so each overlay (V12 edit ops vs.
// future V4 edit ops) can advertise its own subset.

import type { ReactNode } from 'react';
import { useDismissOnOutsideInteraction } from '@/hooks/useDismissOnOutsideInteraction';

// `pointerEvents: 'auto'` is load-bearing: the WorldViewport HTML slot
// wrapper (`useWorldViewportHtmlSlot`) sets `pointer-events: none` on its
// container so empty overlay area doesn't eat canvas orbit / pick events.
// CSS inheritance carries that through to position-fixed children too, so any
// slot child that needs clicks must opt back in. Without this, the menu
// renders but the chip's onClick never fires (issue #30). Exported for the
// regression test that pins the pointer-events opt-in.
export function edgeContextMenuRootStyle(x: number, y: number): React.CSSProperties {
	return { position: 'fixed', left: x, top: y, zIndex: 1000, pointerEvents: 'auto' };
}

export function EdgeContextMenu({
	x,
	y,
	edgeIdx,
	onClose,
	children,
}: {
	x: number;
	y: number;
	edgeIdx: number;
	onClose: () => void;
	children: ReactNode;
}) {
	useDismissOnOutsideInteraction(onClose);

	return (
		<div
			style={edgeContextMenuRootStyle(x, y)}
			className="bg-popover text-popover-foreground border rounded-md shadow-md p-1 min-w-[16rem]"
			onMouseDown={(e) => e.stopPropagation()}
			onContextMenu={(e) => e.preventDefault()}
		>
			<div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
				Edge {edgeIdx}
			</div>
			{children}
		</div>
	);
}

// Scroll a TanStack Virtual list to a selected row index.
//
// Imperative — no React-side scroll position to derive. We watch the
// selected index and call `scrollToIndex` whenever it changes.
// `index < 0` means no selection — skip the scroll so the viewport
// doesn't fight the user's scroll position.
//
// Defaults: `align: 'auto'` keeps the row in view if it's already on
// screen, scrolls minimally otherwise; `behavior: 'auto'` is instant
// (no smooth-scroll jitter when the user navigates via keyboard). The
// hex viewer overrides align to 'center' for jump-to-byte semantics.

import { useEffect } from 'react';

type Align = 'start' | 'center' | 'end' | 'auto';
type Behavior = 'auto' | 'smooth';

type Virtualizer = {
	scrollToIndex: (
		index: number,
		options?: { align?: Align; behavior?: Behavior },
	) => void;
};

export type ScrollToVirtualRowOptions = {
	align?: Align;
	behavior?: Behavior;
};

export function useScrollToVirtualRow(
	virtualizer: Virtualizer,
	index: number,
	options?: ScrollToVirtualRowOptions,
): void {
	const align = options?.align ?? 'auto';
	const behavior = options?.behavior ?? 'auto';
	useEffect(() => {
		if (index >= 0) {
			virtualizer.scrollToIndex(index, { align, behavior });
		}
	}, [index, virtualizer, align, behavior]);
}

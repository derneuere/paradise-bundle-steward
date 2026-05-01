// Scroll a TanStack Virtual list to the currently-selected row index.
//
// Imperative — no React-side scroll position to derive. We watch the
// selected index and call `scrollToIndex` whenever it changes. `align:
// 'auto'` keeps the row in view if it's already on screen, scrolls
// minimally otherwise; `behavior: 'auto'` is instant (no smooth-scroll
// jitter when the user navigates with arrow keys).
//
// `selectedIndex < 0` means no selection — skip the scroll so the
// viewport doesn't fight the user's scroll position when they have
// nothing selected.

import { useEffect } from 'react';

type Virtualizer = {
	scrollToIndex: (
		index: number,
		options?: { align?: 'start' | 'center' | 'end' | 'auto'; behavior?: 'auto' | 'smooth' },
	) => void;
};

export function useScrollToVirtualRow(
	virtualizer: Virtualizer,
	selectedIndex: number,
): void {
	useEffect(() => {
		if (selectedIndex >= 0) {
			virtualizer.scrollToIndex(selectedIndex, {
				align: 'auto',
				behavior: 'auto',
			});
		}
	}, [selectedIndex, virtualizer]);
}

// Window-level "click-outside / Escape / second-right-click" dismissal
// for popovers and floating menus that are positioned manually (i.e.
// don't go through Radix or HeadlessUI, which already handle this).
//
// Two callbacks could trigger an unwanted re-fire of the listener: pass
// `onClose` via a stable identity (useCallback) or accept the relisten
// cost. Registration is deferred by a tick so the same mousedown that
// opened the menu doesn't immediately close it. The second contextmenu
// elsewhere is intercepted (preventDefault) so the user gets one
// app-level menu rather than the browser's native menu stacked on top.

import { useEffect } from 'react';

export function useDismissOnOutsideInteraction(onClose: () => void): void {
	useEffect(() => {
		const handleClick = () => onClose();
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		const handleContextMenuElsewhere = (e: MouseEvent) => {
			e.preventDefault();
			onClose();
		};
		const t = window.setTimeout(() => {
			window.addEventListener('mousedown', handleClick);
			window.addEventListener('keydown', handleKey);
			window.addEventListener('contextmenu', handleContextMenuElsewhere);
		}, 0);
		return () => {
			window.clearTimeout(t);
			window.removeEventListener('mousedown', handleClick);
			window.removeEventListener('keydown', handleKey);
			window.removeEventListener('contextmenu', handleContextMenuElsewhere);
		};
	}, [onClose]);
}

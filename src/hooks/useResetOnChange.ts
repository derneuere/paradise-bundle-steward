// Run a `reset` callback whenever `value` changes (and on initial mount).
//
// This is the imperative escape hatch for clearing several pieces of
// transient state when an upstream selection / id changes — typical
// example: a viewport's hovered-edge / open-menu / in-flight-drag state
// when the selected item changes underneath. The React docs recommend
// a `key` prop on a child component for this case, which avoids the
// effect entirely; reach for that first if it fits. Use this hook when
// the transient state is too entangled with parent render logic to
// extract into a keyed child.

import { useEffect } from 'react';

export function useResetOnChange<T>(value: T, reset: () => void): void {
	useEffect(() => {
		reset();
		// Intentionally only depends on `value` — `reset` is treated as
		// a fire-and-forget callback whose identity we don't track.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value]);
}

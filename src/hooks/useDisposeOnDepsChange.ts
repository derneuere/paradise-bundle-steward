// Run `dispose` when any of `deps` changes (and on final unmount).
//
// The bare-bones effect-with-cleanup pattern, named for the specific
// case where the body is a no-op and only the cleanup matters:
// disposing GPU resources whose identity changed underneath us, or
// tearing down subscriptions tied to a particular dep set.
//
// Sister hook: useDisposeOnUnmount — same shape but specialized to
// resources with a `.dispose()` method. Use this one when the cleanup
// involves multiple resources, nested cleanup (e.g. material maps),
// or anything more elaborate than a single dispose call.

import { useEffect } from 'react';

export function useDisposeOnDepsChange(
	dispose: () => void,
	deps: React.DependencyList,
): void {
	// eslint-disable-next-line react-hooks/exhaustive-deps
	useEffect(() => dispose, deps);
}

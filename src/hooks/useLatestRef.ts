// Mirror a value into a ref so callbacks can read the freshest version
// without retriggering when the value changes.
//
// Common use case: a `useCallback` whose body needs the latest piece of
// state, but you don't want changes to that state to invalidate the
// callback identity (which would force every consumer to re-bind their
// listeners). Read `ref.current` inside the callback instead.
//
// Per the React docs, writing to `ref.current` during render is
// discouraged — Strict Mode renders twice and the second render's writes
// could mask the first's effects. Doing the write in an effect after
// commit is the conservative pattern.

import { useEffect, useRef } from 'react';

export function useLatestRef<T>(value: T): React.MutableRefObject<T> {
	const ref = useRef(value);
	useEffect(() => {
		ref.current = value;
	}, [value]);
	return ref;
}

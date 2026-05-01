// Ensure a Map-state has an entry for `key` after each render. If the
// entry is missing, write `initialValue` into it; if present, leave the
// existing value alone.
//
// Use case: a memo derives a per-scope value with a default fallback,
// and the surrounding code needs the underlying Map state to "remember"
// the default so identity stays stable across renders. The HierarchyTree
// uses this to seed per-resource expansion sets so their identity
// survives picker re-renders.

import { useEffect } from 'react';

export function useEnsureMapEntry<K, V>(
	setMap: React.Dispatch<React.SetStateAction<Map<K, V>>>,
	key: K,
	initialValue: V,
): void {
	useEffect(() => {
		setMap((prev) => {
			if (prev.has(key)) return prev;
			const next = new Map(prev);
			next.set(key, initialValue);
			return next;
		});
	}, [setMap, key, initialValue]);
}

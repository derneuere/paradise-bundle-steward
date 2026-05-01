// Seed the WorkspaceHierarchy's expansion state for bundles the user
// hasn't toggled yet.
//
// Default-expansion rule: with one Bundle loaded the tree expands that
// Bundle (the user is going to look in it anyway); with 2+ Bundles the
// tree stays collapsed (the tree becomes a Bundle picker, user expands
// what they need). We seed each Bundle's default exactly once — tracked
// in `seededBundles` — so subsequent loads of more Bundles don't
// retroactively collapse a Bundle the user already expanded.
//
// This shape is a state-sync pattern that the React docs flag (use the
// `key` prop instead). We can't `key` the hierarchy on `bundles.length`
// because that would discard user expansion of the FIRST Bundle when a
// second loads — which is exactly the case we want to handle gracefully.
// The effect is the right shape; it just lives in a hook so the
// component body stays declarative.

import { useEffect } from 'react';
import type { EditableBundle } from '@/context/WorkspaceContext.types';

export function useSeedBundleExpansion(
	bundles: readonly EditableBundle[],
	seededBundles: Set<string>,
	setSeededBundles: React.Dispatch<React.SetStateAction<Set<string>>>,
	setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>,
	bundleKey: (id: string) => string,
): void {
	useEffect(() => {
		const newSeeds: string[] = [];
		const newExpands: string[] = [];
		for (const b of bundles) {
			if (seededBundles.has(b.id)) continue;
			newSeeds.push(b.id);
			if (bundles.length === 1) newExpands.push(bundleKey(b.id));
		}
		if (newSeeds.length === 0) return;
		setSeededBundles((prev) => {
			const next = new Set(prev);
			for (const id of newSeeds) next.add(id);
			return next;
		});
		if (newExpands.length > 0) {
			setExpanded((prev) => {
				const next = new Set(prev);
				for (const k of newExpands) next.add(k);
				return next;
			});
		}
	}, [bundles, seededBundles, setSeededBundles, setExpanded, bundleKey]);
}

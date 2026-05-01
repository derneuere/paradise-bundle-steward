// Reset the picker's visibility set to "everything visible" whenever the
// underlying picker resource set changes (typically: the user loaded a
// new bundle, or the bundle re-parsed). Without this, switching bundles
// would resurrect a prior bundle's hides — invisible resources from a
// closed file would remain hidden against the new file's identical-id
// resources.
//
// `bundleKey` is derived from the joined-id-string's length, which is
// cheap to compute and stable enough for our purposes (collisions
// across two distinct bundles with the same total id-character-count
// are vanishingly unlikely; if they do occur the user just sees the
// previous bundle's visibility set, which is recoverable).

import { useEffect, useRef } from 'react';
import type { PickerResourceCtx } from '@/lib/core/registry/handler';

export function useReseedVisibility(
	pickerCtxs: readonly PickerResourceCtx[],
	setVisibleIds: React.Dispatch<React.SetStateAction<Set<string>>>,
): void {
	const initBundleRef = useRef<number>(0);
	useEffect(() => {
		if (pickerCtxs.length === 0) return;
		const bundleKey = pickerCtxs.map((c) => c.id).join('|').length;
		if (initBundleRef.current !== bundleKey) {
			initBundleRef.current = bundleKey;
			setVisibleIds(new Set(pickerCtxs.map((c) => c.id)));
		}
	}, [pickerCtxs, setVisibleIds]);
}

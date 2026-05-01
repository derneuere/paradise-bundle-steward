// Keep the active match index in a hex-search valid as the underlying
// search query and match list change. Resets to -1 when there are no
// matches; otherwise leaves a valid in-range index alone, but reseeds
// to 0 when the previous index falls out of range (e.g. the user typed
// more characters and narrowed the match set).
//
// A "raw setActiveMatchIndex" still drives next/prev navigation; this
// hook is the safety net for upstream changes the navigation buttons
// don't see.

import { useEffect } from 'react';

export function useNormalizeMatchIndex(
	parsedSearchBytes: Uint8Array | null,
	matchCount: number,
	setActiveMatchIndex: React.Dispatch<React.SetStateAction<number>>,
): void {
	useEffect(() => {
		if (!parsedSearchBytes || matchCount === 0) {
			setActiveMatchIndex(-1);
			return;
		}
		setActiveMatchIndex((prev) => (prev >= 0 && prev < matchCount ? prev : 0));
	}, [parsedSearchBytes, matchCount, setActiveMatchIndex]);
}

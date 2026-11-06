// Repaint one PolygonSoupList chunk's per-vertex colors whenever its
// selection inputs change. The color math lives in `paintSoupChunk`; this
// hook only schedules it. Unselected chunks receive stable inputs, so the
// effect never re-runs for the hundreds of track units that aren't involved
// in a selection change.

import { useEffect } from 'react';
import { paintSoupChunk, type SoupChunk } from '@/components/schema-editor/viewports/polygonSoupChunk';

export function useApplyPolygonSoupHighlight(
	chunk: SoupChunk,
	isSelectedModel: boolean,
	selectedPolys: ReadonlySet<number>,
	/** Swap the amber bulk paint for the red-tinted "skipped by the Bulk
	 *  transform" variant (issue #82). */
	skippedByBulkTransform: boolean,
): void {
	useEffect(() => {
		paintSoupChunk(chunk, isSelectedModel, selectedPolys, skippedByBulkTransform);
	}, [chunk, isSelectedModel, selectedPolys, skippedByBulkTransform]);
}

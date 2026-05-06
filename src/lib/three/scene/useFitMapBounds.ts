// Imperatively fit a Leaflet map to the bounds of a polygon set, with
// generous CSS-pixel padding so the outermost regions aren't pinned to
// the edge of the viewport.
//
// Skips when there are no polys (no bounds to fit). Re-fits whenever
// the poly set or the map instance change — the map only changes when
// `useMap()` returns a different reference, which happens on remount,
// so in practice this fits once per session unless polys change.

import { useEffect } from 'react';
import L from 'leaflet';

type PolyWithWorld = { world: L.LatLngExpression[] };

export function useFitMapBounds(
	map: L.Map,
	polys: readonly PolyWithWorld[],
): void {
	useEffect(() => {
		if (polys.length === 0) return;
		const allPoints: L.LatLngExpression[] = polys.flatMap((p) => p.world);
		const bounds = L.latLngBounds(allPoints);
		map.fitBounds(bounds, { padding: [100, 100] });
	}, [map, polys]);
}

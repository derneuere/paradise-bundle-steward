// SelectedSectionLayer — the "inspector pick" composite: orange outline,
// orange label, edge handles, and section detail (portals / boundary
// lines / no-go lines).
//
// Composed of the four leaf primitives that already live in shared/.
// Generic over `<TSection, TRoot>` so V12 and V4/V6 both consume it —
// the SectionDetailAccessor adapts between their storage shapes.
//
// `onPickBoundaryLineEndpoint` / `onPickNoGoLineEndpoint` are V12-only
// (V4/V6 doesn't have per-endpoint sub-entity selection); callers from
// V4/V6 leave them undefined.

import type { ReactNode } from 'react';
import { SelectionOverlay, type Corner } from './SelectionOverlay';
import { SectionLabel } from './SectionLabel';
import { EdgeHandles } from './EdgeHandles';
import { SectionDetail, type SectionDetailAccessor } from './SectionDetail';
import type { AISectionMarker } from './selection';

export function SelectedSectionLayer<TSection, TRoot>({
	corners,
	section,
	baseY,
	marker,
	root,
	accessor,
	color = '#ffaa33',
	labelText,
	hoveredEdge,
	onHoverEdge,
	onContextMenu,
	onPickPortal,
	onPickBoundaryLine,
	onPickNoGoLine,
	onPickBoundaryLineEndpoint,
	onPickNoGoLineEndpoint,
}: {
	corners: readonly Corner[];
	section: TSection;
	baseY: number;
	marker: AISectionMarker;
	root: TRoot;
	accessor: SectionDetailAccessor<TSection, TRoot>;
	/** Tint for the outline + label. Defaults to the orange "inspector
	 *  pick" colour both overlays use. */
	color?: string;
	labelText?: ReactNode;
	hoveredEdge: number | null;
	onHoverEdge: (edgeIdx: number | null) => void;
	onContextMenu: (edgeIdx: number, screenX: number, screenY: number) => void;
	onPickPortal: (portalIndex: number) => void;
	onPickBoundaryLine: (portalIndex: number, lineIndex: number) => void;
	onPickNoGoLine: (lineIndex: number) => void;
	onPickBoundaryLineEndpoint?: (portalIndex: number, lineIndex: number, endIndex: number) => void;
	onPickNoGoLineEndpoint?: (lineIndex: number, endIndex: number) => void;
}) {
	return (
		<>
			<SelectionOverlay corners={corners} color={color} baseY={baseY} />
			{labelText != null && corners.length >= 4 && (
				<SectionLabel corners={corners} color={color} baseY={baseY}>
					{labelText}
				</SectionLabel>
			)}
			<EdgeHandles
				corners={corners}
				hoveredEdge={hoveredEdge}
				onHoverEdge={onHoverEdge}
				onContextMenu={onContextMenu}
				baseY={baseY}
			/>
			<SectionDetail
				section={section}
				root={root}
				accessor={accessor}
				marker={marker}
				baseY={baseY}
				onPickPortal={onPickPortal}
				onPickBoundaryLine={onPickBoundaryLine}
				onPickNoGoLine={onPickNoGoLine}
				onPickBoundaryLineEndpoint={onPickBoundaryLineEndpoint}
				onPickNoGoLineEndpoint={onPickNoGoLineEndpoint}
			/>
		</>
	);
}

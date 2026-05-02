// HTML label hovering above a section.
//
// Anchored at the midpoint between corners[0] and corners[2] — that's a
// stable hand-picked centroid for V4's quad layout (where corners[0,2]
// is the diagonal) and continues to work for V12 sections that are also
// quad-shaped in practice. The label content is caller-supplied so V4
// can show its 3-bucket dangerRating string while V12 shows section id +
// 5-bucket speed.

import type { ReactNode } from 'react';
import { Html } from '@react-three/drei';
import type { Corner } from './SelectionOverlay';

export function SectionLabel({
	corners,
	color,
	children,
}: {
	corners: readonly Corner[];
	color: string;
	children: ReactNode;
}) {
	if (corners.length < 4) return null;
	return (
		<Html
			position={[
				(corners[0].x + corners[2].x) / 2,
				2,
				(corners[0].z + corners[2].z) / 2,
			]}
			center
			distanceFactor={200}
			style={{ pointerEvents: 'none' }}
		>
			<div
				style={{
					background: 'rgba(0,0,0,0.8)',
					color,
					padding: '2px 6px',
					borderRadius: 4,
					fontSize: 10,
					whiteSpace: 'nowrap',
					fontFamily: 'monospace',
				}}
			>
				{children}
			</div>
		</Html>
	);
}

// CornerPickers — click-to-select spheres at each corner of the
// inspector-picked V12 section.
//
// Pre-issue-73 the overlay rendered `CornerHandles` here, which combined
// pick + drag. Per ADR-0010 the gizmo now owns the drag, so these are
// click-only pickers: tap a sphere and the inspector deepens its selection
// to `['sections', i, 'corners', c]`, which makes the gizmo anchor at the
// corner (translate only that corner on the next drag).
//
// V12-only — V4/V6 has no corner-level sub-entity selection (its corners
// live in parallel cornersX/cornersZ arrays without their own schema path).

import { useState } from 'react';
import type { Corner } from '@/components/aisections/shared';
import { isDragRelease } from '@/components/schema-editor/viewports/selection/dragGuard';

const CORNER_PICKER_RADIUS = 0.8;
const CORNER_PICKER_HIT = 1.6;

export function CornerPickers({
	corners,
	baseY,
	selectedCornerIdx,
	onPick,
}: {
	corners: readonly Corner[];
	baseY: number;
	selectedCornerIdx: number | null;
	onPick: (cornerIdx: number) => void;
}) {
	const [hover, setHover] = useState<number | null>(null);
	return (
		<>
			{corners.map((c, i) => {
				const isSelected = selectedCornerIdx === i;
				const isHover = hover === i;
				const color = isSelected ? '#ffffff' : isHover ? '#ffd470' : '#ff8833';
				return (
					<group key={`corner-pick-${i}`} position={[c.x, baseY + 0.8, c.z]}>
						<mesh>
							<sphereGeometry args={[CORNER_PICKER_RADIUS, 12, 8]} />
							<meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
						</mesh>
						{/* Invisible larger hit volume — keeps picking forgiving
						    on small spheres at far camera distances. */}
						<mesh
							onClick={(e) => { e.stopPropagation(); if (isDragRelease(e.nativeEvent.clientX, e.nativeEvent.clientY)) return; onPick(i); }}
							onPointerOver={(e) => {
								e.stopPropagation();
								setHover(i);
								document.body.style.cursor = 'pointer';
							}}
							onPointerOut={(e) => {
								e.stopPropagation();
								setHover((h) => (h === i ? null : h));
								document.body.style.cursor = 'auto';
							}}
						>
							<sphereGeometry args={[CORNER_PICKER_HIT, 8, 6]} />
							<meshBasicMaterial transparent opacity={0} />
						</mesh>
					</group>
				);
			})}
		</>
	);
}

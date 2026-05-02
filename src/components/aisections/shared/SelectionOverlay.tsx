// Bright polygon highlight for the currently-selected (or hovered) section.
//
// Renders the polygon as a flat fill at y=0.3 plus a slightly raised
// closed-loop outline at y=0.4 so the highlight reads above the batched
// fill mesh (which sits at y=0.1) without z-fighting.
//
// Corner storage differs across V12 (`Vector2[]` with y → world Z) and
// V4/V6 (parallel `cornersX[]` + `cornersZ[]`). Both project onto the
// same `Corner = { x, z }` shape — a small per-render allocation given
// the highlight only renders for one or two sections at a time.

import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';

export type Corner = { x: number; z: number };

export function SelectionOverlay({ corners, color }: { corners: readonly Corner[]; color: string }) {
	const geometry = useMemo(() => {
		if (corners.length < 3) return null;
		const shape = new THREE.Shape();
		shape.moveTo(corners[0].x, corners[0].z);
		for (let i = 1; i < corners.length; i++) {
			shape.lineTo(corners[i].x, corners[i].z);
		}
		shape.closePath();
		const geo = new THREE.ShapeGeometry(shape);
		// ShapeGeometry sits on XY; rotate +π/2 around X to land on the XZ
		// plane at world (x, 0, z) — matches the outline `<Line>` below.
		geo.rotateX(Math.PI / 2);
		return geo;
	}, [corners]);

	if (!geometry) return null;

	return (
		<>
			<mesh geometry={geometry} position={[0, 0.3, 0]}>
				<meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
			</mesh>
			{corners.length >= 3 && (
				<Line
					points={[
						...corners.map((c): [number, number, number] => [c.x, 0.4, c.z]),
						[corners[0].x, 0.4, corners[0].z],
					]}
					color={color}
					lineWidth={2.5}
				/>
			)}
		</>
	);
}

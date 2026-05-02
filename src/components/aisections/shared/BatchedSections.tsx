// Generic batched-section geometry used by both V12 and V4/V6 overlays.
//
// Renders an entire AI Sections payload as exactly two draw calls:
//   - one indexed mesh of fan-triangulated polygon fills, one vertex per
//     corner, per-vertex colour from `accessor.color(section)`
//   - one LineSegments outline of polygon perimeters
// plus a `faceToSection: Int32Array` lookup for face-index → section-index
// picking. Without batching, ~8780 V12 sections become ~17k separate React
// trees and r3f drops to single-digit FPS.
//
// The accessor interface (rather than a `corners: Corner[]` parameter)
// is load-bearing: V12 stores corners as `Vector2[]` (~35k objects already
// allocated) but V4/V6 stores them as parallel `cornersX[] + cornersZ[]`
// number arrays. Allocating an intermediate `Corner[]` per section per
// rebuild would double the per-frame allocation budget on V4. Accessors
// let each schema project straight from its native storage.

import { useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { fillMaterial, outlineMaterial } from './materials';

export type SectionAccessor<T> = {
	cornerCount(s: T): number;
	cornerX(s: T, i: number): number;
	cornerZ(s: T, i: number): number;
	color(s: T): readonly [number, number, number];
};

export type BatchedSectionsScene = {
	fillGeo: THREE.BufferGeometry;
	outlineGeo: THREE.BufferGeometry;
	/** triangle index → section index (in the source array, including skipped degenerates) */
	faceToSection: Int32Array;
};

/**
 * Build batched fill + outline geometry for `sections`. Sections with fewer
 * than three valid corners are skipped (no fill, no outline) but the
 * face→section map stays aligned to the source array — a section at
 * `sections[i]` always reports `i` in `faceToSection`, never a remapped
 * index. Callers that index into the source array via the picked face
 * relyon this invariant.
 */
export function buildBatchedSections<T>(
	sections: readonly T[],
	accessor: SectionAccessor<T>,
): BatchedSectionsScene {
	let totalFillVerts = 0;
	let totalFillIndices = 0;
	let totalOutlineVerts = 0;
	for (const sec of sections) {
		const n = accessor.cornerCount(sec);
		if (n < 3) continue;
		totalFillVerts += n;
		totalFillIndices += (n - 2) * 3;
		totalOutlineVerts += n * 2;
	}

	const positions = new Float32Array(totalFillVerts * 3);
	const colors = new Float32Array(totalFillVerts * 3);
	const indices = new Uint32Array(totalFillIndices);
	const faceToSection = new Int32Array(totalFillIndices / 3);
	const outPositions = new Float32Array(totalOutlineVerts * 3);

	let vOff = 0;
	let iOff = 0;
	let fOff = 0;
	let oOff = 0;
	for (let si = 0; si < sections.length; si++) {
		const sec = sections[si];
		const n = accessor.cornerCount(sec);
		if (n < 3) continue;

		const rgb = accessor.color(sec);
		const baseVert = vOff / 3;

		for (let ci = 0; ci < n; ci++) {
			positions[vOff] = accessor.cornerX(sec, ci);
			positions[vOff + 1] = 0.1;
			positions[vOff + 2] = accessor.cornerZ(sec, ci);
			colors[vOff] = rgb[0];
			colors[vOff + 1] = rgb[1];
			colors[vOff + 2] = rgb[2];
			vOff += 3;
		}

		const numTris = n - 2;
		for (let t = 0; t < numTris; t++) {
			indices[iOff] = baseVert;
			indices[iOff + 1] = baseVert + t + 1;
			indices[iOff + 2] = baseVert + t + 2;
			iOff += 3;
			faceToSection[fOff++] = si;
		}

		for (let ci = 0; ci < n; ci++) {
			const next = (ci + 1) % n;
			outPositions[oOff++] = accessor.cornerX(sec, ci);
			outPositions[oOff++] = 0.5;
			outPositions[oOff++] = accessor.cornerZ(sec, ci);
			outPositions[oOff++] = accessor.cornerX(sec, next);
			outPositions[oOff++] = 0.5;
			outPositions[oOff++] = accessor.cornerZ(sec, next);
		}
	}

	const fillGeo = new THREE.BufferGeometry();
	fillGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	fillGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	fillGeo.setIndex(new THREE.BufferAttribute(indices, 1));
	fillGeo.computeBoundingSphere();

	const outlineGeo = new THREE.BufferGeometry();
	outlineGeo.setAttribute('position', new THREE.BufferAttribute(outPositions.subarray(0, oOff), 3));
	outlineGeo.computeBoundingSphere();

	return { fillGeo, outlineGeo, faceToSection };
}

export function BatchedSections({
	scene,
	onPickSection,
	onHoverSection,
}: {
	scene: BatchedSectionsScene;
	onPickSection: (sectionIndex: number) => void;
	onHoverSection: (sectionIndex: number | null) => void;
}) {
	const handleClick = useCallback(
		(e: ThreeEvent<MouseEvent>) => {
			e.stopPropagation();
			if (e.faceIndex == null) return;
			const si = scene.faceToSection[e.faceIndex];
			if (si != null && si >= 0) onPickSection(si);
		},
		[scene.faceToSection, onPickSection],
	);

	const handlePointerMove = useCallback(
		(e: ThreeEvent<PointerEvent>) => {
			e.stopPropagation();
			if (e.faceIndex == null) {
				onHoverSection(null);
				return;
			}
			const si = scene.faceToSection[e.faceIndex];
			if (si != null && si >= 0) {
				onHoverSection(si);
				document.body.style.cursor = 'pointer';
			}
		},
		[scene.faceToSection, onHoverSection],
	);

	const handlePointerOut = useCallback(() => {
		onHoverSection(null);
		document.body.style.cursor = 'auto';
	}, [onHoverSection]);

	return (
		<>
			<mesh
				geometry={scene.fillGeo}
				material={fillMaterial}
				onClick={handleClick}
				onPointerMove={handlePointerMove}
				onPointerOut={handlePointerOut}
			/>
			<lineSegments geometry={scene.outlineGeo} material={outlineMaterial} />
		</>
	);
}

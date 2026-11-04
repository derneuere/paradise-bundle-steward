// One PolygonSoupList resource's collision mesh inside the batched overlay.
//
// Memoised: a selection change re-renders only the chunk that gains or loses
// the highlight, so clicking around WORLDCOL costs one track unit's repaint
// instead of a pass over all 1.55M triangles. Picking is handled here rather
// than through `useBatchedSelection` because that hook walks `count` entities
// on every selection change, which is the cost this split exists to avoid.

import { memo, useCallback } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useApplyPolygonSoupHighlight } from '@/hooks/useApplyPolygonSoupHighlight';
import { useDisposeOnUnmount } from '@/hooks/useDisposeOnUnmount';
import { isDragRelease } from './selection/dragGuard';
import type { SoupChunk } from './polygonSoupChunk';

export type SoupPickHandler = (
	modelIndex: number,
	soupIndex: number,
	polyIndex: number,
	modifiers: { shift: boolean; ctrl: boolean },
) => void;

type Props = {
	chunk: SoupChunk;
	modelIndex: number;
	isSelectedModel: boolean;
	selectedPolys: ReadonlySet<number>;
	skippedByBulkTransform: boolean;
	onPick: SoupPickHandler;
};

export const PolygonSoupChunkMesh = memo(function PolygonSoupChunkMesh({
	chunk,
	modelIndex,
	isSelectedModel,
	selectedPolys,
	skippedByBulkTransform,
	onPick,
}: Props) {
	useApplyPolygonSoupHighlight(chunk, isSelectedModel, selectedPolys, skippedByBulkTransform);
	// Frees the GPU copy only; the CPU-side chunk stays cached, so re-showing
	// a hidden track unit re-uploads without rebuilding.
	useDisposeOnUnmount(chunk.geometry);

	const onClick = useCallback(
		(e: ThreeEvent<MouseEvent>) => {
			// Nearest chunk wins — without this a click through stacked roads
			// would select a polygon in every chunk the ray passes.
			e.stopPropagation();
			if (isDragRelease(e.nativeEvent.clientX, e.nativeEvent.clientY)) return;
			const face = e.faceIndex;
			if (face == null || face < 0 || face >= chunk.triangleCount) return;
			const ne = e.nativeEvent;
			onPick(modelIndex, chunk.faceToPoly[face * 2], chunk.faceToPoly[face * 2 + 1], {
				shift: ne.shiftKey,
				ctrl: ne.ctrlKey || ne.metaKey,
			});
		},
		[chunk, modelIndex, onPick],
	);

	return <mesh geometry={chunk.geometry} material={soupMaterial} onClick={onClick} />;
});

const soupMaterial = new THREE.MeshLambertMaterial({
	vertexColors: true,
	side: THREE.DoubleSide,
	flatShading: true,
});

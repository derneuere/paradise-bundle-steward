// One PolygonSoupList resource (one track unit's collision) → one GPU chunk.
//
// WORLDCOL.BIN carries 428 PolygonSoupList resources, ~921k polygons,
// ~1.55M triangles. Batching all of them into a single mesh meant any edit,
// visibility toggle or selection repaint touched the whole 1.55M-triangle
// buffer (≈1.5 s rebuild + a full GPU re-upload). Per-resource chunks keep
// every one of those operations proportional to the one track unit involved.
//
// Chunks are cached by model identity in a WeakMap. Edits produce a new model
// object for the edited resource only, so every untouched chunk is reused;
// undo hands back the old object and gets its old chunk back for free.
//
// The geometry has no normal attribute on purpose: the overlay renders with
// `flatShading`, which derives face normals in the fragment shader, so a
// normal buffer would be a third of the GPU memory for nothing.

import * as THREE from 'three';
import type { ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';
import { encodeSoupPoly } from './polygonSoupListContext';

export type SoupChunk = {
	/** position + color, non-indexed (3 verts per triangle) so each polygon
	 *  can carry its own collision-tag color. */
	geometry: THREE.BufferGeometry;
	/** Unhighlighted colors, restored before every repaint. */
	baseColors: Float32Array;
	/** [soupIndex, polyIndex] per triangle — quads contribute two triangles. */
	faceToPoly: Int32Array;
	triangleCount: number;
	soupCount: number;
	/** World-space bounds of every vertex in the resource (empty when no soups). */
	bounds: THREE.Box3;
	/** True while the color attribute holds a highlight rather than baseColors,
	 *  so unselected chunks can skip the repaint (and the GPU upload). */
	painted: boolean;
};

// ---------------------------------------------------------------------------
// Collision-tag → RGB color
// ---------------------------------------------------------------------------

function hue2rgb(p: number, q: number, t: number): number {
	if (t < 0) t += 1;
	if (t > 1) t -= 1;
	if (t < 1 / 6) return p + (q - p) * 6 * t;
	if (t < 1 / 2) return q;
	if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
	return p;
}

function hslToRgb(h: number, s: number, l: number, out: [number, number, number]): void {
	if (s === 0) {
		out[0] = out[1] = out[2] = l;
		return;
	}
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	out[0] = hue2rgb(p, q, h + 1 / 3);
	out[1] = hue2rgb(p, q, h);
	out[2] = hue2rgb(p, q, h - 1 / 3);
}

/** Hue from the material half of the tag, lightness from the group half, so
 *  surfaces with the same material read as one family. */
export function tagToColor(tag: number, out: [number, number, number]): void {
	const group = tag & 0xFFFF;
	const material = (tag >>> 16) & 0xFFFF;
	const h = ((material * 2654435761) >>> 0) / 0xFFFFFFFF;
	const l = 0.45 + (((group * 2246822519) >>> 0) / 0xFFFFFFFF) * 0.2;
	hslToRgb(h, 0.6, l, out);
}

// ---------------------------------------------------------------------------
// Build + cache
// ---------------------------------------------------------------------------

/** Copy three unpacked vertices + one flat color into the output buffers at
 *  float offset `w`; returns the advanced offset. */
function writeTri(
	positions: Float32Array,
	colors: Float32Array,
	unpacked: Float32Array,
	w: number,
	i0: number,
	i1: number,
	i2: number,
	rgb: readonly [number, number, number],
): number {
	for (let k = 0; k < 3; k++) {
		const vi = (k === 0 ? i0 : k === 1 ? i1 : i2) * 3;
		positions[w] = unpacked[vi];
		positions[w + 1] = unpacked[vi + 1];
		positions[w + 2] = unpacked[vi + 2];
		colors[w] = rgb[0];
		colors[w + 1] = rgb[1];
		colors[w + 2] = rgb[2];
		w += 3;
	}
	return w;
}

export function buildSoupChunk(model: ParsedPolygonSoupList): SoupChunk {
	let triangleCount = 0;
	for (const soup of model.soups) {
		for (const p of soup.polygons) triangleCount += p.vertexIndices[3] === 0xFF ? 1 : 2;
	}

	const positions = new Float32Array(triangleCount * 9);
	const colors = new Float32Array(triangleCount * 9);
	const faceToPoly = new Int32Array(triangleCount * 2);
	const tagColor: [number, number, number] = [0, 0, 0];
	let w = 0;
	let tri = 0;

	let minX = Infinity, minY = Infinity, minZ = Infinity;
	let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

	for (let soupIndex = 0; soupIndex < model.soups.length; soupIndex++) {
		const soup = model.soups[soupIndex];
		const len = soup.vertices.length;
		const unpacked = new Float32Array(len * 3);
		const [ox, oy, oz] = soup.vertexOffsets;
		const g = soup.comprGranularity;
		for (let i = 0; i < len; i++) {
			// Inlined `unpackSoupVertex` — this loop runs ~1.4M times for
			// WORLDCOL and the tuple allocation dominated it.
			const v = soup.vertices[i];
			const x = (v.x + ox) * g, y = (v.y + oy) * g, z = (v.z + oz) * g;
			unpacked[i * 3] = x;
			unpacked[i * 3 + 1] = y;
			unpacked[i * 3 + 2] = z;
			if (x < minX) minX = x; if (x > maxX) maxX = x;
			if (y < minY) minY = y; if (y > maxY) maxY = y;
			if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
		}
		for (let polyIndex = 0; polyIndex < soup.polygons.length; polyIndex++) {
			const poly = soup.polygons[polyIndex];
			const [a, b, c, d] = poly.vertexIndices;
			// Out-of-range indices clamp to vertex 0 rather than throwing —
			// hand-edited soups can briefly hold a bad index mid-edit.
			const ia = a < len ? a : 0;
			const ib = b < len ? b : 0;
			const ic = c < len ? c : 0;
			tagToColor(poly.collisionTag, tagColor);
			w = writeTri(positions, colors, unpacked, w, ia, ib, ic, tagColor);
			faceToPoly[tri * 2] = soupIndex;
			faceToPoly[tri * 2 + 1] = polyIndex;
			tri++;
			if (d !== 0xFF) {
				// Second quad triangle is d, c, b (the game's winding).
				w = writeTri(positions, colors, unpacked, w, d < len ? d : 0, ic, ib, tagColor);
				faceToPoly[tri * 2] = soupIndex;
				faceToPoly[tri * 2 + 1] = polyIndex;
				tri++;
			}
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

	const bounds = new THREE.Box3();
	if (minX <= maxX) bounds.set(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
	// Box-derived sphere (a little looser than three's two-pass fit, and free).
	// three tests it before any per-triangle raycast or frustum cull.
	geometry.boundingBox = bounds.clone();
	geometry.boundingSphere = bounds.isEmpty()
		? new THREE.Sphere()
		: bounds.getBoundingSphere(new THREE.Sphere());

	return {
		geometry,
		baseColors: colors.slice(),
		faceToPoly,
		triangleCount,
		soupCount: model.soups.length,
		bounds,
		painted: false,
	};
}

const chunkCache = new WeakMap<ParsedPolygonSoupList, SoupChunk>();

export function getSoupChunk(model: ParsedPolygonSoupList): SoupChunk {
	let chunk = chunkCache.get(model);
	if (!chunk) {
		chunk = buildSoupChunk(model);
		chunkCache.set(model, chunk);
	}
	return chunk;
}

// ---------------------------------------------------------------------------
// Highlight
// ---------------------------------------------------------------------------

// Amber (regular bulk paint) → red-tinted dim (Selection contains 1+
// transformable entities, so these soup-polys are SKIPPED by the bulk
// transform per CONTEXT.md / "Pivot" and issue #82). Distinct hue + lowered
// luma so the user reads "different state", not "different selection".
export const SOUP_PAINT_AMBER: readonly [number, number, number] = [1.0, 0.72, 0.2];
export const SOUP_PAINT_SKIPPED: readonly [number, number, number] = [0.85, 0.32, 0.32];

/**
 * Repaint one chunk. The selected resource is brightened and its bulk polys
 * stamped amber (or the skipped variant); every other chunk shows its base
 * colors. A chunk that already shows base colors and stays unselected is
 * left untouched so the GPU never re-uploads it.
 */
export function paintSoupChunk(
	chunk: SoupChunk,
	isSelectedModel: boolean,
	selectedPolys: ReadonlySet<number>,
	skippedByBulkTransform = false,
): void {
	if (!isSelectedModel && !chunk.painted) return;
	const attr = chunk.geometry.getAttribute('color') as THREE.BufferAttribute;
	const colors = attr.array as Float32Array;
	colors.set(chunk.baseColors);
	if (isSelectedModel) {
		for (let i = 0; i < colors.length; i++) colors[i] = Math.min(1, colors[i] * 1.6 + 0.15);
		if (selectedPolys.size > 0) {
			const paint = skippedByBulkTransform ? SOUP_PAINT_SKIPPED : SOUP_PAINT_AMBER;
			const map = chunk.faceToPoly;
			for (let tri = 0; tri < chunk.triangleCount; tri++) {
				if (!selectedPolys.has(encodeSoupPoly(map[tri * 2], map[tri * 2 + 1]))) continue;
				for (let k = tri * 9; k < tri * 9 + 9; k += 3) {
					colors[k] = paint[0];
					colors[k + 1] = paint[1];
					colors[k + 2] = paint[2];
				}
			}
		}
	}
	chunk.painted = isSelectedModel;
	attr.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Marquee
// ---------------------------------------------------------------------------

/** Every polygon whose triangle centroid falls inside `frustum`, deduped. */
export function pickChunkPolysInFrustum(
	chunk: SoupChunk,
	frustum: THREE.Frustum,
): { soup: number; poly: number }[] {
	const arr = (chunk.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
	const map = chunk.faceToPoly;
	const seen = new Set<number>();
	const out: { soup: number; poly: number }[] = [];
	const pt = new THREE.Vector3();
	for (let tri = 0; tri < chunk.triangleCount; tri++) {
		const o = tri * 9;
		pt.set(
			(arr[o] + arr[o + 3] + arr[o + 6]) / 3,
			(arr[o + 1] + arr[o + 4] + arr[o + 7]) / 3,
			(arr[o + 2] + arr[o + 5] + arr[o + 8]) / 3,
		);
		if (!frustum.containsPoint(pt)) continue;
		const s = map[tri * 2];
		const p = map[tri * 2 + 1];
		const key = encodeSoupPoly(s, p);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ soup: s, poly: p });
	}
	return out;
}

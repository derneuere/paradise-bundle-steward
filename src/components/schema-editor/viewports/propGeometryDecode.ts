// Prop geometry decode — turns a track unit's prop placements into real,
// world-placed meshes for the WorldViewport (instead of the grey marker boxes).
//
// PropGraphicsList (0x10010) has no positions of its own — it is a catalogue
// mapping each prop TYPE to its Model resource. Real prop meshes come from a
// JOIN with PropInstanceData (0x10011), which carries the per-instance world
// transform + the prop type:
//
//   PropInstanceData.instances[i]  → typeId + mWorldTransform (where)
//     → PropGraphicsList: the PropGraphics entry whose muTypeId == typeId
//     → its mpPropModel import (0 on disk) resolved via getImportsByPtrOffset
//       at field offset (0x20 + propIndex*0x0C + 0x04)              → Model id
//     → Model (0x2A) — in THIS bundle or a companion (GLOBALPROPS.BIN)
//     → grey BufferGeometry (reusing the track decoder's Model→Renderable path)
//     → placed at the instance's transform.
//
// The type→Model namespace match (PropInstanceData.typeId == PropGraphics
// .muTypeId, both indexing prop-types) is verified across the fixtures: every
// placed instance type appears in its unit's PropGraphicsList.
//
// Scope, like the track: grey untextured geometry only. Pure (no React / no
// THREE materials) so the join can be unit-tested in node — the React layer
// (PropGeometry.tsx) owns materials, picking, and the scene graph.
//
// Split into a HEAVY step (type → decoded geometry, stable for a bundle) and a
// CHEAP step (placement from the live PropInstanceData), so editing a prop's
// position re-places without re-decoding every Model.

import * as THREE from 'three';
import type { ParsedBundle, ResourceEntry } from '@/lib/core/types';
import { getImportsByPtrOffset } from '@/lib/core/bundle';
import { extractResourceSize, isCompressed, decompressData } from '@/lib/core/resourceManager';
import {
	parsePropGraphicsList,
	PROP_GRAPHICS_LIST_TYPE_ID,
} from '@/lib/core/propGraphicsList';
import type { ParsedPropInstanceData } from '@/lib/core/propInstanceData';
import type { ParsedVertexDescriptor } from '@/lib/core/renderable';
import { findResourceById } from '@/lib/core/renderable';
import { MODEL_TYPE_ID } from '@/lib/core/model';
import { decodeModelGeometries, instanceTransformToMatrix4 } from './trackGeometryDecode';

// PropGraphics array begins at 0x20; each record is 0x0C with mpPropModel at +4.
const PROP_GRAPHICS_OFFSET = 0x20;
const PROP_RECORD_SIZE = 0x0c;
const PROP_MODEL_FIELD = 0x04;

/** A bundle paired with its raw bytes — prop Models often live in a companion
 *  bundle (GLOBALPROPS.BIN), so resolution searches these after the local one. */
export type BundleSource = { bundle: ParsedBundle; buffer: ArrayBuffer };

/** One instanced draw: a shared geometry plus every placement of it. */
export type PropMeshGroup = {
	geometry: THREE.BufferGeometry;
	placements: { matrix: THREE.Matrix4; instanceIndex: number }[];
};

export type PlacedProps = {
	groups: PropMeshGroup[];
	/** PropInstanceData instance indices that resolved to a real mesh. The
	 *  caller draws marker-box fallbacks for every other instance. */
	resolvedInstanceIndices: Set<number>;
};

// ---------------------------------------------------------------------------
// Raw extraction (block 0) — inlined to keep this module off the registry, the
// same approach trackGeometryDecode uses.
// ---------------------------------------------------------------------------

function extractBlock0(buffer: ArrayBuffer, bundle: ParsedBundle, entry: ResourceEntry): Uint8Array | null {
	const size = extractResourceSize(entry.sizeAndAlignmentOnDisk[0]);
	if (size <= 0) return null;
	const start = (bundle.header.resourceDataOffsets[0] + entry.diskOffsets[0]) >>> 0;
	if (start + size > buffer.byteLength) return null;
	let bytes: Uint8Array = new Uint8Array(buffer, start, size);
	if (isCompressed(bytes)) bytes = decompressData(bytes) as Uint8Array;
	return bytes;
}

// ---------------------------------------------------------------------------
// Type → Model id map (from the bundle's PropGraphicsList + its import table)
// ---------------------------------------------------------------------------

/**
 * Build `prop typeId → Model resourceId` for a bundle's PropGraphicsList.
 * Returns an empty map when the bundle has no PropGraphicsList. Throws are
 * swallowed (a malformed catalogue just yields no prop meshes — the boxes
 * remain), since this feeds a best-effort viewport, never an edit path.
 */
export function buildPropTypeModelMap(bundle: ParsedBundle, buffer: ArrayBuffer): Map<number, bigint> {
	const map = new Map<number, bigint>();
	const entry = bundle.resources.find((r) => r.resourceTypeId === PROP_GRAPHICS_LIST_TYPE_ID);
	if (!entry) return map;
	try {
		const raw = extractBlock0(buffer, bundle, entry);
		if (!raw) return map;
		const pgl = parsePropGraphicsList(raw);
		const index = bundle.resources.indexOf(entry);
		const imports = getImportsByPtrOffset(bundle.imports, bundle.resources, index);
		pgl.props.forEach((prop, i) => {
			const id = imports.get(PROP_GRAPHICS_OFFSET + i * PROP_RECORD_SIZE + PROP_MODEL_FIELD);
			if (id != null) map.set(prop.muTypeId, id);
		});
	} catch {
		return map;
	}
	return map;
}

/** Find the bundle that actually holds a Model resource — local first, then the
 *  companion bundles (prop Models live in GLOBALPROPS.BIN). */
function findModelHome(modelId: bigint, local: BundleSource, externals: BundleSource[]): BundleSource | null {
	const here = findResourceById(local.bundle, modelId);
	if (here && here.resourceTypeId === MODEL_TYPE_ID) return local;
	for (const ext of externals) {
		const e = findResourceById(ext.bundle, modelId);
		if (e && e.resourceTypeId === MODEL_TYPE_ID) return ext;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Heavy step: type → decoded geometry (stable for a bundle set)
// ---------------------------------------------------------------------------

/**
 * Decode each prop type used by `localBundle` to its grey geometries. The keys
 * are exactly the types whose Model resolved AND yielded geometry — placement
 * treats any instance whose type is absent here as "unresolved" (draw a box).
 * Geometry is shared across types that map to the same Model.
 */
export function decodePropTypeGeometry(
	localBundle: ParsedBundle,
	localBuffer: ArrayBuffer,
	externals: BundleSource[] = [],
): Map<number, THREE.BufferGeometry[]> {
	const local: BundleSource = { bundle: localBundle, buffer: localBuffer };
	const typeToModel = buildPropTypeModelMap(localBundle, localBuffer);
	const vdCache = new Map<bigint, ParsedVertexDescriptor | null>();
	const byModel = new Map<string, THREE.BufferGeometry[]>();
	const out = new Map<number, THREE.BufferGeometry[]>();

	for (const [typeId, modelId] of typeToModel) {
		const key = modelId.toString();
		let geoms = byModel.get(key);
		if (!geoms) {
			const home = findModelHome(modelId, local, externals);
			geoms = home
				? decodeModelGeometries(home.buffer, home.bundle, modelId, vdCache).map((g) => g.geometry)
				: [];
			byModel.set(key, geoms);
		}
		if (geoms.length > 0) out.set(typeId, geoms);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Cheap step: place the live instances against the decoded geometry
// ---------------------------------------------------------------------------

/**
 * Group the prop instances by the geometry they resolve to. Re-run on every
 * PropInstanceData edit (it is cheap — no decode); the heavy
 * `decodePropTypeGeometry` result is reused across edits.
 */
export function placeProps(
	pid: ParsedPropInstanceData,
	typeGeometry: Map<number, THREE.BufferGeometry[]>,
): PlacedProps {
	const byGeometry = new Map<THREE.BufferGeometry, PropMeshGroup>();
	const resolvedInstanceIndices = new Set<number>();

	pid.instances.forEach((inst, i) => {
		const geoms = typeGeometry.get(inst.typeId);
		if (!geoms || geoms.length === 0) return; // unresolved → box fallback
		resolvedInstanceIndices.add(i);
		const matrix = instanceTransformToMatrix4(inst.mWorldTransform);
		for (const geometry of geoms) {
			let group = byGeometry.get(geometry);
			if (!group) {
				group = { geometry, placements: [] };
				byGeometry.set(geometry, group);
			}
			group.placements.push({ matrix, instanceIndex: i });
		}
	});

	return { groups: [...byGeometry.values()], resolvedInstanceIndices };
}

/** Free the GPU buffers of every decoded prop geometry (dedupe by identity —
 *  geometry is shared across instances and types that map to the same Model). */
export function disposePropTypeGeometry(typeGeometry: Map<number, THREE.BufferGeometry[]>): void {
	const seen = new Set<THREE.BufferGeometry>();
	for (const geoms of typeGeometry.values()) {
		for (const g of geoms) {
			if (seen.has(g)) continue;
			seen.add(g);
			g.dispose();
		}
	}
}

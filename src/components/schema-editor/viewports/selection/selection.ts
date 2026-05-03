// Selection — overlay-internal selection shape and codec helpers.
//
// The WorldViewport contract (ADR-0001) is that overlays receive and emit a
// schema NodePath. This module is the seam *inside* an overlay between that
// public NodePath and the per-overlay InstancedMesh paint loop, which needs
// a flat shape it can compare cheaply across hundreds of instances per frame.
//
// `Selection` is intentionally minimal: a `kind` discriminator (e.g. `'road'`,
// `'street'`, `'junction'`, or for future overlays `'landmark'`, `'section'`,
// `'portal'`, ...) and a tuple of `indices`. Most overlays use a single index;
// nested entities (AI section portals, soup polygons inside a soup) use two.
//
// `SelectionCodec` is the per-overlay glue: pathToSelection / selectionToPath.
// Each overlay defines exactly one codec and feeds it into useInstancedSelection
// per-mesh.

import type { NodePath } from '@/lib/schema/walk';

/**
 * Overlay-internal selection. `kind` distinguishes which kind of entity this
 * selection refers to (one overlay can host several InstancedMeshes, each
 * with its own kind). `indices` is a small tuple — usually 1 element, but
 * 2-deep for nested entities like portals inside a section.
 */
export type Selection = { kind: string; indices: readonly number[] };

/**
 * The two-direction codec an overlay registers for its NodePath shapes.
 *
 *   pathToSelection(path) → Selection | null
 *     Decode a schema path into the selection it points at, or null if the
 *     path doesn't address an entity this overlay paints. Sub-paths inside
 *     an entity (e.g. drilling into `['streets', 5, 'mAiInfo', ...]`) should
 *     collapse to the parent ("this street is selected").
 *
 *   selectionToPath(sel) → NodePath
 *     Build the canonical schema path for a selection. Inverse of
 *     pathToSelection on entity-level paths; sub-paths are not preserved
 *     (they were never in the Selection to begin with).
 */
export type SelectionCodec = {
	pathToSelection: (path: NodePath) => Selection | null;
	selectionToPath: (sel: Selection) => NodePath;
};

/**
 * Identity helper — declares a SelectionCodec with type inference. Exists to
 * give overlay authors a stable export site (and a place we could add codec
 * validation in the future without changing call sites).
 */
export function defineSelectionCodec(codec: SelectionCodec): SelectionCodec {
	return codec;
}

/**
 * Structural equality on Selection. Returns true for two nulls. A `kind`
 * mismatch short-circuits before the indices walk.
 */
export function selectionEquals(a: Selection | null, b: Selection | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	if (a.kind !== b.kind) return false;
	if (a.indices.length !== b.indices.length) return false;
	for (let i = 0; i < a.indices.length; i++) {
		if (a.indices[i] !== b.indices[i]) return false;
	}
	return true;
}

/**
 * Stable string key for Set<string> / Map<string, T> membership. The `:` and
 * `/` separators are not legal in any kind we expect (schema field names are
 * lowerCamel) so collisions across kinds are impossible.
 */
export function selectionKey(sel: Selection): string {
	return `${sel.kind}:${sel.indices.join('/')}`;
}

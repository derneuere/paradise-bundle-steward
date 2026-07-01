// Colour-precedence resolution for the TriggerData overlay's non-hook meshes.
//
// The BatchedRegionBoxes InstancedMesh hosts four selection kinds on one mesh
// and SpawnArrows renders one <mesh> per cone, so neither can lean on
// useInstancedSelection to decide which highlight tint an entity gets. This
// module is the single tested home for that decision so the two call sites
// cannot drift from each other — or from the hook, which resolves the same
// precedence.
//
// Precedence: primary > hover > bulk > base. Hover beats bulk because a hover
// indicator under the cursor is feedback the user just produced and should
// stay visible even on a multi-selected entity (matches
// useInstancedSelection.computeInstanceState).

import type * as THREE from 'three';
import type { SelectionTheme } from './selection/theme';

/** The three flags that select a highlight tint, resolved against the base. */
export type RegionSelectionFlags = {
	isPrimary: boolean;
	isHovered: boolean;
	isBulk: boolean;
};

/** Which paint bucket an entity lands in after precedence resolution. */
export type RegionColorState = 'primary' | 'hover' | 'bulk' | 'base';

/**
 * Pure precedence decision — returns the bucket an entity paints in.
 * Exported so both the colour picker and the spawn-material chooser share
 * one implementation (and one set of tests).
 */
export function pickRegionState({ isPrimary, isHovered, isBulk }: RegionSelectionFlags): RegionColorState {
	if (isPrimary) return 'primary';
	if (isHovered) return 'hover';
	if (isBulk) return 'bulk';
	return 'base';
}

/**
 * Resolve the THREE.Color an entity should paint. `baseColor` is the entity's
 * own resting tint (region kind colour). The theme supplies the three
 * highlight tints. Returns a reference to the theme colour or `baseColor` —
 * callers must not mutate the result (they feed it straight to setColorAt).
 */
export function pickRegionColor(
	flags: RegionSelectionFlags,
	baseColor: THREE.Color,
	theme: SelectionTheme,
): THREE.Color {
	switch (pickRegionState(flags)) {
		case 'primary': return theme.primary;
		case 'hover': return theme.hover;
		case 'bulk': return theme.bulk;
		case 'base': return baseColor;
	}
}

// SelectionTheme — single source of truth for the highlight palette every
// WorldViewport overlay paints with.
//
// Pre-extraction every overlay defined its own SEL_COLOR / HOV_COLOR locally.
// They all agreed on the orange (0xffaa33) and blue (0x66aaff), but the
// duplication was a drift hazard — one overlay tweaking its palette would
// have silently diverged from the rest. The amber `bulk` tint is new with
// the unified hook; multi-select doesn't ship in StreetData but the tone is
// reserved here so future overlays don't reinvent it.

import * as THREE from 'three';

export type SelectionTheme = {
	/** Single-selection highlight (orange). */
	primary: THREE.Color;
	/** Multi-selection highlight (amber, slightly desaturated against primary). */
	bulk: THREE.Color;
	/** Pointer hover (light blue). */
	hover: THREE.Color;
};

export const SELECTION_THEME: SelectionTheme = {
	primary: new THREE.Color(0xffaa33),
	bulk: new THREE.Color(0xffcc66),
	hover: new THREE.Color(0x66aaff),
};

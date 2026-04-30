// WorldViewport — the deep module behind the centre pane for any Resource that
// lives in Burnout-world coordinates (AI sections, street data, traffic data,
// trigger data, zone list, polygon soup list).
//
// This file holds the *interface* — the contract callers must implement and
// the chrome's prop shape. The implementation lives in WorldViewport.tsx
// (TODO: not yet written; this types file is the design artefact).
//
// Three load-bearing decisions are recorded as ADRs and should not be
// re-litigated without re-reading them:
//
//   - docs/adr/0001 — Selection currency is `NodePath`. Overlays receive and
//     emit schema paths; they do not have their own typed selection shapes.
//   - docs/adr/0002 — Data flows top-down via React props. Overlays do not
//     read from BundleContext.
//   - docs/adr/0003 — One fixed Burnout-world camera. Overlays do not declare
//     scene bounds; the chrome does not auto-fit per resource.
//
// Usage shape (single overlay):
//
//   <WorldViewport>
//     <AISectionsOverlay
//       data={aiData}
//       selectedPath={selectedPath}
//       onSelect={selectPath}
//     />
//   </WorldViewport>
//
// Multi-overlay (future cross-resource routes — e.g. AI sections + the world
// collision data they depend on) is plain React composition:
//
//   <WorldViewport>
//     <CollisionOverlay  data={collision} selectedPath={p} onSelect={s} />
//     <AISectionsOverlay data={ai}        selectedPath={p} onSelect={s} />
//   </WorldViewport>

import type { ReactNode } from 'react';
import type { NodePath } from '@/lib/schema/walk';

/**
 * Props every WorldViewport overlay receives.
 *
 * Generic in `T` so each overlay can declare the `ParsedX` it expects (e.g.
 * `WorldOverlayProps<ParsedAISections>`). The page/EditorRoute is responsible
 * for casting/getting the right shape out of `BundleContext` — see ADR-0002.
 */
export type WorldOverlayProps<T = unknown> = {
	/** The overlay's resource data. Fetched by the page/EditorRoute and threaded down (ADR-0002). */
	data: T;

	/**
	 * The currently selected schema path. The overlay decides what to highlight
	 * by matching this against the path shapes it knows (e.g. AISections matches
	 * `['sections', i]`, `['sections', i, 'portals', p]`, etc.).
	 *
	 * An empty path means "no selection" — the overlay should render in its
	 * default unselected state.
	 */
	selectedPath: NodePath;

	/**
	 * Called when the user clicks something in this overlay's part of the scene.
	 * The overlay emits a schema path (ADR-0001) — never a typed selection
	 * object. Emit `[]` to clear selection.
	 */
	onSelect: (path: NodePath) => void;

	/**
	 * Optional. Present only on overlays that support in-scene editing (e.g.
	 * StreetData's drag-to-move). Returns the next root value for the resource;
	 * the page is expected to wire this through the SchemaEditorProvider's
	 * `setAtPath([], next)` so the mutation participates in structural sharing.
	 *
	 * Read-only overlays (Renderable, ZoneList today) simply omit this prop.
	 */
	onChange?: (next: T) => void;
};

/**
 * A WorldViewport overlay component. Returns React Three Fiber scene nodes —
 * meshes, lines, html overlays — that mount inside the chrome's `<Canvas>`.
 *
 * Overlay components are pure functions of their props. They must not read
 * BundleContext or any other resource state (ADR-0002), which keeps them
 * mountable in tests with hand-crafted fixture data.
 */
export type WorldOverlayComponent<T = unknown> = (props: WorldOverlayProps<T>) => ReactNode;

/**
 * Props for the WorldViewport chrome.
 *
 * `children` is one or more overlay elements. The chrome does not introspect
 * them — it just mounts them as descendants of its `<Canvas>`. This means
 * multi-overlay composition is "give it more children," with no descriptor
 * gymnastics.
 */
export type WorldViewportProps = {
	children: ReactNode;
};

/**
 * The WorldViewport chrome owns, exclusively:
 *
 *   - the `<Canvas>` (react-three-fiber)
 *   - a `<PerspectiveCamera>` at a fixed Burnout-world position (ADR-0003)
 *   - `<OrbitControls>` with sensible defaults
 *   - default scene lighting and background
 *   - a `<ViewportErrorBoundary>` that resets when the editor route changes
 *
 * The chrome explicitly does NOT own:
 *
 *   - scene-bounds computation or per-overlay camera fitting (ADR-0003)
 *   - per-resource selection-shape translation (ADR-0001) — overlays handle
 *     `NodePath` directly
 *   - resource data fetching (ADR-0002) — the page/EditorRoute does that
 */
export type WorldViewportComponent = (props: WorldViewportProps) => ReactNode;

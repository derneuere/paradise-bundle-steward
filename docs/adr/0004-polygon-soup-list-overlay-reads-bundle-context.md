# PolygonSoupListOverlay reads BundleContext directly (exception to ADR-0002)

ADR-0002 says WorldViewport overlays receive their resource data via React props, with the page fetching from `BundleContext` and threading it down. `PolygonSoupListOverlay` originally deviated: it called `useBundle()` directly to obtain the full array of `ParsedPolygonSoupList` resources in the bundle. The deviation was intentional. PolygonSoupList is structurally multi-resource — a bundle holds 0..N PolygonSoupList resources (one per track unit) and the overlay must render the *union* of all of them as a single batched mesh, not just the one the schema editor is currently editing. Single-resource overlays (ZoneList, StreetData, AISections, TrafficData, TriggerData) still follow ADR-0002 unchanged; this exception applies only to overlays that render a multi-resource union.

## Multi-Bundle resolution (issue #23)

The original deviation was written for the single-Bundle case. Once `WorldViewportComposition` started loading multiple Bundles into one shared scene, the workspace-direct read leaked across Bundles: `useFallbackModels` resolved to `useFirstLoadedBundle()` → `bundles[0]`, so an overlay descriptor that *belonged* to `bundles[1]` rendered `bundles[0]`'s soups. With `TRK_UNIT_07.BUN` (no PSL) at index 0 and `WORLDCOL.BIN` (the actual soups) at index 1, the batched-mesh path silently returned empty.

Resolution: the overlay no longer reads the workspace itself. `WorldViewportComposition` passes the per-Bundle PSL union down via a `bundleSoups` prop, sourced from `OverlayDescriptor.bundleSiblings` (the same-key list from the descriptor's Bundle). The overlay is now Bundle-blind in the composition path, fully aligned with ADR-0002's "data via props" rule for in-Workspace use.

The legacy `PolygonSoupListPage` still mounts a `PolygonSoupListContext.Provider` (driven by ctrl/cmd+click bulk-selection mechanics that don't fit cleanly through props yet); the overlay prefers `ctx.models` when a context is provided and falls back to `bundleSoups` otherwise. So this ADR's exception now applies only to the legacy page-level flow, not to multi-Bundle Workspace rendering.

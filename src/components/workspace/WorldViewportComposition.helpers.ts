// Pure helpers behind WorldViewportComposition — extracted so the
// "list every overlay we should mount across the Workspace" and
// "what selectedPath does each overlay receive" decisions can be unit-
// tested without a DOM.
//
// The composition itself (issue #18) iterates every loaded EditableBundle,
// pairs its parsed resources against the World-viewport family, and emits
// one OverlayDescriptor per (bundle, key, instance) it should mount as a
// child of a single shared <WorldViewport>. That descriptor list is the
// thing tests can assert on.

import type {
	EditableBundle,
	VisibilityNode,
	WorkspaceSelection,
} from '@/context/WorkspaceContext.types';
import type { NodePath } from '@/lib/schema/walk';

// ---------------------------------------------------------------------------
// World-viewport family
// ---------------------------------------------------------------------------

/**
 * Resource keys whose data lives in Burnout-world coordinates and whose
 * overlay knows how to render itself inside the shared <WorldViewport>
 * chrome. Other resource types (renderable's per-vehicle scene, texture's
 * 2D preview) have their own non-world viewports and aren't part of the
 * cross-Bundle composition.
 *
 * Order is rendering order: items earlier in the list render first, so
 * later items draw on top. Today we keep collision (polygonSoupList) and
 * AI/traffic/street geometry roughly co-planar — the order only matters
 * for translucent overlap, which is fine at the chosen alphas.
 */
export const WORLD_VIEWPORT_FAMILY_KEYS = [
	'polygonSoupList',
	'aiSections',
	'streetData',
	'trafficData',
	'triggerData',
	'zoneList',
] as const;

export type WorldViewportFamilyKey = typeof WORLD_VIEWPORT_FAMILY_KEYS[number];

const FAMILY_SET: ReadonlySet<string> = new Set<string>(WORLD_VIEWPORT_FAMILY_KEYS);

export function isWorldViewportFamilyKey(key: string): key is WorldViewportFamilyKey {
	return FAMILY_SET.has(key);
}

// ---------------------------------------------------------------------------
// OverlayDescriptor — one entry per (bundle, key, instance) to mount
// ---------------------------------------------------------------------------

/**
 * A single overlay element the composition is asking the renderer to mount.
 * Carries the addressable triple (`bundleId`, `resourceKey`, `index`) plus
 * the parsed model the overlay should receive via React props (ADR-0002).
 *
 * `model` is `unknown` here — the per-key switch in the composition casts
 * it to the right `ParsedX` shape before handing it to the overlay.
 *
 * `bundleSiblings` is the full per-bundle parsed-instance list for this
 * resource key (same reference shared across siblings — entries that failed
 * to parse stay as `null` to keep indexes aligned). The PolygonSoupList
 * overlay consumes this for its multi-resource batched-mesh union (ADR-0004
 * resolution for the multi-Bundle case); single-resource overlays ignore it.
 */
export type OverlayDescriptor = {
	bundleId: string;
	resourceKey: WorldViewportFamilyKey;
	index: number;
	model: unknown;
	bundleSiblings: (unknown | null)[];
};

/**
 * Walk every loaded Bundle and collect the overlay descriptors the
 * composition should mount. One descriptor per non-null instance of every
 * world-family resource key.
 *
 * Multi-instance resources (PolygonSoupList today) emit one descriptor per
 * instance per Bundle — matches issue #18's "one overlay element per
 * instance per Bundle" requirement. Single-instance resources emit at most
 * one descriptor per Bundle (index 0).
 *
 * Bundle order is preserved from the input list (load order). Within a
 * Bundle the order follows WORLD_VIEWPORT_FAMILY_KEYS so the rendering
 * order stays stable across re-renders.
 */
export function listWorldOverlays(
	bundles: readonly EditableBundle[],
): OverlayDescriptor[] {
	const out: OverlayDescriptor[] = [];
	for (const bundle of bundles) {
		for (const key of WORLD_VIEWPORT_FAMILY_KEYS) {
			const instances = bundle.parsedResourcesAll.get(key);
			if (!instances || instances.length === 0) continue;
			for (let i = 0; i < instances.length; i++) {
				const model = instances[i];
				if (model == null) continue;
				out.push({
					bundleId: bundle.id,
					resourceKey: key,
					index: i,
					model,
					bundleSiblings: instances,
				});
			}
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Selection routing
// ---------------------------------------------------------------------------

const EMPTY_PATH: NodePath = [];

/**
 * Resolve the `selectedPath` prop a given overlay descriptor should receive.
 *
 * An overlay only highlights anything when the Workspace's Selection points
 * at exactly that overlay's `(bundleId, resourceKey, index)` triple. For
 * every other overlay the selection is "somewhere else," so it gets the
 * empty path — overlays render in their default unselected state per
 * ADR-0001 ("an empty path means no selection").
 *
 * Returns the same empty-array reference for non-matching overlays so React
 * doesn't have to deep-compare `[]` vs `[]` per render.
 */
export function selectedPathFor(
	selection: WorkspaceSelection,
	descriptor: Pick<OverlayDescriptor, 'bundleId' | 'resourceKey' | 'index'>,
): NodePath {
	// Bundle / Resource-type-level selections leave `resourceKey` or `index`
	// undefined, in which case no overlay matches — every overlay gets the
	// empty path and renders unselected.
	if (
		selection &&
		selection.bundleId === descriptor.bundleId &&
		selection.resourceKey === descriptor.resourceKey &&
		selection.index === descriptor.index
	) {
		return selection.path;
	}
	return EMPTY_PATH;
}

// ---------------------------------------------------------------------------
// Visibility filter (issue #19)
// ---------------------------------------------------------------------------

/**
 * Drop overlay descriptors whose `(bundleId, resourceKey, index)` reads as
 * hidden by the Workspace's Visibility cascade. The composition mounts only
 * the survivors — a hidden Bundle / resource type / instance simply doesn't
 * contribute to the WorldViewport scene.
 *
 * Selection is intentionally *not* consulted here: the WorkspaceContext
 * keeps Selection independent of Visibility (CONTEXT.md / "Selection"), so
 * a hidden-but-selected resource still has its inspector / Tools mounted
 * even though its overlay is dropped.
 */
export function filterOverlaysByVisibility(
	overlays: readonly OverlayDescriptor[],
	isVisible: (node: VisibilityNode) => boolean,
): OverlayDescriptor[] {
	return overlays.filter((d) =>
		isVisible({
			bundleId: d.bundleId,
			resourceKey: d.resourceKey,
			index: d.index,
		}),
	);
}

// ---------------------------------------------------------------------------
// PolygonSoupList dedupe (perf)
//
// PSL is the only overlay whose render output is a *union* of every PSL
// instance in its Bundle (one batched mesh covering the whole world chunk).
// `listWorldOverlays` still emits one descriptor per instance (so per-
// instance visibility toggles + selection routing keep working), but if
// every one of those descriptors actually mounted a `<PolygonSoupListOverlay>`
// we'd build the same N-instance batched mesh N times and draw it N times
// each frame. WORLDCOL has ~256 PSL instances, so the naive shape pegs the
// renderer (issue #23 follow-up).
//
// `dedupePolygonSoupOverlays` collapses every PSL group within a Bundle to a
// single "lead" descriptor — the first survivor of the visibility filter.
// The lead's `bundleSiblings` is rewritten so any instance whose descriptor
// did NOT survive visibility filtering becomes `null`, which `buildGeometry`
// already treats as "render nothing for that index." So per-instance hides
// still work — they just collapse into one render pass per Bundle instead
// of N.
//
// Non-PSL descriptors are passed through untouched.
// ---------------------------------------------------------------------------

export function dedupePolygonSoupOverlays(
	overlays: readonly OverlayDescriptor[],
): OverlayDescriptor[] {
	// First pass: per-Bundle index of which PSL instance indexes survived
	// visibility filtering, and which survivor came first (the lead).
	const survivingByBundle = new Map<string, Set<number>>();
	const leadByBundle = new Map<string, OverlayDescriptor>();
	for (const d of overlays) {
		if (d.resourceKey !== 'polygonSoupList') continue;
		let s = survivingByBundle.get(d.bundleId);
		if (!s) {
			s = new Set<number>();
			survivingByBundle.set(d.bundleId, s);
			leadByBundle.set(d.bundleId, d);
		}
		s.add(d.index);
	}

	// Second pass: emit each non-PSL descriptor untouched, and emit ONE
	// PSL descriptor per Bundle (the lead) with siblings rewritten so hidden
	// indexes become null. Non-lead PSL descriptors are dropped — their
	// geometry is already covered by the lead's batched mesh.
	const out: OverlayDescriptor[] = [];
	const emittedLeads = new Set<string>();
	for (const d of overlays) {
		if (d.resourceKey !== 'polygonSoupList') {
			out.push(d);
			continue;
		}
		if (emittedLeads.has(d.bundleId)) continue;
		emittedLeads.add(d.bundleId);
		const lead = leadByBundle.get(d.bundleId)!;
		const surviving = survivingByBundle.get(d.bundleId)!;
		const fullSiblings = lead.bundleSiblings;
		const allVisible = surviving.size === fullSiblings.length;
		// Skip the array allocation when nothing is hidden — same reference
		// keeps useMemo identities stable for the overlay's geometry build.
		const filteredSiblings = allVisible
			? fullSiblings
			: fullSiblings.map((m, i) => (surviving.has(i) ? m : null));
		out.push({ ...lead, bundleSiblings: filteredSiblings });
	}
	return out;
}

// Render bindings — the React-laden half of an EditorProfile.
//
// Imported only by render sites (ViewportPane, WorldViewportComposition,
// WorkspacePage). Pulls in 3D overlays, extension components, and the
// schema-editor's tab adapters; the metadata registry (`./registry.ts`)
// stays React-free so non-rendering callers (tree-label suffix, helper
// modules under `src/components/workspace/`) can resolve schema + suffix
// without dragging three.js / leaflet through their import graph.
//
// Entries are addressed by `(resourceKey, profileKind)` so the same
// resource type can register different overlays for different variants
// (e.g. AISections registers a V12 overlay for retail and a separate
// `AISectionsLegacyOverlay` for the V4 prototype's read-only 3D viewer).

import type { ProfileRenderBinding } from './types';
import { aiSectionsExtensions } from '@/components/schema-editor/extensions/aiSectionsExtensions';
import { challengeListExtensions } from '@/components/schema-editor/extensions/challengeListExtensions';
import { polygonSoupListExtensions } from '@/components/schema-editor/extensions/collisionTagExtension';
import { renderableExtensions } from '@/components/schema-editor/extensions/renderableExtensions';
import { streetDataExtensions } from '@/components/schema-editor/extensions/streetDataExtensions';
import { trafficDataExtensions } from '@/components/schema-editor/extensions/trafficDataExtensions';
import { triggerDataExtensions } from '@/components/schema-editor/extensions/triggerDataExtensions';
import { vehicleListExtensions } from '@/components/schema-editor/extensions/vehicleListExtensions';
import { AISectionsLegacyOverlay } from '@/components/schema-editor/viewports/AISectionsLegacyOverlay';
import { AISectionsOverlay } from '@/components/schema-editor/viewports/AISectionsOverlay';
import { PolygonSoupListOverlay } from '@/components/schema-editor/viewports/PolygonSoupListOverlay';
import { StreetDataOverlay } from '@/components/schema-editor/viewports/StreetDataOverlay';
import { TrafficDataOverlay } from '@/components/schema-editor/viewports/TrafficDataOverlay';
import { TriggerDataOverlay } from '@/components/schema-editor/viewports/TriggerDataOverlay';
import { ZoneListOverlay } from '@/components/schema-editor/viewports/ZoneListOverlay';
import { pickProfileByKey } from './registry';

// Outer key: resource key (matches ResourceHandler.key). Inner key: profile
// kind (matches EditorProfile.kind). Lookup falls through to `undefined`
// when no binding exists — the render site renders an empty state then.
const BINDINGS: Record<string, Record<string, ProfileRenderBinding<unknown>>> = {
	aiSections: {
		v12: {
			overlay: AISectionsOverlay as ProfileRenderBinding['overlay'],
			extensions: aiSectionsExtensions,
		},
		// V4 prototype: read-only 3D viewer — no edit ops (no gizmo, no
		// corner handles, no edge menu, no snap toggle). Edit affordances
		// land incrementally in the "Legacy edit op:" follow-up issues.
		v4: {
			overlay: AISectionsLegacyOverlay as ProfileRenderBinding['overlay'],
		},
	},
	trafficData: {
		default: {
			overlay: TrafficDataOverlay as ProfileRenderBinding['overlay'],
			extensions: trafficDataExtensions,
		},
	},
	streetData: {
		default: {
			overlay: StreetDataOverlay as ProfileRenderBinding['overlay'],
			extensions: streetDataExtensions,
		},
	},
	triggerData: {
		default: {
			overlay: TriggerDataOverlay as ProfileRenderBinding['overlay'],
			extensions: triggerDataExtensions,
		},
	},
	zoneList: {
		default: {
			overlay: ZoneListOverlay as ProfileRenderBinding['overlay'],
		},
	},
	polygonSoupList: {
		default: {
			overlay: PolygonSoupListOverlay as ProfileRenderBinding['overlay'],
			extensions: polygonSoupListExtensions,
		},
	},
	challengeList: { default: { extensions: challengeListExtensions } },
	vehicleList: { default: { extensions: vehicleListExtensions } },
	renderable: { default: { extensions: renderableExtensions } },
	// playerCarColours / iceTakeDictionary / texture have no overlay or
	// extensions; the schema editor's default form is enough.
};

/** Look up the render binding for the variant of `model` parsed for
 *  `resourceKey`. Returns `undefined` when no profile matches the model
 *  OR when no binding is registered for the profile's kind (e.g. V4
 *  prototype — read-only inspector but no 3D overlay yet). */
export function pickRenderBinding(
	resourceKey: string,
	model: unknown,
): ProfileRenderBinding<unknown> | undefined {
	const profile = pickProfileByKey(resourceKey, model);
	if (!profile) return undefined;
	return BINDINGS[resourceKey]?.[profile.kind];
}

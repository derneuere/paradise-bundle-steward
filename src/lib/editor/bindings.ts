// Render bindings — the React-laden half of an EditorProfile.
//
// Imported only by render sites (ViewportPane, WorldViewportComposition,
// WorkspacePage). Pulls in 3D overlays, extension components, and the
// schema-editor's tab adapters; the metadata registry (`./registry.ts`)
// stays React-free so non-rendering callers (tree-label suffix, helper
// modules under `src/components/workspace/`) can resolve schema + suffix
// without dragging three.js / leaflet through their import graph. That
// split is deliberate — do not merge this file back into the registry.
//
// Entries are keyed on the EditorProfile OBJECT, not on a
// `(resourceKey, profileKind)` string pair. Strings let a binding drift
// onto a resource/variant that doesn't exist: the lookup just missed and
// the user got "No viewport available for X" at runtime. Naming the profile
// means a typo is an unresolved import, and `bind()`'s shared type
// parameter ties the overlay's model type to the profile's — pairing the
// V12 overlay with the V4 profile is now a compile error rather than a
// prop-shape mismatch discovered in the scene.

import type { EditorProfile, ProfileRenderBinding } from './types';
import { aiSectionsExtensions } from '@/components/schema-editor/extensions/aiSectionsExtensions';
import { attribSysVaultExtensions } from '@/components/schema-editor/extensions/attribSysVaultExtensions';
import { challengeListExtensions } from '@/components/schema-editor/extensions/challengeListExtensions';
import { iceTakeDictionaryExtensions } from '@/components/schema-editor/extensions/iceTakeDictionaryExtensions';
import { iceDataExtensions } from '@/components/schema-editor/extensions/iceDataExtensions';
import { polygonSoupListExtensions } from '@/components/schema-editor/extensions/collisionTagExtension';
import { renderableExtensions } from '@/components/schema-editor/extensions/renderableExtensions';
import { streetDataExtensions } from '@/components/schema-editor/extensions/streetDataExtensions';
import { trafficDataExtensions } from '@/components/schema-editor/extensions/trafficDataExtensions';
import { triggerDataExtensions } from '@/components/schema-editor/extensions/triggerDataExtensions';
import { vehicleListExtensions } from '@/components/schema-editor/extensions/vehicleListExtensions';
import { AISectionsLegacyOverlay } from '@/components/aisections/AISectionsLegacyOverlay';
import { AISectionsOverlay } from '@/components/aisections/AISectionsOverlay';
import { PolygonSoupListOverlay } from '@/components/schema-editor/viewports/PolygonSoupListOverlay';
import { PropInstanceDataOverlay } from '@/components/schema-editor/viewports/PropInstanceDataOverlay';
import { StaticSoundMapOverlay } from '@/components/schema-editor/viewports/StaticSoundMapOverlay';
import { StreetDataOverlay } from '@/components/schema-editor/viewports/StreetDataOverlay';
import { TrafficDataOverlay } from '@/components/schema-editor/viewports/TrafficDataOverlay';
import { TriggerDataOverlay } from '@/components/schema-editor/viewports/TriggerDataOverlay';
import { ZoneListOverlay } from '@/components/schema-editor/viewports/ZoneListOverlay';
import { aiSectionsV12Profile, aiSectionsV4Profile, aiSectionsV6Profile } from './profiles/aiSections';
import { attribSysVaultProfile } from './profiles/attribSysVault';
import { challengeListProfile } from './profiles/challengeList';
import { iceDataProfile } from './profiles/iceData';
import { iceTakeDictionaryProfile } from './profiles/iceTakeDictionary';
import { polygonSoupListProfile } from './profiles/polygonSoupList';
import { propInstanceDataProfile } from './profiles/propInstanceData';
import { renderableProfile } from './profiles/renderable';
import { staticSoundMapProfile } from './profiles/staticSoundMap';
import { streetDataProfile } from './profiles/streetData';
import { trafficDataV44Profile, trafficDataV45Profile } from './profiles/trafficData';
import { triggerDataProfile } from './profiles/triggerData';
import { vehicleListProfile } from './profiles/vehicleList';
import { zoneListProfile } from './profiles/zoneList';
import { pickProfileByKey, resourceKeyForProfile } from './registry';

type BoundProfile = readonly [EditorProfile<any>, ProfileRenderBinding<any>];

/** Pair a profile with its render binding. The shared `M` is the whole
 *  point: it forces the overlay to speak the same parsed-model type the
 *  profile claims, which is what the old `as ProfileRenderBinding['overlay']`
 *  casts were suppressing. */
function bind<M>(profile: EditorProfile<M>, binding: ProfileRenderBinding<M>): BoundProfile {
	return [profile, binding];
}

// Lookup falls through to `undefined` when a profile has no binding — the
// render site shows an empty state then. V22 TrafficData is deliberately
// absent (read-only inspector: no fixture has hull internals decoded, and
// the retail tabs all assume retail-shape arrays).
const BINDINGS = new Map<EditorProfile<any>, ProfileRenderBinding<any>>([
	bind(aiSectionsV12Profile, {
		overlay: AISectionsOverlay,
		extensions: aiSectionsExtensions,
	}),
	// V4 prototype: read-only 3D viewer — no edit ops (no gizmo, no corner
	// handles, no edge menu, no snap toggle). Edit affordances land
	// incrementally in the "Legacy edit op:" follow-up issues.
	bind(aiSectionsV4Profile, { overlay: AISectionsLegacyOverlay }),
	// V6 prototype: same overlay component as V4 (the LegacyOverlay already
	// accepts the V4 | V6 union). The schema editor's right pane gets the V6
	// schema with spanIndex / district fields the V4 schema doesn't have.
	// Same read-only treatment as V4.
	bind(aiSectionsV6Profile, { overlay: AISectionsLegacyOverlay }),
	// V45 retail: the full editor surface — 3D overlay + every Phase-1/2 tab
	// as a schema-editor extension.
	bind(trafficDataV45Profile, {
		overlay: TrafficDataOverlay,
		extensions: trafficDataExtensions,
	}),
	// V44 retail (Paradise PS3 era): same shape as V45, same overlay /
	// extensions — only the tree-row suffix differs.
	bind(trafficDataV44Profile, {
		overlay: TrafficDataOverlay,
		extensions: trafficDataExtensions,
	}),
	bind(streetDataProfile, {
		overlay: StreetDataOverlay,
		extensions: streetDataExtensions,
	}),
	bind(triggerDataProfile, {
		overlay: TriggerDataOverlay,
		extensions: triggerDataExtensions,
	}),
	bind(zoneListProfile, { overlay: ZoneListOverlay }),
	bind(polygonSoupListProfile, {
		overlay: PolygonSoupListOverlay,
		extensions: polygonSoupListExtensions,
	}),
	bind(propInstanceDataProfile, { overlay: PropInstanceDataOverlay }),
	bind(staticSoundMapProfile, { overlay: StaticSoundMapOverlay }),
	bind(challengeListProfile, { extensions: challengeListExtensions }),
	bind(vehicleListProfile, { extensions: vehicleListExtensions }),
	bind(renderableProfile, { extensions: renderableExtensions }),
	// AttribSys Vault's per-attribute typed `fields` are a custom field; the
	// extension resolves the right per-class schema by classHash.
	bind(attribSysVaultProfile, { extensions: attribSysVaultExtensions }),
	// ICE Take Dictionary's per-take `runs` are a custom field; the extension
	// renders the typed per-channel keyframe editor.
	bind(iceTakeDictionaryProfile, { extensions: iceTakeDictionaryExtensions }),
	// ICE Data is a single standalone take; it reuses the same channel editor,
	// but rooted at the resource's `take` rather than entries[i].take.
	bind(iceDataProfile, { extensions: iceDataExtensions }),
	// playerCarColours / texture have no overlay or extensions; the schema
	// editor's default form is enough.
]);

/** Look up the render binding for the variant of `model` parsed for
 *  `resourceKey`. Returns `undefined` when no profile matches the model
 *  OR when the matched profile has no binding (e.g. V22 TrafficData —
 *  read-only inspector but no 3D overlay yet). */
export function pickRenderBinding(
	resourceKey: string,
	model: unknown,
): ProfileRenderBinding<unknown> | undefined {
	const profile = pickProfileByKey(resourceKey, model);
	if (!profile) return undefined;
	return BINDINGS.get(profile);
}

/** Handler keys with at least one overlay-bearing binding — i.e. the
 *  resources that actually draw something into a WorldViewport. Pinned
 *  against `WORLD_VIEWPORT_FAMILY_KEYS` by the contract test so the family
 *  list and the bindings can't drift apart. A key whose profile isn't
 *  registered in `./registry.ts` (an orphan binding) is reported as
 *  `undefined` and skipped — the contract test asserts there are none. */
export function overlayBoundResourceKeys(): (string | undefined)[] {
	const keys: (string | undefined)[] = [];
	for (const [profile, binding] of BINDINGS) {
		if (!binding.overlay) continue;
		keys.push(resourceKeyForProfile(profile));
	}
	return keys;
}

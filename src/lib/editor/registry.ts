// Editor-aware registry — the only place the Workspace asks "given this
// parsed model, which schema / overlay / extensions / conversions should
// the editor use?" Wraps the core registry's typeId↔handler map with a
// per-typeId list of EditorProfiles that the editor can choose between.
//
// See ADR-0008 for the layering rationale (parsers stay React-free; editor
// registry adds React-aware schema/overlay/extension wiring on top of the
// core registry).
//
// Registration entry point is the static array near the top of this file —
// when a new resource type's editor surface is built (or a new variant of
// an existing type), add its profile here and the rest is automatic. Other
// editor sites (`WorkspacePage`, `WorldViewportComposition`, `ViewportPane`)
// only see the lookup helpers — never the registration array directly.
//
// Identity comes from the Handler, never from this file: an entry names the
// core `ResourceHandler` object and `typeId` / `key` are read through it.
// The previous shape re-declared both by hand, and a wrong `typeId` was
// silent — every editor lookup goes through `key`, so the whole UI kept
// working while `pickProfile(typeId, model)` (the export planner's entry
// point, `src/lib/conversion/exportPlan.ts`) missed and quietly dropped the
// Resource from the export plan. Eleven such typos shipped that way, one of
// them parking playerCarColours on vehicleList's real id. Reading the pair
// off the Handler makes that whole class of bug unrepresentable.
//
// The Handlers come from the core registry's index, never from their
// individual files: parsers import `bundle`, which imports the index, so
// entering that graph at a leaf handler would leave the index's own handler
// bindings uninitialised when the cycle closes.

import type { ResourceHandler } from '@/lib/core/registry/handler';
import {
	aemsBankHandler, aiSectionsHandler, aptDataHandler, attribSysVaultHandler,
	challengeListHandler, colourCubeHandler, commsToolListDefinitionHandler, commsToolListHandler,
	csisHandler, deformationSpecHandler, environmentDictionaryHandler, environmentKeyframeHandler,
	environmentTimeLineHandler, flaptFileHandler, fontHandler, genericRwacWaveContentHandler,
	guiPopupHandler, hudMessageHandler, hudMessageSequenceDictionaryHandler, hudMessageSequenceHandler,
	iceDataHandler, iceListHandler, iceTakeDictionaryHandler, idListHandler,
	instanceListHandler, languageHandler, massiveLookupTableHandler, nicotineHandler,
	particleDescriptionCollectionHandler, particleDescriptionHandler, playerCarColoursHandler, polygonSoupListHandler,
	propGraphicsListHandler, propInstanceDataHandler, propPhysicsHandler, registryHandler,
	renderableHandler, shaderHandler, snapshotDataHandler, splicerHandler,
	staticSoundMapHandler, streetDataHandler, textureHandler, textureNameMapHandler,
	trafficDataHandler, triggerDataHandler, vehicleListHandler, vfxMeshCollectionHandler,
	vfxPropCollectionHandler, wheelListHandler, worldPainter2DHandler, zoneListHandler,
} from '@/lib/core/registry';

import { aiSectionsV12Profile, aiSectionsV4Profile, aiSectionsV6Profile } from './profiles/aiSections';
import { aemsBankProfile } from './profiles/aemsBank';
import { attribSysVaultProfile } from './profiles/attribSysVault';
import { deformationSpecProfile } from './profiles/deformationSpec';
import { aptDataProfile } from './profiles/aptData';
import { challengeListProfile } from './profiles/challengeList';
import { csisProfile } from './profiles/csis';
import { colourCubeProfile } from './profiles/colourCube';
import { commsToolListProfile } from './profiles/commsToolList';
import { commsToolListDefinitionProfile } from './profiles/commsToolListDefinition';
import { environmentDictionaryProfile } from './profiles/environmentDictionary';
import { environmentKeyframeProfile } from './profiles/environmentKeyframe';
import { environmentTimeLineProfile } from './profiles/environmentTimeLine';
import { flaptFileProfile } from './profiles/flaptFile';
import { fontProfile } from './profiles/font';
import { genericRwacWaveContentProfile } from './profiles/genericRwacWaveContent';
import { guiPopupProfile } from './profiles/guiPopup';
import { hudMessageProfile } from './profiles/hudMessage';
import { hudMessageSequenceProfile } from './profiles/hudMessageSequence';
import { hudMessageSequenceDictionaryProfile } from './profiles/hudMessageSequenceDictionary';
import { iceTakeDictionaryProfile } from './profiles/iceTakeDictionary';
import { instanceListProfile } from './profiles/instanceList';
import { iceListProfile } from './profiles/iceList';
import { iceDataProfile } from './profiles/iceData';
import { idListProfile } from './profiles/idList';
import { languageProfile } from './profiles/language';
import { massiveLookupTableProfile } from './profiles/massiveLookupTable';
import { nicotineProfile } from './profiles/nicotine';
import { particleDescriptionProfile } from './profiles/particleDescription';
import { particleDescriptionCollectionProfile } from './profiles/particleDescriptionCollection';
import { playerCarColoursProfile } from './profiles/playerCarColours';
import { registryProfile } from './profiles/registry';
import { polygonSoupListProfile } from './profiles/polygonSoupList';
import { propInstanceDataProfile } from './profiles/propInstanceData';
import { propGraphicsListProfile } from './profiles/propGraphicsList';
import { propPhysicsProfile } from './profiles/propPhysics';
import { renderableProfile } from './profiles/renderable';
import { shaderProfile } from './profiles/shader';
import { snapshotDataProfile } from './profiles/snapshotData';
import { splicerProfile } from './profiles/splicer';
import { staticSoundMapProfile } from './profiles/staticSoundMap';
import { streetDataProfile } from './profiles/streetData';
import { textureProfile } from './profiles/texture';
import { textureNameMapProfile } from './profiles/textureNameMap';
import { vfxMeshCollectionProfile } from './profiles/vfxMeshCollection';
import { vfxPropCollectionProfile } from './profiles/vfxPropCollection';
import { wheelListProfile } from './profiles/wheelList';
import {
	trafficDataV22Profile,
	trafficDataV44Profile,
	trafficDataV45Profile,
} from './profiles/trafficData';
import { triggerDataProfile } from './profiles/triggerData';
import { vehicleListProfile } from './profiles/vehicleList';
import { worldPainter2DProfile } from './profiles/worldPainter2D';
import { zoneListProfile } from './profiles/zoneList';
import type { EditorProfile } from './types';
import {
	assertUniqueKinds,
	pickProfileFromList,
	suffixFromList,
} from './resolver';

/** Per-Handler profile sets. The Handler carries the entry's identity
 *  (`typeId`, `key`); the resolver picks the first profile whose `matches`
 *  returns true. List variant-specific profiles before any catch-all default
 *  for the same Handler. */
type RegistryEntry = {
	handler: ResourceHandler;
	profiles: EditorProfile<any>[];
};

const ENTRIES: RegistryEntry[] = [
	{
		handler: aiSectionsHandler,
		// Order matters: the FIRST profile is treated as the type's "primary"
		// variant by `profileSuffixFor` (V12 retail stays bare; V4 + V6
		// prototypes get `(v4 prototype)` / `(v6 prototype)` suffixes on the
		// tree row).
		profiles: [aiSectionsV12Profile, aiSectionsV4Profile, aiSectionsV6Profile],
	},
	{
		handler: trafficDataHandler,
		// Order matters: the FIRST profile is treated as the type's "primary"
		// variant by `profileSuffixFor` (V45 retail stays bare; V44 gets the
		// `(v44 Paradise PS3 era)` suffix on the tree row, V22 gets the
		// `(v22 prototype)` suffix).
		profiles: [trafficDataV45Profile, trafficDataV44Profile, trafficDataV22Profile],
	},
	{ handler: streetDataHandler, profiles: [streetDataProfile] },
	{ handler: triggerDataHandler, profiles: [triggerDataProfile] },
	{ handler: zoneListHandler, profiles: [zoneListProfile] },
	{ handler: polygonSoupListHandler, profiles: [polygonSoupListProfile] },
	{ handler: propInstanceDataHandler, profiles: [propInstanceDataProfile] },
	{ handler: propGraphicsListHandler, profiles: [propGraphicsListProfile] },
	{
		// Sibling of propInstanceData — a flat array of world transforms. It had
		// a schema but no profile, so the tree expanded its subtree through the
		// old schema-barrel fallback while the inspector (profile-only) rendered
		// empty. Registering it makes both surfaces agree.
		handler: instanceListHandler,
		profiles: [instanceListProfile],
	},
	{ handler: staticSoundMapHandler, profiles: [staticSoundMapProfile] },
	{ handler: propPhysicsHandler, profiles: [propPhysicsProfile] },
	{ handler: languageHandler, profiles: [languageProfile] },
	{ handler: hudMessageHandler, profiles: [hudMessageProfile] },
	{ handler: hudMessageSequenceHandler, profiles: [hudMessageSequenceProfile] },
	{ handler: hudMessageSequenceDictionaryHandler, profiles: [hudMessageSequenceDictionaryProfile] },
	{ handler: guiPopupHandler, profiles: [guiPopupProfile] },
	{ handler: worldPainter2DHandler, profiles: [worldPainter2DProfile] },
	{ handler: environmentKeyframeHandler, profiles: [environmentKeyframeProfile] },
	{ handler: environmentTimeLineHandler, profiles: [environmentTimeLineProfile] },
	{ handler: environmentDictionaryHandler, profiles: [environmentDictionaryProfile] },
	{ handler: colourCubeHandler, profiles: [colourCubeProfile] },
	{ handler: fontHandler, profiles: [fontProfile] },
	{ handler: massiveLookupTableHandler, profiles: [massiveLookupTableProfile] },
	{ handler: registryHandler, profiles: [registryProfile] },
	{ handler: particleDescriptionHandler, profiles: [particleDescriptionProfile] },
	{ handler: particleDescriptionCollectionHandler, profiles: [particleDescriptionCollectionProfile] },
	{ handler: textureNameMapHandler, profiles: [textureNameMapProfile] },
	{ handler: vfxMeshCollectionHandler, profiles: [vfxMeshCollectionProfile] },
	{ handler: vfxPropCollectionHandler, profiles: [vfxPropCollectionProfile] },
	{ handler: wheelListHandler, profiles: [wheelListProfile] },
	{ handler: idListHandler, profiles: [idListProfile] },
	{ handler: aptDataHandler, profiles: [aptDataProfile] },
	{ handler: genericRwacWaveContentHandler, profiles: [genericRwacWaveContentProfile] },
	{ handler: aemsBankHandler, profiles: [aemsBankProfile] },
	{ handler: csisHandler, profiles: [csisProfile] },
	{ handler: nicotineHandler, profiles: [nicotineProfile] },
	{ handler: splicerHandler, profiles: [splicerProfile] },
	{ handler: snapshotDataHandler, profiles: [snapshotDataProfile] },
	{ handler: flaptFileHandler, profiles: [flaptFileProfile] },
	{ handler: commsToolListDefinitionHandler, profiles: [commsToolListDefinitionProfile] },
	{ handler: commsToolListHandler, profiles: [commsToolListProfile] },
	{ handler: challengeListHandler, profiles: [challengeListProfile] },
	{ handler: vehicleListHandler, profiles: [vehicleListProfile] },
	{ handler: playerCarColoursHandler, profiles: [playerCarColoursProfile] },
	{ handler: iceTakeDictionaryHandler, profiles: [iceTakeDictionaryProfile] },
	{ handler: iceListHandler, profiles: [iceListProfile] },
	{ handler: iceDataHandler, profiles: [iceDataProfile] },
	{ handler: renderableHandler, profiles: [renderableProfile] },
	{ handler: shaderHandler, profiles: [shaderProfile] },
	{ handler: textureHandler, profiles: [textureProfile] },
	{ handler: attribSysVaultHandler, profiles: [attribSysVaultProfile] },
	{ handler: deformationSpecHandler, profiles: [deformationSpecProfile] },
];

const byTypeId = new Map<number, RegistryEntry>();
const byKey = new Map<string, RegistryEntry>();
// Reverse index: which entry does a given profile object belong to. Lets
// `bindings.ts` name the resource behind a profile without re-declaring a
// key of its own — the same de-duplication of identity that the entries
// themselves get from the Handler.
const entryByProfile = new Map<EditorProfile<any>, RegistryEntry>();
for (const entry of ENTRIES) {
	const { typeId, key } = entry.handler;
	if (byTypeId.has(typeId)) {
		throw new Error(`Duplicate editor registry typeId 0x${typeId.toString(16)}: ${key}`);
	}
	if (byKey.has(key)) {
		throw new Error(`Duplicate editor registry key: ${key}`);
	}
	assertUniqueKinds(key, entry.profiles);
	byTypeId.set(typeId, entry);
	byKey.set(key, entry);
	for (const profile of entry.profiles) entryByProfile.set(profile, entry);
}

/** Pick the EditorProfile that matches a parsed model.
 *
 *  - Returns `undefined` when the typeId isn't registered or no profile's
 *    `matches` returns true. The Workspace falls back to a "no editor for
 *    this resource" empty state in that case.
 *  - `model` may be `null` / `undefined` for early lifecycle states (e.g.
 *    a Bundle just opened, parse-in-progress). When the model is missing
 *    AND the typeId has exactly one registered profile, that single profile
 *    is returned — there's nothing to disambiguate. With multiple profiles,
 *    the lookup returns `undefined` until a model is available. */
export function pickProfile(typeId: number, model: unknown): EditorProfile | undefined {
	const entry = byTypeId.get(typeId);
	return entry ? pickProfileFromList(entry.profiles, model) : undefined;
}

/** Same as `pickProfile` but addresses the typeId by its handler key
 *  (`'aiSections'`, `'trafficData'`, etc.). Convenient for Workspace
 *  selection paths that already carry the key. */
export function pickProfileByKey(key: string, model: unknown): EditorProfile | undefined {
	const entry = byKey.get(key);
	return entry ? pickProfileFromList(entry.profiles, model) : undefined;
}

/** True when a handler key has at least one EditorProfile registered — i.e.
 *  the resource has a dedicated editor surface in the Workspace. Drives the
 *  UI-facing `editor` capability flag (resources without a profile but with a
 *  bespoke editor opt in via the handler's `capabilityOverrides.editor`). */
export function hasEditorProfile(key: string): boolean {
	return byKey.has(key);
}

/** The Handler key a profile is registered under, or `undefined` when the
 *  profile object was never registered here (an orphan). Consumed by
 *  `bindings.ts` to report which resources own a render binding. */
export function resourceKeyForProfile(profile: EditorProfile<any>): string | undefined {
	return entryByProfile.get(profile)?.handler.key;
}

/** Flat summary of one registered Handler — the kinds its profiles claim and
 *  the union of every kind those profiles can convert TO. */
export type RegisteredTypeSummary = {
	typeId: number;
	key: string;
	kinds: string[];
	conversionTargets: string[];
};

/** Enumerate the registry as data.
 *
 *  Exists so `src/lib/conversion/targets.ts` can be contract-tested against it:
 *  `exportPlan` skips any typeId a preset leaves unconstrained, so a type that
 *  HAS a registered migration but no preset entry exports unmigrated and
 *  silently — the failure mode is wrong bytes on disk, not an error. The test
 *  turns that into a build-time failure the moment a conversion is added. */
export function listRegisteredTypes(): RegisteredTypeSummary[] {
	return ENTRIES.map((entry) => {
		const conversionTargets = new Set<string>();
		for (const profile of entry.profiles) {
			for (const target of Object.keys(profile.conversions ?? {})) {
				conversionTargets.add(target);
			}
		}
		return {
			typeId: entry.handler.typeId,
			key: entry.handler.key,
			kinds: entry.profiles.map((p) => p.kind),
			conversionTargets: [...conversionTargets],
		};
	});
}

/** Convenience for the Workspace tree-row label: surfaces a
 *  `displayName` suffix when a typeId has more than one variant
 *  registered. Single-profile types return undefined so the tree
 *  doesn't render a useless `(default)` chip. */
export function profileSuffixFor(key: string, model: unknown): string | undefined {
	const entry = byKey.get(key);
	return entry ? suffixFromList(entry.profiles, model) : undefined;
}

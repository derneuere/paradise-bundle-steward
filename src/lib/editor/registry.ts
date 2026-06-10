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

import { aiSectionsV12Profile, aiSectionsV4Profile, aiSectionsV6Profile } from './profiles/aiSections';
import { challengeListProfile } from './profiles/challengeList';
import { environmentKeyframeProfile } from './profiles/environmentKeyframe';
import { environmentTimeLineProfile } from './profiles/environmentTimeLine';
import { guiPopupProfile } from './profiles/guiPopup';
import { hudMessageProfile } from './profiles/hudMessage';
import { hudMessageSequenceProfile } from './profiles/hudMessageSequence';
import { hudMessageSequenceDictionaryProfile } from './profiles/hudMessageSequenceDictionary';
import { iceTakeDictionaryProfile } from './profiles/iceTakeDictionary';
import { languageProfile } from './profiles/language';
import { playerCarColoursProfile } from './profiles/playerCarColours';
import { polygonSoupListProfile } from './profiles/polygonSoupList';
import { propInstanceDataProfile } from './profiles/propInstanceData';
import { propGraphicsListProfile } from './profiles/propGraphicsList';
import { propPhysicsProfile } from './profiles/propPhysics';
import { renderableProfile } from './profiles/renderable';
import { staticSoundMapProfile } from './profiles/staticSoundMap';
import { streetDataProfile } from './profiles/streetData';
import { textureProfile } from './profiles/texture';
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

/** Per-typeId profile sets. Each entry is { typeId, profiles } and the
 *  resolver picks the first profile whose `matches` returns true. List
 *  variant-specific profiles before any catch-all default for the same
 *  typeId. */
type RegistryEntry = {
	typeId: number;
	/** Stable handler key — e.g. 'aiSections'. Mirrors the core registry's
	 *  key so the workspace can look up a profile set by `resourceKey`. */
	key: string;
	profiles: EditorProfile<any>[];
};

const ENTRIES: RegistryEntry[] = [
	{
		typeId: 0x10001,
		key: 'aiSections',
		// Order matters: the FIRST profile is treated as the type's "primary"
		// variant by `profileSuffixFor` (V12 retail stays bare; V4 + V6
		// prototypes get `(v4 prototype)` / `(v6 prototype)` suffixes on the
		// tree row).
		profiles: [aiSectionsV12Profile, aiSectionsV4Profile, aiSectionsV6Profile],
	},
	{
		// 0x10002 — matches the core registry handler (`trafficDataHandler`).
		// The previous 0x10003 was a typo from the initial profile scaffold
		// that masked tree-row suffix lookups; resolved while wiring the
		// V22/V44/V45 split per issue #45.
		typeId: 0x10002,
		key: 'trafficData',
		// Order matters: the FIRST profile is treated as the type's "primary"
		// variant by `profileSuffixFor` (V45 retail stays bare; V44 gets the
		// `(v44 Paradise PS3 era)` suffix on the tree row, V22 gets the
		// `(v22 prototype)` suffix).
		profiles: [trafficDataV45Profile, trafficDataV44Profile, trafficDataV22Profile],
	},
	{
		typeId: 0x10006,
		key: 'streetData',
		profiles: [streetDataProfile],
	},
	{
		typeId: 0x10009,
		key: 'triggerData',
		profiles: [triggerDataProfile],
	},
	{
		typeId: 0x100E,
		key: 'zoneList',
		profiles: [zoneListProfile],
	},
	{
		typeId: 0x10F,
		key: 'polygonSoupList',
		profiles: [polygonSoupListProfile],
	},
	{
		typeId: 0x10011,
		key: 'propInstanceData',
		profiles: [propInstanceDataProfile],
	},
	{
		typeId: 0x10010,
		key: 'propGraphicsList',
		profiles: [propGraphicsListProfile],
	},
	{
		typeId: 0x10016,
		key: 'staticSoundMap',
		profiles: [staticSoundMapProfile],
	},
	{
		typeId: 0x1000f,
		key: 'propPhysics',
		profiles: [propPhysicsProfile],
	},
	{
		typeId: 0x27,
		key: 'language',
		profiles: [languageProfile],
	},
	{
		typeId: 0x2c,
		key: 'hudMessage',
		profiles: [hudMessageProfile],
	},
	{
		typeId: 0x2e,
		key: 'hudMessageSequence',
		profiles: [hudMessageSequenceProfile],
	},
	{
		typeId: 0x2f,
		key: 'hudMessageSequenceDictionary',
		profiles: [hudMessageSequenceDictionaryProfile],
	},
	{
		typeId: 0x1f,
		key: 'guiPopup',
		profiles: [guiPopupProfile],
	},
	{
		typeId: 0x30,
		key: 'worldPainter2D',
		profiles: [worldPainter2DProfile],
	},
	{
		typeId: 0x10012,
		key: 'environmentKeyframe',
		profiles: [environmentKeyframeProfile],
	},
	{
		typeId: 0x10013,
		key: 'environmentTimeLine',
		profiles: [environmentTimeLineProfile],
	},
	{
		typeId: 0x110,
		key: 'challengeList',
		profiles: [challengeListProfile],
	},
	{
		typeId: 0x111,
		key: 'vehicleList',
		profiles: [vehicleListProfile],
	},
	{
		typeId: 0x10005,
		key: 'playerCarColours',
		profiles: [playerCarColoursProfile],
	},
	{
		typeId: 0x10301,
		key: 'iceTakeDictionary',
		profiles: [iceTakeDictionaryProfile],
	},
	{
		typeId: 0x05,
		key: 'renderable',
		profiles: [renderableProfile],
	},
	{
		typeId: 0x06,
		key: 'texture',
		profiles: [textureProfile],
	},
];

const byTypeId = new Map<number, RegistryEntry>();
const byKey = new Map<string, RegistryEntry>();
for (const entry of ENTRIES) {
	if (byTypeId.has(entry.typeId)) {
		throw new Error(`Duplicate editor registry typeId 0x${entry.typeId.toString(16)}: ${entry.key}`);
	}
	if (byKey.has(entry.key)) {
		throw new Error(`Duplicate editor registry key: ${entry.key}`);
	}
	assertUniqueKinds(entry.key, entry.profiles);
	byTypeId.set(entry.typeId, entry);
	byKey.set(entry.key, entry);
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

/** Convenience for the Workspace tree-row label: surfaces a
 *  `displayName` suffix when a typeId has more than one variant
 *  registered. Single-profile types return undefined so the tree
 *  doesn't render a useless `(default)` chip. */
export function profileSuffixFor(key: string, model: unknown): string | undefined {
	const entry = byKey.get(key);
	return entry ? suffixFromList(entry.profiles, model) : undefined;
}

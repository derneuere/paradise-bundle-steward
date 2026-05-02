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

import { aiSectionsV12Profile } from './profiles/aiSections';
import { challengeListProfile } from './profiles/challengeList';
import { iceTakeDictionaryProfile } from './profiles/iceTakeDictionary';
import { playerCarColoursProfile } from './profiles/playerCarColours';
import { polygonSoupListProfile } from './profiles/polygonSoupList';
import { renderableProfile } from './profiles/renderable';
import { streetDataProfile } from './profiles/streetData';
import { textureProfile } from './profiles/texture';
import { trafficDataProfile } from './profiles/trafficData';
import { triggerDataProfile } from './profiles/triggerData';
import { vehicleListProfile } from './profiles/vehicleList';
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
		profiles: [aiSectionsV12Profile],
	},
	{
		typeId: 0x10003,
		key: 'trafficData',
		profiles: [trafficDataProfile],
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

/** Every profile registered for a given typeId, in the order they were
 *  declared (variant-specific first). Used by the conversion menu and
 *  any future "switch this resource to a different variant" UI. */
export function profilesFor(typeId: number): EditorProfile[] {
	return byTypeId.get(typeId)?.profiles ?? [];
}

/** Same, addressed by handler key. */
export function profilesForKey(key: string): EditorProfile[] {
	return byKey.get(key)?.profiles ?? [];
}

/** Convenience for the Workspace tree-row label: surfaces a
 *  `displayName` suffix when a typeId has more than one variant
 *  registered. Single-profile types return undefined so the tree
 *  doesn't render a useless `(default)` chip. */
export function profileSuffixFor(key: string, model: unknown): string | undefined {
	const entry = byKey.get(key);
	return entry ? suffixFromList(entry.profiles, model) : undefined;
}

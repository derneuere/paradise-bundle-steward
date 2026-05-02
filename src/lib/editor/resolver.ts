// Pure profile-resolution rules used by the editor registry.
//
// Split out from `registry.ts` so unit tests can exercise the rules with
// hand-built profile arrays — `registry.ts` itself eagerly imports overlays
// and extension components, which drag in three.js / leaflet / react and
// don't load in vitest's node environment.
//
// The registry does nothing more than: hold a static list of
// (typeId, key, profiles[]), then delegate every lookup to these helpers.

import type { EditorProfile } from './types';

/** Pick the first profile whose `matches` returns true for the given model.
 *  Profiles without a `matches` predicate are treated as "always match"
 *  catch-alls — list them after any variant-specific profiles.
 *
 *  Special case: `model == null` resolves to the lone profile when there is
 *  exactly one (typeId has no variant ambiguity to resolve), otherwise to
 *  `undefined` since we can't pick without inspecting the model. */
export function pickProfileFromList(
	profiles: EditorProfile<unknown>[],
	model: unknown,
): EditorProfile<unknown> | undefined {
	if (profiles.length === 0) return undefined;
	if (model == null) {
		return profiles.length === 1 ? profiles[0] : undefined;
	}
	for (const profile of profiles) {
		if (!profile.matches || profile.matches(model)) return profile;
	}
	return undefined;
}

/** Display-suffix helper used by tree row labels. Returns the picked
 *  profile's `displayName` only when the picked profile is *not* the
 *  first one in the list. The first profile is treated as the type's
 *  "primary" / canonical variant — single-profile types and the canonical
 *  variant of multi-profile types stay bare in the tree (no useless
 *  `(v12 retail)` chip on the AI Sections row). Non-primary variants
 *  (V4 / V6 prototype, future TrafficData v22, etc.) get the suffix
 *  because the user does need the disambiguation. */
export function suffixFromList(
	profiles: EditorProfile<unknown>[],
	model: unknown,
): string | undefined {
	if (profiles.length < 2) return undefined;
	const picked = pickProfileFromList(profiles, model);
	if (!picked || picked === profiles[0]) return undefined;
	return picked.displayName;
}

/** Throws if two profiles in `profiles` claim the same `kind`. Called
 *  during registry construction so misconfigured registries fail at
 *  module-load time, not when a user clicks a tree row. */
export function assertUniqueKinds(
	key: string,
	profiles: EditorProfile<unknown>[],
): void {
	const seen = new Set<string>();
	for (const profile of profiles) {
		if (seen.has(profile.kind)) {
			throw new Error(
				`Duplicate EditorProfile.kind '${profile.kind}' on ${key}; ` +
				`each profile must have a unique kind within its typeId.`,
			);
		}
		seen.add(profile.kind);
	}
}

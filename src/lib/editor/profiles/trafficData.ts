// TrafficData editor profiles — metadata for each on-disk layout variant.
// React-laden bindings (overlay, extensions) live in `../bindings.ts` and
// are looked up by `(resourceKey, profileKind)` at render time.
//
// V45 retail (Paradise PC, current): full editor surface (schema + extensions
// + 3D overlay, in-place edits via the binding).
// V44 retail (Paradise PS3 era): same field shape, same schema, same
// extensions and overlay — just a different `kind` discriminator so the
// tree row labels itself "Traffic Data (v44 Paradise PS3 era)".
// V22 prototype (Burnout 5 dev build, 2006-11 X360): read-only inspector.
// The schema is frozen via `freezeSchema()` so every field renders read-only
// and lists can't be added to / removed from. No 3D overlay yet (no
// fixture has hull internals decoded). Editability lives in schema metadata
// per the project pet peeve in CLAUDE.md — there's no parallel "editable"
// flag at the profile / handler / page layer.

import { defineProfile } from '../types';
import type {
	ParsedTrafficDataV45,
	ParsedTrafficDataV44,
	ParsedTrafficDataV22,
	ParsedTrafficData,
} from '@/lib/core/trafficData';
import { trafficDataResourceSchema } from '@/lib/schema/resources/trafficData';
import { trafficDataV22ResourceSchema } from '@/lib/schema/resources/trafficDataV22';
import { freezeSchema } from '@/lib/schema/freeze';

export const trafficDataV45Profile = defineProfile<ParsedTrafficDataV45>({
	kind: 'v45',
	displayName: 'v45 retail',
	schema: trafficDataResourceSchema,
	matches: (model) => (model as ParsedTrafficData).kind === 'v45',
});

export const trafficDataV44Profile = defineProfile<ParsedTrafficDataV44>({
	kind: 'v44',
	displayName: 'v44 Paradise PS3 era',
	// V44 and V45 share the same parsed-model shape; the only on-disk
	// difference is `JunctionLogicBox.miBikeStartDataIndex` presence (handled
	// by the writer's version dispatch) and `muNumCoronas` storage width
	// (handled in the parser). The schema describes the model fields, not
	// their storage, so it's safe to reuse the retail schema verbatim.
	schema: trafficDataResourceSchema,
	matches: (model) => (model as ParsedTrafficData).kind === 'v44',
});

export const trafficDataV22Profile = defineProfile<ParsedTrafficDataV22>({
	kind: 'v22',
	displayName: 'v22 prototype',
	// `freezeSchema()` walks every record + flips readOnly:true on every
	// field and addable/removable:false on every list. The inspector renders
	// the v22 tree as read-only without a parallel `editable` cap flag at the
	// profile layer (per ADR-0008's pet-peeve rule: editability is schema
	// metadata, not a separate axis).
	schema: freezeSchema(trafficDataV22ResourceSchema),
	matches: (model) => (model as ParsedTrafficData).kind === 'v22',
	// No conversions yet — V22 → V45 migration is filed as a follow-up
	// (HITL: hull internals + tail regions need the same triangulation pass
	// as the AI Sections V4 → V12 lossy mappings).
});

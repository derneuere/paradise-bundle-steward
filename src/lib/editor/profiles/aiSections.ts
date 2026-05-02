// AISections editor profiles — metadata for each on-disk layout variant.
// React-laden bindings (overlay, extensions) live in `../bindings.ts` and
// are looked up by `(resourceKey, profileKind)` at render time. This file
// stays React-free so non-rendering callers (tree-label suffix, inspector
// schema lookup) don't drag the overlay's three.js imports.
//
// V12 retail: full editor surface (schema + extensions + 3D overlay,
// in-place edits via the binding).
// V4 prototype: read-only inspector — the schema is frozen via
// `freezeSchema()` so every field renders as read-only and lists can't
// be added to / removed from. No 3D overlay yet (next slice). The
// 2,442-section example/older builds/AI.dat fixture exercises this path.
// V6 prototype: parses + round-trips via the core registry but has no
// editor profile yet (no fixture for it; synthetic test coverage only).

import { defineProfile } from '../types';
import type {
	ParsedAISectionsV12,
	ParsedAISectionsV4,
	ParsedAISections,
} from '@/lib/core/aiSections';
import { aiSectionsV12ResourceSchema } from '@/lib/schema/resources/aiSections/v12';
import { aiSectionsV4ResourceSchema } from '@/lib/schema/resources/aiSections/v4';
import { freezeSchema } from '@/lib/schema/freeze';

export const aiSectionsV12Profile = defineProfile<ParsedAISectionsV12>({
	kind: 'v12',
	displayName: 'v12 retail',
	schema: aiSectionsV12ResourceSchema,
	matches: (model) => (model as ParsedAISections).kind === 'v12',
});

export const aiSectionsV4Profile = defineProfile<ParsedAISectionsV4>({
	kind: 'v4',
	displayName: 'v4 prototype',
	// `freezeSchema()` walks every record + flips readOnly:true on every
	// field and addable/removable:false on every list. That makes the
	// inspector render the whole V4 tree as read-only without a parallel
	// `editable` cap flag at the profile layer (per ADR-0008's pet-peeve
	// rule: editability is schema metadata, not a separate axis).
	schema: freezeSchema(aiSectionsV4ResourceSchema),
	matches: (model) => (model as ParsedAISections).kind === 'v4',
});

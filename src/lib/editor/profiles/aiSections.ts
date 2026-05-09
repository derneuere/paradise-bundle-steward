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
// V6 prototype: parses + round-trips via the core registry (the
// 3,900-section example/older builds/AI v6.DAT fixture from the
// 2007-02-22 X360 build pins this end-to-end). No editor profile yet —
// the V6 schema/overlay slice will mirror V4's read-only treatment.

import { defineProfile } from '../types';
import type {
	ParsedAISectionsV12,
	ParsedAISectionsV4,
	ParsedAISectionsV6,
	ParsedAISections,
} from '@/lib/core/aiSections';
import { aiSectionsV12ResourceSchema } from '@/lib/schema/resources/aiSections/v12';
import { aiSectionsV4ResourceSchema } from '@/lib/schema/resources/aiSections/v4';
import { aiSectionsV6ResourceSchema } from '@/lib/schema/resources/aiSections/v6';
import { freezeSchema } from '@/lib/schema/freeze';
import { migrateV4toV12 } from '@/lib/conversion/migrations/aiSectionsV4toV12';

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
	conversions: {
		// Reachable via `pickProfile(0x10001, v4Model).conversions.v12.migrate`.
		// The export-dialog UI that surfaces this is the next slice (#37);
		// for now the entry point is wired so the function is callable from
		// the CLI / tests / programmatic flows.
		v12: {
			label: 'Convert to v12 (Paradise PC Retail)',
			migrate: migrateV4toV12,
		},
	},
});

export const aiSectionsV6Profile = defineProfile<ParsedAISectionsV6>({
	kind: 'v6',
	displayName: 'v6 prototype',
	// Same freeze treatment as V4 — the V6 prototype data is read-only in the
	// inspector for now (no migration / edit-op coverage yet). The 3D overlay
	// binding (`AISectionsLegacyOverlay`) already accepts the V4 | V6 union,
	// so registering this profile lights up the same viewport rendering V4
	// gets, plus the schema inspector with the V6-specific spanIndex/district
	// fields surfaced.
	schema: freezeSchema(aiSectionsV6ResourceSchema),
	matches: (model) => (model as ParsedAISections).kind === 'v6',
});

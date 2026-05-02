// AISections retail (v12) editor profile.
//
// Burnout 5 prototype V4/V6 layouts parse and round-trip via the core
// registry but have no editor surface yet — the next slice adds a
// frozen V4/V6 schema (via `freezeSchema`) and a separate profile
// alongside this one.

import { defineProfile } from '../types';
import type { ParsedAISectionsV12, ParsedAISections } from '@/lib/core/aiSections';
import { aiSectionsResourceSchema } from '@/lib/schema/resources/aiSections';
import { aiSectionsExtensions } from '@/components/schema-editor/extensions/aiSectionsExtensions';
import { AISectionsOverlay } from '@/components/schema-editor/viewports/AISectionsOverlay';

export const aiSectionsV12Profile = defineProfile<ParsedAISectionsV12>({
	kind: 'v12',
	displayName: 'v12 retail',
	schema: aiSectionsResourceSchema,
	overlay: AISectionsOverlay,
	extensions: aiSectionsExtensions,
	matches: (model) => (model as ParsedAISections).kind === 'v12',
});

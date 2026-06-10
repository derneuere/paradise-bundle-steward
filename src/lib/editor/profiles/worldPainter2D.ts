// One profile covers BOTH retail WorldPainter2D variants (Districts and
// Ambiences): the containers are byte-identical, and EditorProfile.matches
// only sees the parsed model — the debug name, the sole discriminator, never
// reaches it. Variant-specific reading lives in worldPainter2DCellLabel
// (schema layer), keyed by worldPainter2DVariantFromName(debugName).

import { defineProfile } from '../types';
import type { ParsedWorldPainter2D } from '@/lib/core/worldPainter2D';
import { worldPainter2DResourceSchema } from '@/lib/schema/resources/worldPainter2D';

export const worldPainter2DProfile = defineProfile<ParsedWorldPainter2D>({
	kind: 'default',
	displayName: 'World Painter 2D',
	schema: worldPainter2DResourceSchema,
});

import { defineProfile } from '../types';
import type { ParsedWorldPainter2D } from '@/lib/core/worldPainter2D';
import { worldPainter2DResourceSchema } from '@/lib/schema/resources/worldPainter2D';

export const worldPainter2DProfile = defineProfile<ParsedWorldPainter2D>({
	kind: 'default',
	displayName: 'World Painter 2D',
	schema: worldPainter2DResourceSchema,
});

import { defineProfile } from '../types';
import type { ParsedColourCube } from '@/lib/core/colourCube';
import { colourCubeResourceSchema } from '@/lib/schema/resources/colourCube';

export const colourCubeProfile = defineProfile<ParsedColourCube>({
	kind: 'default',
	displayName: 'Colour Cube',
	schema: colourCubeResourceSchema,
});

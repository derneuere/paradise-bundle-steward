import { defineProfile } from '../types';
import { playerCarColoursResourceSchema } from '@/lib/schema/resources/playerCarColours';

export const playerCarColoursProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'PlayerCarColours',
	schema: playerCarColoursResourceSchema,
});

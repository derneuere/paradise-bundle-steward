import { defineProfile } from '../types';
import type { ParsedStreetData } from '@/lib/core/streetData';
import { streetDataResourceSchema } from '@/lib/schema/resources/streetData';

export const streetDataProfile = defineProfile<ParsedStreetData>({
	kind: 'default',
	displayName: 'StreetData',
	schema: streetDataResourceSchema,
});

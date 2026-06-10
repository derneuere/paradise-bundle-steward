import { defineProfile } from '../types';
import type { ParsedGenericRwacWaveContent } from '@/lib/core/genericRwacWaveContent';
import { genericRwacWaveContentResourceSchema } from '@/lib/schema/resources/genericRwacWaveContent';

export const genericRwacWaveContentProfile = defineProfile<ParsedGenericRwacWaveContent>({
	kind: 'default',
	displayName: 'Generic RWAC Wave Content',
	schema: genericRwacWaveContentResourceSchema,
});

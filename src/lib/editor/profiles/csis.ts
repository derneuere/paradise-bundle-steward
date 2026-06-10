import { defineProfile } from '../types';
import type { ParsedCsis } from '@/lib/core/csis';
import { csisResourceSchema } from '@/lib/schema/resources/csis';

export const csisProfile = defineProfile<ParsedCsis>({
	kind: 'default',
	displayName: 'CSIS',
	schema: csisResourceSchema,
});

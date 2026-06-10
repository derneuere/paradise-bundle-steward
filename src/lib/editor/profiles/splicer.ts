import { defineProfile } from '../types';
import type { ParsedSplicer } from '@/lib/core/splicer';
import { splicerResourceSchema } from '@/lib/schema/resources/splicer';

export const splicerProfile = defineProfile<ParsedSplicer>({
	kind: 'default',
	displayName: 'Splicer',
	schema: splicerResourceSchema,
});

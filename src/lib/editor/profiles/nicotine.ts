import { defineProfile } from '../types';
import type { ParsedNicotine } from '@/lib/core/nicotine';
import { nicotineResourceSchema } from '@/lib/schema/resources/nicotine';

export const nicotineProfile = defineProfile<ParsedNicotine>({
	kind: 'default',
	displayName: 'Nicotine Map',
	schema: nicotineResourceSchema,
});

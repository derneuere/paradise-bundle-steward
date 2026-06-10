import { defineProfile } from '../types';
import type { ParsedEnvironmentDictionary } from '@/lib/core/environmentDictionary';
import { environmentDictionaryResourceSchema } from '@/lib/schema/resources/environmentDictionary';

export const environmentDictionaryProfile = defineProfile<ParsedEnvironmentDictionary>({
	kind: 'default',
	displayName: 'Environment Dictionary',
	schema: environmentDictionaryResourceSchema,
});

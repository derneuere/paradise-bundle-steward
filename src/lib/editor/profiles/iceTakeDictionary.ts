import { defineProfile } from '../types';
import { iceTakeDictionaryResourceSchema } from '@/lib/schema/resources/iceTakeDictionary';

export const iceTakeDictionaryProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'IceTakeDictionary',
	schema: iceTakeDictionaryResourceSchema,
});

import { defineProfile } from '../types';
import type { ParsedLanguage } from '@/lib/core/language';
import { languageResourceSchema } from '@/lib/schema/resources/language';

export const languageProfile = defineProfile<ParsedLanguage>({
	kind: 'default',
	displayName: 'Language',
	schema: languageResourceSchema,
});

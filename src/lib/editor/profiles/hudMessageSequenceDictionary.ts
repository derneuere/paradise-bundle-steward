import { defineProfile } from '../types';
import type { ParsedHudMessageSequenceDictionary } from '@/lib/core/hudMessageSequences';
import { hudMessageSequenceDictionaryResourceSchema } from '@/lib/schema/resources/hudMessageSequenceDictionary';

export const hudMessageSequenceDictionaryProfile = defineProfile<ParsedHudMessageSequenceDictionary>({
	kind: 'default',
	displayName: 'HUD Message Sequence Dictionary',
	schema: hudMessageSequenceDictionaryResourceSchema,
});

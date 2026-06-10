import { defineProfile } from '../types';
import type { ParsedHudMessageSequence } from '@/lib/core/hudMessageSequences';
import { hudMessageSequenceResourceSchema } from '@/lib/schema/resources/hudMessageSequence';

export const hudMessageSequenceProfile = defineProfile<ParsedHudMessageSequence>({
	kind: 'default',
	displayName: 'HUD Message Sequence',
	schema: hudMessageSequenceResourceSchema,
});

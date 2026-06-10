import { defineProfile } from '../types';
import type { ParsedHudMessage } from '@/lib/core/hudMessage';
import { hudMessageResourceSchema } from '@/lib/schema/resources/hudMessage';

export const hudMessageProfile = defineProfile<ParsedHudMessage>({
	kind: 'default',
	displayName: 'HUD Message',
	schema: hudMessageResourceSchema,
});

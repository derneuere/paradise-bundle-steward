import { defineProfile } from '../types';
import type { ParsedFont } from '@/lib/core/font';
import { fontResourceSchema } from '@/lib/schema/resources/font';

export const fontProfile = defineProfile<ParsedFont>({
	kind: 'default',
	displayName: 'Font',
	schema: fontResourceSchema,
});

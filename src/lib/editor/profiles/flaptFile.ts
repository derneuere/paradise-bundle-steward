import { defineProfile } from '../types';
import type { ParsedFlaptFile } from '@/lib/core/flaptFile';
import { flaptFileResourceSchema } from '@/lib/schema/resources/flaptFile';

export const flaptFileProfile = defineProfile<ParsedFlaptFile>({
	kind: 'default',
	displayName: 'Flapt File',
	schema: flaptFileResourceSchema,
});

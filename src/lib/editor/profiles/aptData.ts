import { defineProfile } from '../types';
import type { ParsedAptData } from '@/lib/core/aptData';
import { aptDataResourceSchema } from '@/lib/schema/resources/aptData';

export const aptDataProfile = defineProfile<ParsedAptData>({
	kind: 'default',
	displayName: 'Apt Data',
	schema: aptDataResourceSchema,
});

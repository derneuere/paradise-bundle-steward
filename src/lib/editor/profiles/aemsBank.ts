import { defineProfile } from '../types';
import type { ParsedAemsBank } from '@/lib/core/aemsBank';
import { aemsBankResourceSchema } from '@/lib/schema/resources/aemsBank';

export const aemsBankProfile = defineProfile<ParsedAemsBank>({
	kind: 'default',
	displayName: 'AEMS Bank',
	schema: aemsBankResourceSchema,
});

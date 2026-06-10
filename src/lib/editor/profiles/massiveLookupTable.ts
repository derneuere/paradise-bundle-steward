import { defineProfile } from '../types';
import type { ParsedMassiveLookupTable } from '@/lib/core/massiveLookupTable';
import { massiveLookupTableResourceSchema } from '@/lib/schema/resources/massiveLookupTable';

export const massiveLookupTableProfile = defineProfile<ParsedMassiveLookupTable>({
	kind: 'default',
	displayName: 'Massive Lookup Table',
	schema: massiveLookupTableResourceSchema,
});

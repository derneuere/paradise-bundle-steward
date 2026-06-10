import { defineProfile } from '../types';
import type { ParsedIdList } from '@/lib/core/idList';
import { idListResourceSchema } from '@/lib/schema/resources/idList';

export const idListProfile = defineProfile<ParsedIdList>({
	kind: 'default',
	displayName: 'ID List',
	schema: idListResourceSchema,
});

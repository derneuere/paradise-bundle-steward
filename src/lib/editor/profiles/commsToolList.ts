import { defineProfile } from '../types';
import type { ParsedCommsToolList } from '@/lib/core/commsToolList';
import { commsToolListResourceSchema } from '@/lib/schema/resources/commsToolList';

export const commsToolListProfile = defineProfile<ParsedCommsToolList>({
	kind: 'default',
	displayName: 'Comms Tool List',
	schema: commsToolListResourceSchema,
});

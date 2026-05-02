import { defineProfile } from '../types';
import type { ParsedZoneList } from '@/lib/core/zoneList';
import { zoneListResourceSchema } from '@/lib/schema/resources/zoneList';

export const zoneListProfile = defineProfile<ParsedZoneList>({
	kind: 'default',
	displayName: 'ZoneList',
	schema: zoneListResourceSchema,
});

import { defineProfile } from '../types';
import type { ParsedZoneList } from '@/lib/core/zoneList';
import { zoneListResourceSchema } from '@/lib/schema/resources/zoneList';
import { ZoneListOverlay } from '@/components/schema-editor/viewports/ZoneListOverlay';

export const zoneListProfile = defineProfile<ParsedZoneList>({
	kind: 'default',
	displayName: 'ZoneList',
	schema: zoneListResourceSchema,
	overlay: ZoneListOverlay,
	// No extension components — ZoneList renders entirely from schema.
});

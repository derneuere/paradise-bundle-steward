import { defineProfile } from '../types';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import { triggerDataResourceSchema } from '@/lib/schema/resources/triggerData';

export const triggerDataProfile = defineProfile<ParsedTriggerData>({
	kind: 'default',
	displayName: 'TriggerData',
	schema: triggerDataResourceSchema,
});

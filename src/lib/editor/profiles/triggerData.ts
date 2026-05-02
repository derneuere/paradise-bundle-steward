import { defineProfile } from '../types';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import { triggerDataResourceSchema } from '@/lib/schema/resources/triggerData';
import { triggerDataExtensions } from '@/components/schema-editor/extensions/triggerDataExtensions';
import { TriggerDataOverlay } from '@/components/schema-editor/viewports/TriggerDataOverlay';

export const triggerDataProfile = defineProfile<ParsedTriggerData>({
	kind: 'default',
	displayName: 'TriggerData',
	schema: triggerDataResourceSchema,
	overlay: TriggerDataOverlay,
	extensions: triggerDataExtensions,
});

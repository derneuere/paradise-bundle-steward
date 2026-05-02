import { defineProfile } from '../types';
import type { ParsedTrafficData } from '@/lib/core/trafficData';
import { trafficDataResourceSchema } from '@/lib/schema/resources/trafficData';
import { trafficDataExtensions } from '@/components/schema-editor/extensions/trafficDataExtensions';
import { TrafficDataOverlay } from '@/components/schema-editor/viewports/TrafficDataOverlay';

export const trafficDataProfile = defineProfile<ParsedTrafficData>({
	kind: 'default',
	displayName: 'TrafficData',
	schema: trafficDataResourceSchema,
	overlay: TrafficDataOverlay,
	extensions: trafficDataExtensions,
});

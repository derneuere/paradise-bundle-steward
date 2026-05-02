import { defineProfile } from '../types';
import type { ParsedTrafficData } from '@/lib/core/trafficData';
import { trafficDataResourceSchema } from '@/lib/schema/resources/trafficData';

export const trafficDataProfile = defineProfile<ParsedTrafficData>({
	kind: 'default',
	displayName: 'TrafficData',
	schema: trafficDataResourceSchema,
});

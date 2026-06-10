import { defineProfile } from '../types';
import type { ParsedEnvironmentTimeLine } from '@/lib/core/environmentSettings';
import { environmentTimeLineResourceSchema } from '@/lib/schema/resources/environmentTimeLine';

export const environmentTimeLineProfile = defineProfile<ParsedEnvironmentTimeLine>({
	kind: 'default',
	displayName: 'Environment Timeline',
	schema: environmentTimeLineResourceSchema,
});

import { defineProfile } from '../types';
import type { ParsedEnvironmentKeyframe } from '@/lib/core/environmentSettings';
import { environmentKeyframeResourceSchema } from '@/lib/schema/resources/environmentKeyframe';

export const environmentKeyframeProfile = defineProfile<ParsedEnvironmentKeyframe>({
	kind: 'default',
	displayName: 'Environment Keyframe',
	schema: environmentKeyframeResourceSchema,
});

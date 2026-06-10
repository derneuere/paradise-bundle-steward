import { defineProfile } from '../types';
import type { ParsedRegistry } from '@/lib/core/soundRegistry';
import { registryResourceSchema } from '@/lib/schema/resources/registry';

export const registryProfile = defineProfile<ParsedRegistry>({
	kind: 'default',
	displayName: 'Registry',
	schema: registryResourceSchema,
});

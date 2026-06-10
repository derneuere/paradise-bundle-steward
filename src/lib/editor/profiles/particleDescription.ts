import { defineProfile } from '../types';
import type { ParsedParticleDescription } from '@/lib/core/particleDescription';
import { particleDescriptionResourceSchema } from '@/lib/schema/resources/particleDescription';

export const particleDescriptionProfile = defineProfile<ParsedParticleDescription>({
	kind: 'default',
	displayName: 'Particle Description',
	schema: particleDescriptionResourceSchema,
});

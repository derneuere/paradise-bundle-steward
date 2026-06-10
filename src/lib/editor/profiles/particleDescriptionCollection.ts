import { defineProfile } from '../types';
import type { ParsedParticleDescriptionCollection } from '@/lib/core/particleDescriptionCollection';
import { particleDescriptionCollectionResourceSchema } from '@/lib/schema/resources/particleDescriptionCollection';

export const particleDescriptionCollectionProfile = defineProfile<ParsedParticleDescriptionCollection>({
	kind: 'default',
	displayName: 'Particle Description Collection',
	schema: particleDescriptionCollectionResourceSchema,
});

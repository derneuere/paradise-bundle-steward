import { defineProfile } from '../types';
import type { ParsedStaticSoundMap } from '@/lib/core/staticSoundMap';
import { staticSoundMapResourceSchema } from '@/lib/schema/resources/staticSoundMap';

export const staticSoundMapProfile = defineProfile<ParsedStaticSoundMap>({
	kind: 'default',
	displayName: 'Static Sound Map',
	schema: staticSoundMapResourceSchema,
});

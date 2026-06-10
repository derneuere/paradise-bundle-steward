import { defineProfile } from '../types';
import type { ParsedTextureNameMap } from '@/lib/core/textureNameMap';
import { textureNameMapResourceSchema } from '@/lib/schema/resources/textureNameMap';

export const textureNameMapProfile = defineProfile<ParsedTextureNameMap>({
	kind: 'default',
	displayName: 'Texture Name Map',
	schema: textureNameMapResourceSchema,
});

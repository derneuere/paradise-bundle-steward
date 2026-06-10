import { defineProfile } from '../types';
import type { ParsedVFXMeshCollection } from '@/lib/core/vfxMeshCollection';
import { vfxMeshCollectionResourceSchema } from '@/lib/schema/resources/vfxMeshCollection';

export const vfxMeshCollectionProfile = defineProfile<ParsedVFXMeshCollection>({
	kind: 'default',
	displayName: 'VFX Mesh Collection',
	schema: vfxMeshCollectionResourceSchema,
});

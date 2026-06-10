import { defineProfile } from '../types';
import type { ParsedVFXPropCollection } from '@/lib/core/vfxPropCollection';
import { vfxPropCollectionResourceSchema } from '@/lib/schema/resources/vfxPropCollection';

export const vfxPropCollectionProfile = defineProfile<ParsedVFXPropCollection>({
	kind: 'default',
	displayName: 'VFX Prop Collection',
	schema: vfxPropCollectionResourceSchema,
});

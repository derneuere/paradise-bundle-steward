import { defineProfile } from '../types';
import type { ParsedPropInstanceData } from '@/lib/core/propInstanceData';
import { propInstanceDataResourceSchema } from '@/lib/schema/resources/propInstanceData';

export const propInstanceDataProfile = defineProfile<ParsedPropInstanceData>({
	kind: 'default',
	displayName: 'Prop Instance Data',
	schema: propInstanceDataResourceSchema,
});

import { defineProfile } from '../types';
import { iceDataResourceSchema } from '@/lib/schema/resources/iceData';

export const iceDataProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'ICE Data',
	schema: iceDataResourceSchema,
});

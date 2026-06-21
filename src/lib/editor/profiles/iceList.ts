import { defineProfile } from '../types';
import { iceListResourceSchema } from '@/lib/schema/resources/iceList';

export const iceListProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'ICE List',
	schema: iceListResourceSchema,
});

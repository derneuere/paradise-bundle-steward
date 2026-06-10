import { defineProfile } from '../types';
import type { ParsedWheelList } from '@/lib/core/wheelList';
import { wheelListResourceSchema } from '@/lib/schema/resources/wheelList';

export const wheelListProfile = defineProfile<ParsedWheelList>({
	kind: 'default',
	displayName: 'Wheel List',
	schema: wheelListResourceSchema,
});

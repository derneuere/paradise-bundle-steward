import { defineProfile } from '../types';
import type { ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';
import { polygonSoupListResourceSchema } from '@/lib/schema/resources/polygonSoupList';

export const polygonSoupListProfile = defineProfile<ParsedPolygonSoupList>({
	kind: 'default',
	displayName: 'PolygonSoupList',
	schema: polygonSoupListResourceSchema,
});

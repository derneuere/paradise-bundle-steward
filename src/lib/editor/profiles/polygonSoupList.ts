import { defineProfile } from '../types';
import type { ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';
import { polygonSoupListResourceSchema } from '@/lib/schema/resources/polygonSoupList';
import { polygonSoupListExtensions } from '@/components/schema-editor/extensions/collisionTagExtension';
import { PolygonSoupListOverlay } from '@/components/schema-editor/viewports/PolygonSoupListOverlay';

export const polygonSoupListProfile = defineProfile<ParsedPolygonSoupList>({
	kind: 'default',
	displayName: 'PolygonSoupList',
	schema: polygonSoupListResourceSchema,
	overlay: PolygonSoupListOverlay,
	extensions: polygonSoupListExtensions,
});

import { defineProfile } from '../types';
import type { ParsedStreetData } from '@/lib/core/streetData';
import { streetDataResourceSchema } from '@/lib/schema/resources/streetData';
import { streetDataExtensions } from '@/components/schema-editor/extensions/streetDataExtensions';
import { StreetDataOverlay } from '@/components/schema-editor/viewports/StreetDataOverlay';

export const streetDataProfile = defineProfile<ParsedStreetData>({
	kind: 'default',
	displayName: 'StreetData',
	schema: streetDataResourceSchema,
	overlay: StreetDataOverlay,
	extensions: streetDataExtensions,
});

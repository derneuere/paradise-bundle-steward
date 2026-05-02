import { defineProfile } from '../types';
import { vehicleListResourceSchema } from '@/lib/schema/resources/vehicleList';
import { vehicleListExtensions } from '@/components/schema-editor/extensions/vehicleListExtensions';

export const vehicleListProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'VehicleList',
	schema: vehicleListResourceSchema,
	extensions: vehicleListExtensions,
});

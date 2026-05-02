import { defineProfile } from '../types';
import { vehicleListResourceSchema } from '@/lib/schema/resources/vehicleList';

export const vehicleListProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'VehicleList',
	schema: vehicleListResourceSchema,
});

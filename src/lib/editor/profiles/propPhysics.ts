import { defineProfile } from '../types';
import type { ParsedPropPhysics } from '@/lib/core/propPhysics';
import { propPhysicsResourceSchema } from '@/lib/schema/resources/propPhysics';

export const propPhysicsProfile = defineProfile<ParsedPropPhysics>({
	kind: 'default',
	displayName: 'Prop Physics',
	schema: propPhysicsResourceSchema,
});

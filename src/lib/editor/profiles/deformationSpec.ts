// DeformationSpec profile. Schema-driven inspector; no 3D overlay (the
// resource isn't world-space geometry), so the centre pane shows the empty
// "no viewport" state and editing happens entirely in the inspector form.

import { defineProfile } from '../types';
import { deformationSpecResourceSchema } from '@/lib/schema/resources/deformationSpec';

export const deformationSpecProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'Deformation Spec',
	schema: deformationSpecResourceSchema,
});

// DeformationSpec profile. Schema-driven inspector; no WorldViewport overlay
// (the resource isn't world-space geometry). The centre pane instead mounts
// the crash preview (ViewportPane special-cases this key).

import { defineProfile } from '../types';
import { deformationSpecResourceSchema } from '@/lib/schema/resources/deformationSpec';

export const deformationSpecProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'Deformation Spec',
	schema: deformationSpecResourceSchema,
});

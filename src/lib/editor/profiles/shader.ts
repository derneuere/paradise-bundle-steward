// Shader profile.
//
// Shader's 3D preview translates its DXBC programs to GLSL and renders them on
// a test mesh, so its viewport surface is `ShaderViewport` (mounted directly by
// ViewportPane's shader special-case) rather than a WorldViewport overlay — the
// same pattern as Renderable. The schema editor's inspector shows the decoded
// name / techniques / constants alongside it.

import { defineProfile } from '../types';
import { shaderResourceSchema } from '@/lib/schema/resources/shader';

export const shaderProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'Shader',
	schema: shaderResourceSchema,
});

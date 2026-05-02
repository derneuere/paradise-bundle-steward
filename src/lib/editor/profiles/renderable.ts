// Renderable profile.
//
// Renderable's 3D preview is a full three.js scene that decodes every 0xC
// record in the bundle, so its viewport surface is `RenderableViewport`
// instead of a WorldViewport overlay. The schema editor's ViewportPane
// special-cases the renderable key to mount that viewport directly — see
// the migration in WorkspacePage / ViewportPane.

import { defineProfile } from '../types';
import { renderableResourceSchema } from '@/lib/schema/resources/renderable';

export const renderableProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'Renderable',
	schema: renderableResourceSchema,
});

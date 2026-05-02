// Texture profile.
//
// Texture's 2D preview pulls decoded RGBA pixels from `TextureContext`, so
// the editor's ViewportPane mounts `TextureViewport` directly when this
// profile is picked. The schema describes the ParsedTextureHeader for
// inspector use — pixel data isn't part of it.

import { defineProfile } from '../types';
import { textureResourceSchema } from '@/lib/schema/resources/texture';

export const textureProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'Texture',
	schema: textureResourceSchema,
});

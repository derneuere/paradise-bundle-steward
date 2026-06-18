import { describe, it, expect } from 'vitest';
import { textureResourcesOf } from '../TextureDecodedProvider';
import { TEXTURE_TYPE_ID } from '@/lib/core/texture';
import type { ParsedBundle } from '@/lib/core/types';

// The Workspace addresses a texture instance by its index into the parsed
// `texture` list, which the parser fills by walking `bundle.resources` in
// order. The decode provider must map that same index back onto the texture
// ResourceEntry — `textureResourcesOf` is that correlation, so this pins it.
describe('textureResourcesOf', () => {
	const mk = (typeId: number) => ({ resourceTypeId: typeId }) as unknown;

	it('keeps texture-typed resources in bundle order', () => {
		const resources = [mk(TEXTURE_TYPE_ID), mk(0x5), mk(TEXTURE_TYPE_ID)];
		const bundle = { resources } as unknown as ParsedBundle;
		const out = textureResourcesOf(bundle);
		expect(out).toEqual([resources[0], resources[2]]);
	});

	it('returns empty when the bundle has no textures', () => {
		const bundle = { resources: [mk(0x43), mk(0xc)] } as unknown as ParsedBundle;
		expect(textureResourcesOf(bundle)).toEqual([]);
	});
});

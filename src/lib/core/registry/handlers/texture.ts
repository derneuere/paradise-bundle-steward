// Texture registry handler (type 0x0).
//
// Wraps src/lib/core/texture.ts. Read-only.
//
// Like the Renderable handler, parseRaw only sees block 0 (the header).
// Full pixel decoding requires both blocks and happens in the viewer via
// decodeTexture() directly.

import {
	parseTextureHeader,
	TEXTURE_TYPE_ID,
	type ParsedTextureHeader,
} from '../../texture';
import type { ResourceHandler } from '../handler';

export const textureHandler: ResourceHandler<ParsedTextureHeader> = {
	typeId: TEXTURE_TYPE_ID,
	key: 'texture',
	name: 'Texture',
	description: 'Image data: DXT1/DXT5/A8R8G8B8 pixel sheets',
	category: 'Graphics',
	caps: { read: true, write: false },

	parseRaw(raw, _ctx) {
		return parseTextureHeader(raw);
	},

	describe(model) {
		return `${model.width}×${model.height} ${model.format} ${model.mipLevels} mips`;
	},

	fixtures: [
		{ bundle: 'example/VEH_CARBRWDS_GR.BIN', expect: { parseOk: true } },
	],
};

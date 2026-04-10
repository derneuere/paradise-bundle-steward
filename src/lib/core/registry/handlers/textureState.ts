// TextureState registry handler (type 0xE).
//
// Wraps src/lib/core/textureState.ts. Read-only.
//
// In the registry context, the import table is unavailable, so the parsed
// textureId will always be null. Full import resolution happens in the viewer
// via decodeTextureState() or the materialChain resolver.

import {
	parseTextureState,
	TEXTURE_STATE_TYPE_ID,
	D3DTextureAddress,
	type ParsedTextureState,
} from '../../textureState';
import type { ResourceHandler } from '../handler';

const addressName: Record<number, string> = {
	[D3DTextureAddress.WRAP]: 'Wrap',
	[D3DTextureAddress.MIRROR]: 'Mirror',
	[D3DTextureAddress.CLAMP]: 'Clamp',
	[D3DTextureAddress.BORDER]: 'Border',
	[D3DTextureAddress.MIRRORONCE]: 'MirrorOnce',
};

export const textureStateHandler: ResourceHandler<ParsedTextureState> = {
	typeId: TEXTURE_STATE_TYPE_ID,
	key: 'texture-state',
	name: 'Texture State',
	description: 'Sampler state: addressing, filtering, and texture reference',
	category: 'Graphics',
	caps: { read: true, write: false },

	parseRaw(raw, _ctx) {
		// No imports in registry context.
		return parseTextureState(raw, new Map());
	},

	describe(model) {
		const u = addressName[model.addressU] ?? model.addressU;
		const v = addressName[model.addressV] ?? model.addressV;
		return `U=${u} V=${v} aniso=${model.maxAnisotropy}`;
	},

	fixtures: [
		{ bundle: 'example/VEH_CARBRWDS_GR.BIN', expect: { parseOk: true } },
	],
};

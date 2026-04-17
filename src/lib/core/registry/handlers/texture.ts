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
import type { PickerEntry, ResourceHandler } from '../handler';

// Natural-order collator — shared idiom across handlers that want "Name A→Z"
// to line up in-engine numeric suffixes correctly (`tex_2` < `tex_10`).
const NATURAL_NAME = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareByName(a: PickerEntry<ParsedTextureHeader>, b: PickerEntry<ParsedTextureHeader>): number {
	return NATURAL_NAME.compare(a.ctx.name, b.ctx.name);
}

function textureArea(m: ParsedTextureHeader | null): number {
	return m ? m.width * m.height : 0;
}

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

	// Vehicle bundles ship hundreds of textures (diffuse / normal / spec sets
	// per LOD) — the picker lets users sort by size or format to find the
	// interesting ones without scrolling a dropdown of raw hex ids.
	picker: {
		labelOf(model, { name }) {
			if (model == null) {
				return {
					primary: name,
					secondary: 'parse failed',
					badges: [{ label: 'parse failed', tone: 'warn' }],
				};
			}
			return {
				primary: name,
				secondary: `${model.width}×${model.height} · ${model.format}`,
			};
		},
		sortKeys: [
			{ id: 'name', label: 'Name (A→Z)', compare: compareByName },
			{ id: 'index', label: 'Bundle order', compare: (a, b) => a.ctx.index - b.ctx.index },
			{
				id: 'size-desc',
				label: 'Pixel count (high→low)',
				compare: (a, b) => textureArea(b.model) - textureArea(a.model),
			},
			{
				id: 'format',
				label: 'Format, then name',
				compare: (a, b) => {
					const fa = a.model?.format ?? '';
					const fb = b.model?.format ?? '';
					if (fa !== fb) return fa < fb ? -1 : 1;
					return compareByName(a, b);
				},
			},
		],
		defaultSort: 'name',
		searchText: (m, { name }) => `${name} ${m?.format ?? ''}`,
	},

	fixtures: [
		{ bundle: 'example/VEH_CARBRWDS_GR.BIN', expect: { parseOk: true } },
	],
};

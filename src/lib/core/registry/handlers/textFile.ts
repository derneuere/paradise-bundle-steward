// TextFile registry handler — wraps parseTextFileData / writeTextFileData.
//
// Used only by Bundle V1 ('bndl') prototype builds (Burnout 5 Nov 13 2006 /
// Feb 22 2007) to store BundleImports debug XML. Retail Bundle 2 bundles
// don't carry this type, so this handler exists primarily to make
// cross-container conversion (BND1 → BND2) of the older PVS fixture work
// without needing the `--allow-unknown` escape hatch.

import {
	parseTextFileData,
	writeTextFileData,
	type ParsedTextFile,
} from '../../textFile';
import { HANDLER_PLATFORM, type ResourceHandler } from '../handler';

export const textFileHandler: ResourceHandler<ParsedTextFile> = {
	typeId: 0x3,
	key: 'textFile',
	name: 'Text File',
	description: 'Development-only resource: BundleImports debug XML in BND1 prototype bundles',
	category: 'Other',
	caps: {
		read: true,
		write: true,
		// Validated on the X360 BND1 PVS fixture; PC isn't currently exercised
		// by any fixture, but the format is byte-oriented (only mLength is
		// endian-sensitive and we handle that), so PC writes work too.
		writePlatforms: [HANDLER_PLATFORM.PC, HANDLER_PLATFORM.XBOX360],
	},

	parseRaw(raw, ctx) {
		return parseTextFileData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeTextFileData(model, ctx.littleEndian);
	},
	describe(model) {
		const preview = model.text.length > 60 ? model.text.slice(0, 57) + '...' : model.text;
		return `text ${model.text.length} chars: "${preview.replace(/\n/g, '\\n')}"`;
	},

	fixtures: [
		{ bundle: 'example/older builds/PVS.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
	],
};

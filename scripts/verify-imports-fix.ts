// Quick sanity check that the fixed parseImportEntries() returns the same
// data as the per-resource readers in renderable.ts / graphicsSpec.ts.
// This is throwaway — once the workarounds in those modules are deleted,
// the whole codebase converges on parseImportEntries() and this script can
// be deleted too.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBundle } from '../src/lib/core/bundle';
import { getResourceImportSlice } from '../src/lib/core/bundle/bundleEntry';
import {
	getRenderableBlocks,
	readInlineImportTable,
	RENDERABLE_TYPE_ID,
} from '../src/lib/core/renderable';
import { GRAPHICS_SPEC_TYPE_ID, getGraphicsSpecHeader, parseGraphicsSpec } from '../src/lib/core/graphicsSpec';
import { u64ToBigInt } from '../src/lib/core/u64';

function hex(n: bigint | number, w = 16): string {
	return '0x' + n.toString(16).padStart(w, '0');
}

const bundlePath = process.argv[2] ?? 'example/VEH_CARBRWDS_GR.BIN';
const abs = path.resolve(bundlePath);
const fileBuf = fs.readFileSync(abs);
const buffer = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);
const bundle = parseBundle(buffer);

console.log(`bundle: ${abs}`);
console.log(`  total resources: ${bundle.resources.length}`);
console.log(`  total imports (flat, from parseImportEntries): ${bundle.imports.length}`);

// Compare the first Renderable's imports between the two readers.
const renderableIdx = bundle.resources.findIndex((r) => r.resourceTypeId === RENDERABLE_TYPE_ID);
if (renderableIdx === -1) {
	console.log('  no Renderables');
} else {
	const r = bundle.resources[renderableIdx];
	console.log(`\n  Renderable[${renderableIdx}] id=${hex(u64ToBigInt(r.resourceId))} importCount=${r.importCount}`);

	const flatSlice = getResourceImportSlice(bundle.imports, bundle.resources, renderableIdx);
	console.log(`    via parseImportEntries (flat): ${flatSlice?.length ?? 0} entries`);
	if (flatSlice) {
		for (let i = 0; i < Math.min(5, flatSlice.length); i++) {
			const e = flatSlice[i];
			console.log(`      [${i}] id=${hex(u64ToBigInt(e.resourceId))} ptrOffset=${hex(e.offset, 8)}`);
		}
	}

	const { header } = getRenderableBlocks(buffer, bundle, r);
	const inline = readInlineImportTable(header, r);
	console.log(`    via readInlineImportTable: ${inline.size} entries`);
	let i = 0;
	for (const [ptrOffset, id] of inline) {
		if (i++ >= 5) break;
		console.log(`      [${i - 1}] id=${hex(id)} ptrOffset=${hex(ptrOffset, 8)}`);
	}

	// Cross-check
	if (flatSlice) {
		const a = flatSlice.map((e) => `${u64ToBigInt(e.resourceId)}@${e.offset}`).sort();
		const b = Array.from(inline).map(([ptr, id]) => `${id}@${ptr}`).sort();
		const match = JSON.stringify(a) === JSON.stringify(b);
		console.log(`    MATCH: ${match}`);
	}
}

// Same for the GraphicsSpec.
const gsIdx = bundle.resources.findIndex((r) => r.resourceTypeId === GRAPHICS_SPEC_TYPE_ID);
if (gsIdx === -1) {
	console.log('\n  no GraphicsSpec');
} else {
	const r = bundle.resources[gsIdx];
	console.log(`\n  GraphicsSpec[${gsIdx}] id=${hex(u64ToBigInt(r.resourceId))} importCount=${r.importCount}`);

	const flatSlice = getResourceImportSlice(bundle.imports, bundle.resources, gsIdx);
	console.log(`    via parseImportEntries (flat): ${flatSlice?.length ?? 0} entries`);

	const header = getGraphicsSpecHeader(buffer, bundle, r);
	const gs = parseGraphicsSpec(header, r);
	console.log(`    via parseGraphicsSpec.imports: ${gs.imports.length} entries`);

	if (flatSlice) {
		const a = flatSlice.map((e) => u64ToBigInt(e.resourceId).toString()).sort();
		const b = gs.imports.map((id) => id.toString()).sort();
		const match = JSON.stringify(a) === JSON.stringify(b);
		console.log(`    MATCH (ids only): ${match}`);
	}
}

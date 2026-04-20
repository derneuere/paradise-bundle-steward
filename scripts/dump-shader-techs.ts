// Dump the translated vs+ps for each technique of a Shader resource.
// Usage: npx tsx scripts/dump-shader-techs.ts <shaderIndex>

import { readFileSync } from 'node:fs';
import { parseBundle, getImportIds } from '../src/lib/core/bundle/index';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { translateDxbc } from '../src/lib/core/dxbc';
import { u64ToBigInt } from '../src/lib/core/u64';

const idx = Number(process.argv[2] ?? '0');
const SHADER = 0x32, PB = 0x12;

const buf = readFileSync('example/SHADERS.BNDL');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bundle = parseBundle(ab);
const shaders = bundle.resources
	.map((r, i) => ({ r, i }))
	.filter((x) => x.r.resourceTypeId === SHADER);
const pick = shaders[idx];
if (!pick) { console.error('bad index'); process.exit(1); }

const importIds = getImportIds(bundle.imports, bundle.resources, pick.i);
console.log('imports:', importIds.length);
for (let n = 0; n < importIds.length; n++) {
	const id = importIds[n];
	const target = bundle.resources.find((r) => u64ToBigInt(r.resourceId) === id && r.resourceTypeId === PB);
	if (!target) { console.log(`  [${n}] id=${id.toString(16)} — not a PB`); continue; }
	const blocks = getResourceBlocks(ab, bundle, target);
	const bytecode = blocks[1];
	if (!bytecode) { console.log(`  [${n}] id=${id.toString(16)} — no block 1`); continue; }
	try {
		const t = translateDxbc(bytecode);
		console.log(`\n========== import [${n}] → ${t.programLabel}, ${t.decoded.body.length} instr ==========`);
		console.log(t.source);
	} catch (e) {
		console.log(`  [${n}] translate failed:`, e instanceof Error ? e.message : e);
	}
}

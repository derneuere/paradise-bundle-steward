// Dump translated vs+ps for a shader picked by name substring.
// Usage: npx tsx scripts/inspect-shader-by-name.ts <namePart>
import { readFileSync } from 'node:fs';
import { parseBundle, getImportIds } from '../src/lib/core/bundle/index';
import { extractResourceRaw } from '../src/lib/core/registry';
import { parseShaderData, SHADER_TYPE_ID } from '../src/lib/core/shader';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { translateDxbc } from '../src/lib/core/dxbc';
import { u64ToBigInt } from '../src/lib/core/u64';

const needle = (process.argv[2] ?? '').toLowerCase();
const PB = 0x12;
const buf = readFileSync('example/SHADERS.BNDL');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bundle = parseBundle(ab);

for (let i = 0; i < bundle.resources.length; i++) {
	const r = bundle.resources[i];
	if (r.resourceTypeId !== SHADER_TYPE_ID) continue;
	const raw = extractResourceRaw(ab, bundle, r);
	const parsed = parseShaderData(raw);
	if (!parsed.name.toLowerCase().includes(needle)) continue;
	console.log(`### ${parsed.name}  (bundle idx ${i}, ${parsed.numTechniques} techs, ${parsed.numConstants} consts)`);
	console.log('constants with baked instance data:');
	for (const c of parsed.constants) {
		if (c.instanceData) console.log(`  ${c.name} = (${c.instanceData.map(v => v.toFixed(3)).join(', ')})`);
	}
	const importIds = getImportIds(bundle.imports, bundle.resources, i);
	for (let n = 0; n < importIds.length; n++) {
		const id = importIds[n];
		const target = bundle.resources.find((rr) => u64ToBigInt(rr.resourceId) === id && rr.resourceTypeId === PB);
		if (!target) continue;
		const blocks = getResourceBlocks(ab, bundle, target);
		const bytecode = blocks[1];
		if (!bytecode) continue;
		try {
			const t = translateDxbc(bytecode);
			console.log(`\n--- import [${n}] → ${t.programLabel}, ${t.decoded.body.length} instr ---`);
			console.log(t.source);
		} catch (e) {
			console.log(`  [${n}] translate failed:`, e instanceof Error ? e.message : e);
		}
	}
	console.log('');
}

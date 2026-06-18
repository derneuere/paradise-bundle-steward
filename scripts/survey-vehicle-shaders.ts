// Survey a vehicle GR bundle's shaders for skinning signals: the vertex input
// semantics (BLENDINDICES/BLENDWEIGHT) and the cb0 constant names + slot ranges
// (looking for a bone/verlet matrix palette in the high slots).
//
// Run: fnm exec --using=22 node node_modules/tsx/dist/cli.mjs scripts/survey-vehicle-shaders.ts example/VEH_CARBB1GT_GR.BIN

import { readFileSync } from 'node:fs';
import { parseBundle } from '../src/lib/core/bundle/index';
import { getHandlerByKey } from '../src/lib/core/registry';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { translateDxbc } from '../src/lib/core/dxbc';

const path = process.argv[2] ?? 'example/VEH_CARBB1GT_GR.BIN';
const buf = readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bundle = parseBundle(ab);
const spb = getHandlerByKey('shaderProgramBuffer')!;

const inputSemantics = new Map<string, number>();   // VS input semantic -> count
const constMaxSlot = new Map<string, number>();      // const name -> max slot seen
const constCount = new Map<string, number>();
let vs = 0, ps = 0;

for (const r of bundle.resources.filter((x) => x.resourceTypeId === spb.typeId)) {
	const blocks = getResourceBlocks(ab, bundle, r);
	const raw = blocks[1];
	if (!raw || raw.byteLength < 0x20) continue;
	let tr;
	try { tr = translateDxbc(raw); } catch { continue; }
	if (tr.parsed.programType === 'vertex') {
		vs++;
		for (const i of tr.parsed.inputs) inputSemantics.set(i.semanticName, (inputSemantics.get(i.semanticName) ?? 0) + 1);
	} else { ps++; }
	for (const cb of tr.parsed.reflection.constantBuffers) {
		for (const v of cb.variables) {
			const slot = Math.floor(v.startOffset / 16);
			const endSlot = Math.floor((v.startOffset + v.size - 1) / 16);
			constMaxSlot.set(v.name, Math.max(constMaxSlot.get(v.name) ?? 0, endSlot));
			constCount.set(v.name, (constCount.get(v.name) ?? 0) + 1);
		}
	}
}

console.log(`bundle=${path}  VS=${vs} PS=${ps}`);
console.log('\nVS INPUT SEMANTICS (look for BLENDINDICES / BLENDWEIGHT):');
for (const [s, n] of [...inputSemantics].sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(20)} ${n}`);
console.log('\nCONSTANTS that span a wide slot range (>= 4 slots = matrix arrays / palettes):');
const wide = [...constMaxSlot].map(([name, max]) => ({ name, max, n: constCount.get(name) ?? 0 }))
	.filter((c) => c.max >= 8).sort((a, b) => b.max - a.max);
for (const c of wide) console.log(`  ${c.name.padEnd(34)} maxSlot=${c.max}  count=${c.n}`);
console.log('\nALL constant names by count (top 50):');
for (const [name, n] of [...constCount].sort((a, b) => b[1] - a[1]).slice(0, 50)) {
	console.log(`  ${name.padEnd(34)} count=${n} maxSlot=${constMaxSlot.get(name)}`);
}

// Dump RDEF variables (name + cb slot) for a shader's pixel stage.
import { readFileSync } from 'node:fs';
import { parseBundle, getImportIds } from '../src/lib/core/bundle/index';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { translateDxbc } from '../src/lib/core/dxbc';
import { u64ToBigInt } from '../src/lib/core/u64';

const idx = Number(process.argv[2] ?? '0');
const buf = readFileSync('example/SHADERS.BNDL');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bundle = parseBundle(ab);
const shaders = bundle.resources.map((r, i) => ({ r, i })).filter(x => x.r.resourceTypeId === 0x32);
const pick = shaders[idx];
const importIds = getImportIds(bundle.imports, bundle.resources, pick.i);
// Find the pixel shader — imports[1] per technique
for (let t = 0; t < importIds.length; t += 2) {
	const psId = importIds[t + 1];
	const target = bundle.resources.find((r) => u64ToBigInt(r.resourceId) === psId);
	if (!target) continue;
	const blocks = getResourceBlocks(ab, bundle, target);
	const bc = blocks[1];
	if (!bc) continue;
	try {
		const tr = translateDxbc(bc);
		if (tr.parsed.programType !== 'pixel') continue;
		console.log(`\n=== technique ${t / 2} pixel shader ===`);
		// Raw RDEF peek
		const rdef = tr.parsed.chunks.find((c) => c.kind === 'RDEF');
		if (rdef) {
			const dv = new DataView(tr.parsed.bytes.buffer, tr.parsed.bytes.byteOffset, tr.parsed.bytes.byteLength);
			const body = rdef.offset + 8;
			const numCb = dv.getUint32(body + 0, true);
			const cbOff = dv.getUint32(body + 4, true);
			const numB = dv.getUint32(body + 8, true);
			const bOff = dv.getUint32(body + 12, true);
			console.log(`  raw RDEF: body=0x${body.toString(16)}, numCb=${numCb}, cbOff=0x${cbOff.toString(16)}, numB=${numB}, bOff=0x${bOff.toString(16)}, dxbcSize=${tr.parsed.bytes.byteLength}`);
		}
		console.log(`  ${tr.parsed.reflection.constantBuffers.length} cbuffers, ${tr.parsed.reflection.resourceBindings.length} bindings`);
		for (const cbuf of tr.parsed.reflection.constantBuffers) {
			console.log(`  cbuffer "${cbuf.name}" (${cbuf.size} bytes, ${cbuf.variables.length} variables):`);
			for (const v of cbuf.variables) {
				const slot = Math.floor(v.startOffset / 16);
				console.log(`    slot ${slot.toString().padStart(3)} — ${v.name} (size ${v.size} bytes)`);
			}
		}
		console.log('  resource bindings:');
		for (const b of tr.parsed.reflection.resourceBindings) {
			console.log(`    type=${b.type} bp=${b.bindPoint} name=${b.name}`);
		}
		break;
	} catch {}
}

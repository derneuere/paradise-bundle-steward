// Diagnostic: what cb0 matrix layout does inferCbLayout resolve for real vehicle
// vertex shaders, and what named constants do those VS expose? Used to chase the
// translated-path vertex displacement (geometry is correct under PBR, so the
// translated VS transform is suspect).
//
// Run: fnm exec --using=22 node node_modules/tsx/dist/cli.mjs scripts/diag-cb-layout.ts

import { readFileSync } from 'node:fs';
import { parseBundle, getImportIds } from '../src/lib/core/bundle/index';
import { SHADER_TYPE_ID, SHADER_PROGRAM_BUFFER_TYPE_ID, parseShaderData } from '../src/lib/core/shader';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { translateDxbc } from '../src/lib/core/dxbc';
import { inferCbLayout } from '../src/lib/core/shaderEngineConstants';
import { u64ToBigInt } from '../src/lib/core/u64';
import type { ResourceEntry } from '../src/lib/core/types';

const path = process.argv[2] ?? 'example/SHADERS.BNDL';
const targets = process.argv.slice(3);
if (targets.length === 0) targets.push('Opaque_Metal', 'GreyScale_Decal', 'Greyscale_Window');
const buf = readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const bundle = parseBundle(ab);

for (let i = 0; i < bundle.resources.length; i++) {
	const r = bundle.resources[i];
	if (r.resourceTypeId !== SHADER_TYPE_ID) continue;
	let name = '';
	try { name = parseShaderData(getResourceBlocks(ab, bundle, r as ResourceEntry)[0]!).name; } catch { /* */ }
	if (!targets.some((t) => name.includes(t))) continue;
	const ids = getImportIds(bundle.imports, bundle.resources, i);
	let vs: ReturnType<typeof translateDxbc> | null = null;
	for (const id of ids) {
		const t = bundle.resources.find((rr) => u64ToBigInt(rr.resourceId) === id && rr.resourceTypeId === SHADER_PROGRAM_BUFFER_TYPE_ID);
		if (!t) continue;
		const bc = getResourceBlocks(ab, bundle, t as ResourceEntry)[1];
		if (!bc) continue;
		try { const tr = translateDxbc(bc); if (tr.parsed.programType === 'vertex') { vs = tr; break; } } catch { /* */ }
	}
	if (!vs) continue;
	const names = vs.parsed.reflection.constantBuffers.flatMap((cb) => cb.variables.map((v) => `${v.name}@${Math.floor(v.startOffset / 16)}${v.size > 16 ? '..' + Math.floor((v.startOffset + v.size - 1) / 16) : ''}`));
	console.log(`\n=== ${name} ===`);
	console.log('cb0 vars:', names.join('  '));
	console.log('layout :', JSON.stringify(inferCbLayout(vs.source, vs.parsed)));
	console.log('gl_Position line:', vs.source.split('\n').find((l) => l.includes('gl_Position'))?.trim());
}

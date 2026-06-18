// Dump the translated PS GLSL for named vehicle shaders, so we can see how the
// engine-global samplers (Reflection t13, GlassFracture t14, shadowMap t15) are
// actually combined into the output — grounding the right neutral fallback.
//
// Run: fnm exec --using=22 node node_modules/tsx/dist/cli.mjs \
//        scripts/dump-shader-ps.ts example/SHADERS.BNDL Window Metal

import { readFileSync } from 'node:fs';
import { parseBundle, getImportIds } from '../src/lib/core/bundle/index';
import { parseDebugDataFromBuffer, parseShaderNameMap } from '../src/lib/core/materialChain';
import { SHADER_TYPE_ID, SHADER_PROGRAM_BUFFER_TYPE_ID, parseShaderData } from '../src/lib/core/shader';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { translateDxbc } from '../src/lib/core/dxbc';
import { u64ToBigInt } from '../src/lib/core/u64';
import type { ResourceEntry } from '../src/lib/core/types';

const path = process.argv[2] ?? 'example/SHADERS.BNDL';
const filters = process.argv.slice(3).map((s) => s.toLowerCase());
const buf = readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bundle = parseBundle(ab);
const names = parseShaderNameMap(ab);

for (let i = 0; i < bundle.resources.length; i++) {
	const r = bundle.resources[i];
	if (r.resourceTypeId !== SHADER_TYPE_ID) continue;
	let name = '';
	try { name = parseShaderData(getResourceBlocks(ab, bundle, r as ResourceEntry)[0]!).name; } catch { /* */ }
	if (!name) name = names.get(u64ToBigInt(r.resourceId).toString(16)) ?? '';
	if (filters.length && !filters.some((f) => name.toLowerCase().includes(f))) continue;

	const importIds = getImportIds(bundle.imports, bundle.resources, i);
	let ps: ReturnType<typeof translateDxbc> | null = null;
	for (const id of importIds) {
		const t = bundle.resources.find((rr) => u64ToBigInt(rr.resourceId) === id && rr.resourceTypeId === SHADER_PROGRAM_BUFFER_TYPE_ID);
		if (!t) continue;
		const bc = getResourceBlocks(ab, bundle, t as ResourceEntry)[1];
		if (!bc) continue;
		try { const tr = translateDxbc(bc); if (tr.parsed.programType === 'pixel' && !ps) ps = tr; } catch { /* */ }
	}
	if (!ps) continue;
	console.log(`\n================= ${name} =================`);
	const samp = [...ps.source.matchAll(/uniform sampler2D ([A-Za-z0-9_]+);\s*\/\/\s*t(\d+)/g)].map((m) => `t${m[2]}:${m[1]}`);
	console.log('SAMPLERS:', samp.join('  '));
	console.log(ps.source);
}

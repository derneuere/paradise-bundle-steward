// Survey the RDEF constant-buffer variable names across every shader in
// example/SHADERS.BNDL, joined with the parent Shader (0x32) resources' baked
// instance data, to find which constants are ENGINE-SUPPLIED (no baked default)
// and whether the cb0 seeding table covers them.
//
// Run: fnm exec --using=22 npx tsx scripts/survey-shader-constants.ts

import { readFileSync } from 'node:fs';
import { parseBundle } from '../src/lib/core/bundle/index';
import { getHandlerByKey, resourceCtxFromBundle } from '../src/lib/core/registry';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { translateDxbc } from '../src/lib/core/dxbc';
import { parseShaderData } from '../src/lib/core/shader';

import { ENGINE_CONSTANT_DEFAULTS } from '../src/lib/core/shaderEngineConstants';

// The names the cb0 seeding table covers (now sourced from the real shared module).
const HEURISTIC = new Set(Object.keys(ENGINE_CONSTANT_DEFAULTS));
// Engine matrices bound structurally per-frame by inferCbLayout + __updateCb0.
const ENGINE_MATRIX = new Set([
	'world', 'ViewProjectionModified', 'ViewPosition', 'worldViewProj', 'viewProjection',
]);

const buf = readFileSync('example/SHADERS.BNDL');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bundle = parseBundle(ab);
const ctx = resourceCtxFromBundle(bundle);

// 1. Collect every constant name that ANY Shader (0x32) bakes instanceData for
//    (= material default, not engine-supplied).
const shaderHandler = getHandlerByKey('shader');
const bakedNames = new Set<string>();
if (shaderHandler) {
	for (const r of bundle.resources.filter((x) => x.resourceTypeId === shaderHandler.typeId)) {
		try {
			const blocks = getResourceBlocks(ab, bundle, r);
			const parsed = parseShaderData(blocks[0]);
			for (const c of parsed.constants) if (c.instanceData) bakedNames.add(c.name);
		} catch { /* skip */ }
	}
}

// 2. Tally cb0 variable names across all shader program buffers.
const spbHandler = getHandlerByKey('shaderProgramBuffer')!;
const nameCount = new Map<string, number>();
let shaders = 0;
for (const r of bundle.resources.filter((x) => x.resourceTypeId === spbHandler.typeId)) {
	const blocks = getResourceBlocks(ab, bundle, r);
	const raw = blocks[1];
	if (!raw || raw.byteLength < 0x20) continue;
	let tr;
	try { tr = translateDxbc(raw); } catch { continue; }
	shaders++;
	for (const cb of tr.parsed.reflection.constantBuffers) {
		for (const v of cb.variables) nameCount.set(v.name, (nameCount.get(v.name) ?? 0) + 1);
	}
}

console.log(`shaders translated: ${shaders}; distinct constant names: ${nameCount.size}; baked-default names: ${bakedNames.size}`);
console.log('');
console.log('ENGINE-SUPPLIED constants NOT covered by the seeding table (gap):');
const gap: [string, number][] = [];
for (const [name, n] of nameCount) {
	if (HEURISTIC.has(name) || ENGINE_MATRIX.has(name)) continue;
	if (bakedNames.has(name)) continue; // has a material default -> not engine-supplied
	gap.push([name, n]);
}
for (const [name, n] of gap.sort((a, b) => b[1] - a[1])) {
	console.log(`  ${name.padEnd(40)} ${n}`);
}
console.log('');
console.log('Covered engine constants seen in fixtures:');
for (const [name, n] of [...nameCount].filter(([nm]) => HEURISTIC.has(nm) || ENGINE_MATRIX.has(nm)).sort((a, b) => b[1] - a[1])) {
	console.log(`  ${name.padEnd(40)} ${n}`);
}

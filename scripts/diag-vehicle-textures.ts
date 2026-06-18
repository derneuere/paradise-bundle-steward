// Diagnostic: why do translated vehicle shaders render magenta?
//
// Loads a vehicle GR bundle + companion texture/shader bundles, then mirrors
// RenderableViewport's translated-shader path EXACTLY:
//   material → shaderImport → translate DXBC → for each PS sampler register
//   `// tN`, look up materialBinding.samplerBindings.get(N).
// Reports, per material, whether each sampler register resolves to a real
// texture (material-binding hit), a name-match, or falls through to the
// magenta placeholder — and prints the Material Sampler `channel` values next
// to the shader's DXBC texture registers so we can see if the two numbering
// schemes actually agree.
//
// Run: fnm exec --using=22 node node_modules/tsx/dist/cli.mjs \
//        scripts/diag-vehicle-textures.ts \
//        example/VEH_CARBB1GT_GR.BIN example/VEHICLETEX.BIN example/SHADERS.BNDL

import { readFileSync } from 'node:fs';
import { parseBundle, formatResourceId, getImportIds } from '../src/lib/core/bundle/index';
import { parseDebugDataFromBuffer, parseDebugDataFromXml, type DebugResource } from '../src/lib/core/bundle/debugData';
import { buildTextureCatalog } from '../src/lib/core/textureCatalog';
import { buildMaterialIndex, pickBestMaterial } from '../src/lib/core/materialBinding';
import { MATERIAL_TYPE_ID, parseMaterialData } from '../src/lib/core/material';
import { SHADER_TYPE_ID, SHADER_PROGRAM_BUFFER_TYPE_ID, parseShaderData } from '../src/lib/core/shader';
import { translateDxbc, type TranslatedShader } from '../src/lib/core/dxbc';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { u64ToBigInt } from '../src/lib/core/u64';
import type { ParsedBundle, ResourceEntry } from '../src/lib/core/types';

type Src = { source: string; bundle: ParsedBundle; arrayBuffer: ArrayBuffer; debug: DebugResource[] };

function load(path: string, source: string): Src {
	const buf = readFileSync(path);
	const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	const bundle = parseBundle(ab);
	let debug: DebugResource[] = [];
	try {
		const xml = parseDebugDataFromBuffer(ab, bundle.header);
		if (xml) debug = parseDebugDataFromXml(xml);
	} catch { /* no debug */ }
	return { source, bundle, arrayBuffer: ab, debug };
}

/** Mirror of RenderableViewport.translateShaderById. */
function translateShaderById(shaderId: bigint, sources: Src[]): { vs: TranslatedShader; ps: TranslatedShader; name: string } | null {
	for (const s of sources) {
		for (let i = 0; i < s.bundle.resources.length; i++) {
			const r = s.bundle.resources[i];
			if (r.resourceTypeId !== SHADER_TYPE_ID) continue;
			if (u64ToBigInt(r.resourceId) !== shaderId) continue;
			let name = '';
			try {
				const blk = getResourceBlocks(s.arrayBuffer, s.bundle, r as ResourceEntry)[0];
				if (blk) name = parseShaderData(blk).name;
			} catch { /* ignore */ }
			const importIds = getImportIds(s.bundle.imports, s.bundle.resources, i);
			let vs: TranslatedShader | null = null;
			let ps: TranslatedShader | null = null;
			for (const id of importIds) {
				const target = s.bundle.resources.find((rr) => u64ToBigInt(rr.resourceId) === id && rr.resourceTypeId === SHADER_PROGRAM_BUFFER_TYPE_ID);
				if (!target) continue;
				const bytecode = getResourceBlocks(s.arrayBuffer, s.bundle, target as ResourceEntry)[1];
				if (!bytecode) continue;
				try {
					const t = translateDxbc(bytecode);
					if (t.parsed.programType === 'vertex' && !vs) vs = t;
					else if (t.parsed.programType === 'pixel' && !ps) ps = t;
				} catch { /* next */ }
				if (vs && ps) break;
			}
			if (vs && ps) return { vs, ps, name };
			return null;
		}
	}
	return null;
}

function psSamplerRegs(ps: TranslatedShader): { name: string; reg: number }[] {
	const out: { name: string; reg: number }[] = [];
	for (const m of ps.source.matchAll(/uniform sampler2D ([A-Za-z0-9_]+);\s*\/\/\s*t(\d+)/g)) {
		out.push({ name: m[1], reg: Number(m[2]) });
	}
	return out;
}

// ---------------------------------------------------------------------------

const grPath = process.argv[2] ?? 'example/VEH_CARBB1GT_GR.BIN';
const companions = process.argv.slice(3);
if (companions.length === 0) companions.push('example/VEHICLETEX.BIN', 'example/SHADERS.BNDL');

const primary = load(grPath, 'primary');
const sources: Src[] = [primary, ...companions.map((p, i) => load(p, `companion${i}`))];

console.log('=== bundles ===');
for (const s of sources) {
	const counts = new Map<number, number>();
	for (const r of s.bundle.resources) counts.set(r.resourceTypeId, (counts.get(r.resourceTypeId) ?? 0) + 1);
	const tex = counts.get(0x00) ?? 0, mat = counts.get(0x01) ?? 0, ts = counts.get(0x0e) ?? 0, sh = counts.get(0x32) ?? 0;
	console.log(`  ${s.source.padEnd(11)} ${s.bundle.resources.length} resources  (tex=${tex} mat=${mat} texstate=${ts} shader=${sh})`);
}

const textureCatalog = buildTextureCatalog(sources);
const materialIndex = buildMaterialIndex(sources, textureCatalog);
console.log(`\ntexture catalog: ${textureCatalog.length} textures`);
console.log(`material index : ${materialIndex.size} distinct target shaders`);

// Walk the GR bundle's Materials (the ones a vehicle mesh would reference).
let totalSamplers = 0, matHits = 0, nameMatchable = 0, magenta = 0, noShader = 0, noBinding = 0;
const grMaterials = primary.bundle.resources.filter((r) => r.resourceTypeId === MATERIAL_TYPE_ID);
console.log(`\n=== ${grMaterials.length} materials in ${grPath} ===\n`);

let shown = 0;
for (const r of grMaterials) {
	const matId = formatResourceId(u64ToBigInt(r.resourceId));
	const block0 = getResourceBlocks(primary.arrayBuffer, primary.bundle, r as ResourceEntry)[0];
	if (!block0) continue;
	let parsed;
	try { parsed = parseMaterialData(block0); } catch { continue; }
	const shaderId = parsed.shaderImport.id;
	const shaderHex = formatResourceId(shaderId);

	const translated = translateShaderById(shaderId, sources);
	const regs = translated ? psSamplerRegs(translated.ps) : [];

	// material binding for THIS material id (same lookup the viewport uses)
	const binding = materialIndex.get(shaderHex)?.find((b) => b.materialId === matId)
		?? pickBestMaterial(shaderHex, [], materialIndex);

	const detail = shown < 12;
	if (detail) {
		console.log(`material ${matId}  shader=${shaderHex}  "${translated?.name ?? '??'}"`);
		if (!translated) { console.log('    (shader did not translate)'); }
		console.log(`    PS sampler registers: ${regs.map((s) => `t${s.reg}:${s.name}`).join('  ') || '(none)'}`);
		if (binding) {
			const keys = [...binding.samplerBindings.keys()].sort((a, b) => a - b);
			console.log(`    material bound channels: ${keys.map((k) => `ch${k}→${binding.samplerBindings.get(k)!.id}`).join('  ') || '(none)'}  [mat ${binding.materialId} src ${binding.source}]`);
		} else {
			console.log('    NO material binding found for this shader');
		}
	}

	for (const s of regs) {
		totalSamplers++;
		if (!translated) { noShader++; continue; }
		const fromMat = binding?.samplerBindings.get(s.reg);
		if (fromMat) { matHits++; if (detail) console.log(`      t${s.reg} ${s.name}: MATERIAL → ${fromMat.id}`); }
		else {
			if (!binding) noBinding++;
			// would name-match find anything? (rough: any catalog name shares a token)
			magenta++;
			if (detail) console.log(`      t${s.reg} ${s.name}: ✗ MAGENTA (binding has ${binding ? [...binding.samplerBindings.keys()].join(',') : 'none'})`);
		}
	}
	if (detail) console.log('');
	shown++;
}

console.log('=== summary ===');
console.log(`  total PS sampler registers across GR materials: ${totalSamplers}`);
console.log(`  resolved via material binding:                  ${matHits}`);
console.log(`  fell through to magenta placeholder:            ${magenta}`);
console.log(`  (of which: shader didn't translate:             ${noShader})`);
console.log(`  (of which: no material binding for shader:      ${noBinding})`);

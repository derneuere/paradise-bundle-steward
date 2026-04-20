// Probe: cross-reference Material resources in a vehicle bundle with shader
// names in a SHADERS bundle. Prints, for each material, the shader it imports
// and a list of the texture state imports. Useful for spotting which
// shader drives which mesh (e.g. locating the Green glass tint).
import * as fs from 'node:fs';
import { parseBundle } from '../src/lib/core/bundle';
import { extractResourceRaw } from '../src/lib/core/registry';
import { parseShaderData, SHADER_TYPE_ID } from '../src/lib/core/shader';
import { parseMaterialData, MATERIAL_TYPE_ID } from '../src/lib/core/material';
import { u64ToBigInt } from '../src/lib/core/u64';

function ridToBig(rid: unknown): bigint {
	return u64ToBigInt(rid as { low: number; high: number });
}

const shadersPath = process.argv[2] ?? 'example/SHADERS.BNDL';
const vehPath = process.argv[3] ?? 'example/VEH_CARBRWDS_GR.BIN';

function loadBundle(p: string) {
	const raw = fs.readFileSync(p);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return { bundle: parseBundle(bytes.buffer), buffer: bytes.buffer };
}

const shaders = loadBundle(shadersPath);
const veh = loadBundle(vehPath);

// Index shaders by resource id → name
const shaderName = new Map<string, string>();
for (const r of shaders.bundle.resources) {
	if (r.resourceTypeId !== SHADER_TYPE_ID) continue;
	const raw = extractResourceRaw(shaders.buffer, shaders.bundle, r);
	const parsed = parseShaderData(raw);
	shaderName.set(ridToBig(r.resourceId).toString(16), parsed.name);
}

console.log(`loaded ${shaderName.size} shader names from ${shadersPath}`);
console.log('---');

let idx = 0;
for (const r of veh.bundle.resources) {
	if (r.resourceTypeId !== MATERIAL_TYPE_ID) continue;
	const raw = extractResourceRaw(veh.buffer, veh.bundle, r);
	try {
		const m = parseMaterialData(raw);
		const sid = m.shaderImport.id.toString(16);
		const name = shaderName.get(sid) ?? `<unknown ${sid}>`;
		console.log(`mat[${String(idx).padStart(2,' ')}] id=${ridToBig(r.resourceId).toString(16).padStart(16,'0')}  numMS=${m.numMaterialStates} numTS=${m.numTextureStates}  shader=${name}`);
		idx++;
	} catch (e) {
		console.log(`mat[${idx}] PARSE ERROR: ${e}`);
		idx++;
	}
}

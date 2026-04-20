// Probe: dump the materialDiffuse float4 (specPower, R, G, B) at body +0x100
// for every Vehicle_Greyscale_Window_Textured material in a vehicle bundle.
// Used to answer "does this fixture actually carry a non-white glass tint?".
import * as fs from 'node:fs';
import { parseBundle } from '../src/lib/core/bundle';
import { extractResourceRaw } from '../src/lib/core/registry';
import { parseMaterialData, MATERIAL_TYPE_ID } from '../src/lib/core/material';
import { u64ToBigInt } from '../src/lib/core/u64';

const WINDOW_SHADER_ID = 0x5ea40b33n;
const DIFFUSE_FLOAT4_OFFSET = 0x100;

function ridToBig(rid: unknown): bigint {
	return u64ToBigInt(rid as { low: number; high: number });
}

function readF32(body: number[], off: number): number {
	const u8 = new Uint8Array(body.slice(off, off + 4));
	return new DataView(u8.buffer).getFloat32(0, true);
}

const vehPath = process.argv[2] ?? 'example/VEH_CARBRWDS_GR.BIN';
const raw = fs.readFileSync(vehPath);
const bytes = new Uint8Array(raw.byteLength);
bytes.set(raw);
const bundle = parseBundle(bytes.buffer);

for (const r of bundle.resources) {
	if (r.resourceTypeId !== MATERIAL_TYPE_ID) continue;
	const body = extractResourceRaw(bytes.buffer, bundle, r);
	const mat = parseMaterialData(body);
	if (mat.shaderImport.id !== WINDOW_SHADER_ID) continue;

	const specPow = readF32(mat.body, DIFFUSE_FLOAT4_OFFSET);
	const r_ = readF32(mat.body, DIFFUSE_FLOAT4_OFFSET + 4);
	const g_ = readF32(mat.body, DIFFUSE_FLOAT4_OFFSET + 8);
	const b_ = readF32(mat.body, DIFFUSE_FLOAT4_OFFSET + 12);
	console.log(`glass mat ${ridToBig(r.resourceId).toString(16).padStart(16, '0')}  specPow=${specPow}  tint=(${r_.toFixed(3)}, ${g_.toFixed(3)}, ${b_.toFixed(3)})`);
}

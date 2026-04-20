// Dump everything we can read about a window-glass material without guessing:
// - all three PS-constant float4s the tint test hinted at (+0xF0, +0x100, +0x110)
// - the MaterialState(s) it binds, as (D3DRS id → value) pairs
// - the shader's per-slot constant layout (from Shader resource)
// Goal: get the real rendering recipe instead of inventing multipliers.
import * as fs from 'node:fs';
import { parseBundle } from '../src/lib/core/bundle';
import { extractResourceRaw } from '../src/lib/core/registry';
import { parseMaterialData, MATERIAL_TYPE_ID } from '../src/lib/core/material';
import { parseShaderData, SHADER_TYPE_ID } from '../src/lib/core/shader';
import { u64ToBigInt } from '../src/lib/core/u64';

const WINDOW_SHADER_ID = 0x5ea40b33n;
const MATERIAL_STATE_TYPE_ID = 0xF;

function ridToBig(rid: unknown): bigint {
	return u64ToBigInt(rid as { low: number; high: number });
}

function readF32(raw: Uint8Array | number[], off: number): number {
	const u8 = raw instanceof Uint8Array ? raw.slice(off, off + 4) : new Uint8Array(raw.slice(off, off + 4));
	return new DataView(u8.buffer, u8.byteOffset ?? 0, 4).getFloat32(0, true);
}
function readU32(raw: Uint8Array, off: number): number {
	return new DataView(raw.buffer, raw.byteOffset + off, 4).getUint32(0, true);
}

const vehPath = process.argv[2] ?? 'example/VEH_CARBRWDS_GR.BIN';
const shadersPath = process.argv[3] ?? 'example/SHADERS.BNDL';

const vehRaw = fs.readFileSync(vehPath);
const vehBytes = new Uint8Array(vehRaw.byteLength);
vehBytes.set(vehRaw);
const vehBundle = parseBundle(vehBytes.buffer);

const shaRaw = fs.readFileSync(shadersPath);
const shaBytes = new Uint8Array(shaRaw.byteLength);
shaBytes.set(shaRaw);
const shaBundle = parseBundle(shaBytes.buffer);

// --- Window shader resource dump ---
console.log('\n=== Shader: Vehicle_Greyscale_Window_Textured ===');
for (const r of shaBundle.resources) {
	if (r.resourceTypeId !== SHADER_TYPE_ID) continue;
	const id = ridToBig(r.resourceId);
	if (id !== WINDOW_SHADER_ID) continue;
	const raw = extractResourceRaw(shaBytes.buffer, shaBundle, r);
	const parsed = parseShaderData(raw);
	console.log(`size=${raw.byteLength} techniques=${parsed.numTechniques} constants=${parsed.numConstants} withInstanceData=${parsed.numConstantsWithInstanceData}`);
	console.log('first 64 bytes hex:');
	const hex: string[] = [];
	for (let i = 0; i < Math.min(64, raw.byteLength); i++) hex.push(raw[i].toString(16).padStart(2, '0'));
	console.log('  ' + hex.join(' '));
}

// --- Window material(s) in the vehicle ---
console.log('\n=== Window materials in', vehPath, '===');
const materialStateIds = new Set<bigint>();
for (const r of vehBundle.resources) {
	if (r.resourceTypeId !== MATERIAL_TYPE_ID) continue;
	const raw = extractResourceRaw(vehBytes.buffer, vehBundle, r);
	const mat = parseMaterialData(raw);
	if (mat.shaderImport.id !== WINDOW_SHADER_ID) continue;
	const rid = ridToBig(r.resourceId);
	console.log(`\n--- material ${rid.toString(16).padStart(16, '0')} (size ${raw.byteLength}) ---`);

	// Body hex around the tint region
	for (const off of [0xE0, 0xF0, 0x100, 0x110, 0x120]) {
		const v0 = readF32(mat.body, off);
		const v1 = readF32(mat.body, off + 4);
		const v2 = readF32(mat.body, off + 8);
		const v3 = readF32(mat.body, off + 12);
		console.log(`  body +0x${off.toString(16).padStart(3, '0')}: (${v0.toFixed(4)}, ${v1.toFixed(4)}, ${v2.toFixed(4)}, ${v3.toFixed(4)})`);
	}

	// PS constant override table header at +0xC4 (per test hint)
	console.log('  PS constant header bytes at +0xC0..+0xF0:');
	const hex: string[] = [];
	for (let i = 0xC0; i < 0xF0 && i < mat.body.length; i++) hex.push((mat.body[i] & 0xff).toString(16).padStart(2, '0'));
	console.log('    ' + hex.join(' '));

	for (const ms of mat.materialStateImports) materialStateIds.add(ms.id);
	console.log(`  materialStateIds: ${mat.materialStateImports.map(i => i.id.toString(16)).join(', ')}`);
	console.log(`  textureStateIds: ${mat.textureStateImports.map(i => i.id.toString(16)).join(', ')}`);
}

// --- MaterialState resource bytes ---
console.log('\n=== Linked MaterialState resources (type 0x0F) ===');
for (const r of vehBundle.resources) {
	if (r.resourceTypeId !== MATERIAL_STATE_TYPE_ID) continue;
	const id = ridToBig(r.resourceId);
	if (!materialStateIds.has(id)) continue;
	const raw = extractResourceRaw(vehBytes.buffer, vehBundle, r);
	console.log(`\n--- materialState ${id.toString(16).padStart(16, '0')} (size ${raw.byteLength}) ---`);
	const hex: string[] = [];
	for (let i = 0; i < raw.byteLength; i++) hex.push(raw[i].toString(16).padStart(2, '0'));
	console.log('  ' + hex.join(' '));

	// D3DRS pairs: a common layout is a table of (u32 id, u32 value) pairs.
	// Dump any field that looks like a known D3DRS constant.
	console.log('  u32 pairs:');
	for (let i = 0; i + 8 <= raw.byteLength; i += 4) {
		const id_ = readU32(raw, i);
		const val = i + 8 <= raw.byteLength ? readU32(raw, i + 4) : 0;
		// D3DRS IDs we care about:
		//   D3DRS_ZWRITEENABLE       =  14
		//   D3DRS_ALPHATESTENABLE    =  15
		//   D3DRS_SRCBLEND           =  19
		//   D3DRS_DESTBLEND          =  20
		//   D3DRS_CULLMODE           =  22
		//   D3DRS_ZENABLE            =   7
		//   D3DRS_ALPHABLENDENABLE   =  27
		//   D3DRS_ALPHAREF           =  24
		//   D3DRS_ALPHAFUNC          =  25
		if (id_ < 210 && id_ > 0 && id_ !== 0x3F800000) {
			console.log(`    +0x${i.toString(16).padStart(2, '0')}  D3DRS?${id_}  val=${val}  (f=${new DataView(raw.buffer, raw.byteOffset + i + 4, 4).getFloat32(0, true).toFixed(3)})`);
		}
	}
}

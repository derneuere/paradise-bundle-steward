// Quick probe: list every shader name in a SHADERS.BNDL so we can find
// particular shaders (e.g. the green glass tint) without hex diving.
import * as fs from 'node:fs';
import { parseBundle } from '../src/lib/core/bundle';
import { extractResourceRaw } from '../src/lib/core/registry';
import { parseShaderData, SHADER_TYPE_ID } from '../src/lib/core/shader';
import { u64ToBigInt } from '../src/lib/core/u64';

const bundlePath = process.argv[2] ?? 'example/SHADERS.BNDL';
const raw = fs.readFileSync(bundlePath);
const bytes = new Uint8Array(raw.byteLength);
bytes.set(raw);
const bundle = parseBundle(bytes.buffer);

const rows: { idx: number; id: string; name: string; techniques: number; constants: number; size: number }[] = [];
for (let i = 0; i < bundle.resources.length; i++) {
	const r = bundle.resources[i];
	if (r.resourceTypeId !== SHADER_TYPE_ID) continue;
	const raw = extractResourceRaw(bytes.buffer, bundle, r);
	const parsed = parseShaderData(raw);
	rows.push({
		idx: i,
		id: u64ToBigInt(r.resourceId as unknown as { low: number; high: number }).toString(16).padStart(16, '0'),
		name: parsed.name,
		techniques: parsed.numTechniques,
		constants: parsed.numConstants,
		size: raw.byteLength,
	});
}

const filter = process.argv[3];
const filtered = filter ? rows.filter(r => r.name.toLowerCase().includes(filter.toLowerCase())) : rows;

for (const r of filtered) {
	console.log(`[${String(r.idx).padStart(3, ' ')}] id=${r.id} tech=${r.techniques} const=${r.constants} size=${String(r.size).padStart(4, ' ')}  ${r.name}`);
}
console.log(`---\n${filtered.length} / ${rows.length} shaders`);

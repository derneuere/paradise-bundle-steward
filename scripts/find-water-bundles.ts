// Scan every bundle in example/ for resources whose debug name suggests
// they're related to water rendering (wave normal maps, river floor,
// reflection probes, etc.). Useful for finding which TRK_UNIT*.BNDL the
// shader preview should load alongside SHADERS.BNDL to bind real textures.
//
// Usage: npx tsx scripts/find-water-bundles.ts [pattern]
//   default pattern: water|wave|river|reflect|sea|ocean|liquid
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBundle } from '../src/lib/core/bundle';
import { parseDebugDataFromXml } from '../src/lib/core/bundle/debugData';

const dir = 'example';
const patternArg = process.argv[2] ?? 'water|wave|river|reflect|sea|ocean|liquid';
const re = new RegExp(patternArg, 'i');

const files = fs.readdirSync(dir)
	.filter((f) => /\.(BNDL|BIN|DAT)$/i.test(f))
	.sort();

type Hit = { bundle: string; name: string; typeId: number; typeName: string };
const hits: Hit[] = [];
const bundleHitCounts = new Map<string, number>();

for (const f of files) {
	const full = path.join(dir, f);
	let buf: Uint8Array;
	try {
		buf = fs.readFileSync(full);
	} catch { continue; }
	let bundle;
	try {
		bundle = parseBundle(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
	} catch { continue; }
	if (!bundle.debugData) continue;
	let dbg;
	try {
		dbg = parseDebugDataFromXml(bundle.debugData);
	} catch { continue; }

	let count = 0;
	for (const r of dbg) {
		if (re.test(r.name)) {
			hits.push({ bundle: f, name: r.name, typeId: 0, typeName: r.typeName });
			count++;
		}
	}
	if (count > 0) bundleHitCounts.set(f, count);
}

// Print bundle summary, then sample names per bundle.
console.log(`\nBundles with matches (pattern: ${patternArg}):`);
const sorted = Array.from(bundleHitCounts.entries()).sort((a, b) => b[1] - a[1]);
for (const [b, n] of sorted) {
	console.log(`  ${n.toString().padStart(4)}  ${b}`);
}

console.log(`\nSample matches (first 40):`);
for (const h of hits.slice(0, 40)) {
	console.log(`  ${h.bundle.padEnd(30)} ${h.typeName.padEnd(18)} ${h.name}`);
}
console.log(`\nTotal: ${hits.length} matches in ${bundleHitCounts.size} / ${files.length} bundles`);

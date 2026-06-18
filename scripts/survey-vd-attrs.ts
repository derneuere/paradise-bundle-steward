// Survey VertexDescriptor (0xA) attribute types across a bundle — to learn
// which meshes carry BoneIndexes(13)/BoneWeights(14) skinning attributes.
//
// Run: fnm exec --using=22 node node_modules/tsx/dist/cli.mjs scripts/survey-vd-attrs.ts example/VEH_CARBB1GT_GR.BIN

import { readFileSync } from 'node:fs';
import { parseBundle } from '../src/lib/core/bundle/index';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { parseVertexDescriptor } from '../src/lib/core/renderable';

const ATTR_NAMES: Record<number, string> = {
	1: 'Positions', 3: 'Normals', 5: 'UV1', 6: 'UV2', 7: 'Tangents',
	13: 'BoneIndexes', 14: 'BoneWeights',
};

const path = process.argv[2] ?? 'example/VEH_CARBB1GT_GR.BIN';
const buf = readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bundle = parseBundle(ab);
const VD_TYPE = 0xa;

const typeCount = new Map<number, number>();
let vds = 0, withBones = 0;
for (const r of bundle.resources.filter((x) => x.resourceTypeId === VD_TYPE)) {
	let vd;
	try { vd = parseVertexDescriptor(getResourceBlocks(ab, bundle, r)[0]); } catch { continue; }
	vds++;
	const types = new Set(vd.attributes.map((a) => a.type));
	for (const t of types) typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
	if (types.has(13) || types.has(14)) withBones++;
}
console.log(`bundle=${path}  VertexDescriptors=${vds}  with-bone-attrs=${withBones}`);
console.log('attribute type -> # of VDs that use it:');
for (const [t, n] of [...typeCount].sort((a, b) => b[1] - a[1])) {
	console.log(`  ${String(t).padStart(3)} ${(ATTR_NAMES[t] ?? '?').padEnd(14)} ${n}`);
}

import * as fs from 'node:fs';
import { parseBundle } from '../src/lib/core/bundle';
import { parseDebugDataFromXml } from '../src/lib/core/bundle/debugData';
const buf = fs.readFileSync('example/VEH_CARBRWDS_GR.BIN');
const bundle = parseBundle(buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength));
console.log('Total resources:', bundle.resources.length);
const types = new Map();
for (const r of bundle.resources) types.set(r.resourceTypeId, (types.get(r.resourceTypeId) ?? 0) + 1);
console.log('Type histogram:', Object.fromEntries([...types].map(([k,v]) => [`0x${k.toString(16)}`, v])));
if (bundle.debugData) {
  const dbg = parseDebugDataFromXml(bundle.debugData);
  const sample = dbg.slice(0, 15).map(r => `[${r.typeName}] ${r.name}`);
  console.log('First 15 named resources:'); for (const s of sample) console.log(' ', s);
  // Find any Texture (type 0)
  const types2 = new Map();
  for (const d of dbg) types2.set(d.typeName, (types2.get(d.typeName) ?? 0) + 1);
  console.log('TypeName histogram:', Object.fromEntries(types2));
}

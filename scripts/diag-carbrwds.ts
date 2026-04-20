import * as fs from 'node:fs';
import { parseBundle, getImportIds } from '../src/lib/core/bundle';
import { extractResourceRaw } from '../src/lib/core/registry/extract';
import { parseMaterialData } from '../src/lib/core/material';
import { decodeTextureState, TEXTURE_STATE_TYPE_ID } from '../src/lib/core/textureState';
import { TEXTURE_TYPE_ID } from '../src/lib/core/texture';
import { parseDebugDataFromXml, findDebugResourceById } from '../src/lib/core/bundle/debugData';
import { formatResourceId } from '../src/lib/core/bundle';
import { u64ToBigInt } from '../src/lib/core/u64';
import { getResourceBlocks } from '../src/lib/core/resourceManager';

const buf = fs.readFileSync('example/VEH_CARBRWDS_GR.BIN');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bundle = parseBundle(ab);
const dbg = bundle.debugData ? parseDebugDataFromXml(bundle.debugData) : [];

// Same for VEHICLETEX
const buf2 = fs.readFileSync('example/VEHICLETEX.BIN');
const ab2 = buf2.buffer.slice(buf2.byteOffset, buf2.byteOffset + buf2.byteLength);
const bundle2 = parseBundle(ab2);
const dbg2 = bundle2.debugData ? parseDebugDataFromXml(bundle2.debugData) : [];

console.log('Materials in CARBRWDS:');
for (const r of bundle.resources) {
  if (r.resourceTypeId !== 0x01) continue;
  const id = formatResourceId(u64ToBigInt(r.resourceId));
  const matName = findDebugResourceById(dbg, id)?.name ?? id;
  if (!/BodyParts|PaintGloss|CarbonFibre|Metal|CarGuts/i.test(matName)) continue;
  const blocks = getResourceBlocks(ab, bundle, r);
  const block0 = blocks[0]; if (!block0) continue;
  const parsed = parseMaterialData(block0);
  const shaderName = findDebugResourceById(dbg, formatResourceId(parsed.shaderImport.id))?.name ?? `unknown-${parsed.shaderImport.id.toString(16)}`;
  console.log(`\n  [${matName}]`);
  console.log(`    shader: ${shaderName}`);
  console.log(`    textureStates (${parsed.textureStateImports.length}):`);
  // For each textureState, resolve its Texture
  parsed.textureStateImports.forEach((ti, i) => {
    const tsId = formatResourceId(ti.id);
    const tsName = findDebugResourceById(dbg, tsId)?.name ?? findDebugResourceById(dbg2, tsId)?.name ?? '?';
    // Find TS resource and decode to get texture id
    let texInfo = '(can\'t resolve)';
    for (const [src, b, bA] of [['CARBRWDS', bundle, ab], ['VEHICLETEX', bundle2, ab2]] as const) {
      const tsRes = b.resources.find(rr => rr.resourceTypeId === TEXTURE_STATE_TYPE_ID && u64ToBigInt(rr.resourceId) === ti.id);
      if (tsRes) {
        try {
          const ts = decodeTextureState(bA, b, tsRes);
          if (ts.textureId) {
            const tId = formatResourceId(ts.textureId);
            const tName = findDebugResourceById(dbg, tId)?.name ?? findDebugResourceById(dbg2, tId)?.name ?? `(not in CARBRWDS or VEHICLETEX)`;
            texInfo = `tex=${tName}`;
          }
        } catch {}
        break;
      }
    }
    console.log(`      [${i}] ${tsName.slice(0, 80)} → ${texInfo.slice(0, 100)}`);
  });
}

import { readFileSync } from 'node:fs';
import { parseBundle, getImportIds } from '../src/lib/core/bundle/index';
import { SHADER_TYPE_ID, SHADER_PROGRAM_BUFFER_TYPE_ID, parseShaderData } from '../src/lib/core/shader';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { translateDxbc } from '../src/lib/core/dxbc';
import { u64ToBigInt } from '../src/lib/core/u64';
import type { ResourceEntry } from '../src/lib/core/types';
const buf = readFileSync('example/SHADERS.BNDL');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const bundle = parseBundle(ab);
const want = process.argv[2] ?? 'Opaque_Metal_Textured';
for (let i=0;i<bundle.resources.length;i++){ const r=bundle.resources[i]; if(r.resourceTypeId!==SHADER_TYPE_ID)continue;
  let s; try{s=parseShaderData(getResourceBlocks(ab,bundle,r as ResourceEntry)[0]!);}catch{continue;}
  if(s.name!=='Vehicle_'+want && !s.name.endsWith(want))continue;
  const ids=getImportIds(bundle.imports,bundle.resources,i); let vs:any=null;
  for(const id of ids){const t=bundle.resources.find(rr=>u64ToBigInt(rr.resourceId)===id&&rr.resourceTypeId===SHADER_PROGRAM_BUFFER_TYPE_ID);if(!t)continue;const bc=getResourceBlocks(ab,bundle,t as ResourceEntry)[1];if(!bc)continue;try{const tr=translateDxbc(bc);if(tr.parsed.programType==='vertex'){vs=tr;break}}catch{}}
  if(!vs)break;
  console.log('=== VS '+s.name+' ===');
  console.log(vs.source);
  break;
}

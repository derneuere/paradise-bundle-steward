import { readFileSync } from 'node:fs';
import { parseBundle, getImportIds } from '../src/lib/core/bundle/index';
import { extractResourceRaw } from '../src/lib/core/registry';
import { parseShaderData, SHADER_TYPE_ID } from '../src/lib/core/shader';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { translateDxbc } from '../src/lib/core/dxbc';
import { u64ToBigInt } from '../src/lib/core/u64';
const PB=0x12;
const buf=readFileSync('example/SHADERS.BNDL');
const ab=buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
const bundle=parseBundle(ab);
for (let i=0;i<bundle.resources.length;i++){
  const r=bundle.resources[i]; if(r.resourceTypeId!==SHADER_TYPE_ID) continue;
  const raw=extractResourceRaw(ab,bundle,r); const parsed=parseShaderData(raw);
  if(!parsed.name.toLowerCase().includes('water_specular')) continue;
  const ids=getImportIds(bundle.imports,bundle.resources,i);
  for(let n=0;n<ids.length;n++){
    const t=bundle.resources.find((rr)=>u64ToBigInt(rr.resourceId)===ids[n]&&rr.resourceTypeId===PB); if(!t)continue;
    const blocks=getResourceBlocks(ab,bundle,t); const bc=blocks[1]; if(!bc)continue;
    try{
      const tr=translateDxbc(bc);
      console.log(`-- import [${n}] ${tr.programLabel} --`);
      for(const cb of tr.parsed.reflection.constantBuffers){
        for(const v of cb.variables){
          console.log(`  cb0[${Math.floor(v.startOffset/16)}] (offset ${v.startOffset}, size ${v.size}) = ${v.name}`);
        }
      }
    }catch(e){console.log('err',e);}
  }
}

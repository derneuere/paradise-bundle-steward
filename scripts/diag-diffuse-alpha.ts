import { readFileSync } from 'node:fs';
import { parseBundle } from '../src/lib/core/bundle/index';
import { parseDebugDataFromBuffer, parseDebugDataFromXml } from '../src/lib/core/bundle/debugData';
import { MATERIAL_TYPE_ID, parseMaterialData } from '../src/lib/core/material';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { u64ToBigInt } from '../src/lib/core/u64';
import { decodeAllRenderables } from '../src/lib/core/renderableDecode';
import type { ResourceEntry } from '../src/lib/core/types';
const load=(p:string)=>{const b=readFileSync(p);const ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;return {ab,bundle:parseBundle(ab)};};
const gr=load('example/VEH_CARBB1GT_GR.BIN'); const tex=load('example/VEHICLETEX.BIN'); const sh=load('example/SHADERS.BNDL');
let dbg:any[]=[]; try{const xml=parseDebugDataFromBuffer(gr.ab, gr.bundle.header); if(xml) dbg=parseDebugDataFromXml(xml);}catch{}
const norm=(s:string)=>s.toLowerCase().replace(/^0x/,'').replace(/^0+(?=.)/,''); const dn=new Map<string,string>(); for(const d of dbg) if(d.id&&d.name) dn.set(norm(d.id), d.name);
const dec=decodeAllRenderables(gr.ab, gr.bundle, dn, false, 'graphics', [{buffer:tex.ab,bundle:tex.bundle},{buffer:sh.ab,bundle:sh.bundle}], null);
const seen=new Set<string>();
for(const r of dec.renderables){
  for(const m of r.meshes){
    const rm=m.resolvedMaterial; if(!rm||!rm.diffuse) continue;
    const key=(rm.shaderName||'')+'/'+rm.diffuse.header.width+'x'+rm.diffuse.header.height; if(seen.has(key))continue; seen.add(key);
    const px=rm.diffuse.pixels; let aMin=255,aMax=0,aSum=0,n=0,rgbSum=0;
    for(let i=0;i<px.length;i+=4*97){ const a=px[i+3]; aMin=Math.min(aMin,a);aMax=Math.max(aMax,a);aSum+=a; rgbSum+=px[i]+px[i+1]+px[i+2]; n++; }
    console.log((rm.shaderName||'?').padEnd(42), rm.diffuse.header.format.padEnd(6), rm.diffuse.header.width+'x'+rm.diffuse.header.height, 'alpha min/avg/max='+aMin+'/'+Math.round(aSum/n)+'/'+aMax, 'rgbAvg='+Math.round(rgbSum/n/3));
    if(seen.size>=10) break;
  }
  if(seen.size>=10) break;
}

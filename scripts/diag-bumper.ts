// Compare the two texture-resolution paths for the front-bumper material:
//   PBR  -> resolveMaterialTextures (materialChain.ts)
//   translated -> buildMaterialIndex (materialBinding.ts) + the shader's PS regs
import { readFileSync } from 'node:fs';
import { parseBundle, getImportIds, formatResourceId } from '../src/lib/core/bundle/index';
import { parseDebugDataFromBuffer, parseDebugDataFromXml } from '../src/lib/core/bundle/debugData';
import { SHADER_TYPE_ID, SHADER_PROGRAM_BUFFER_TYPE_ID, parseShaderData } from '../src/lib/core/shader';
import { MATERIAL_TYPE_ID, parseMaterialData } from '../src/lib/core/material';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { translateDxbc } from '../src/lib/core/dxbc';
import { u64ToBigInt } from '../src/lib/core/u64';
import { decodeAllRenderables } from '../src/lib/core/renderableDecode';
import { resolveMaterialTextures } from '../src/lib/core/materialChain';
import { buildTextureCatalog } from '../src/lib/core/textureCatalog';
import { buildMaterialIndex, pickBestMaterial } from '../src/lib/core/materialBinding';
import type { ResourceEntry } from '../src/lib/core/types';

const load=(p:string)=>{const b=readFileSync(p);const ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;return {ab,bundle:parseBundle(ab)};};
const gr=load('example/VEH_CARBB1GT_GR.BIN'); const tex=load('example/VEHICLETEX.BIN'); const sh=load('example/SHADERS.BNDL');
const shName=new Map<string,string>();
for(let i=0;i<sh.bundle.resources.length;i++){const r=sh.bundle.resources[i];if(r.resourceTypeId!==SHADER_TYPE_ID)continue;try{shName.set(u64ToBigInt(r.resourceId).toString(16),parseShaderData(getResourceBlocks(sh.ab,sh.bundle,r as ResourceEntry)[0]!).name);}catch{}}
let dbg:any[]=[]; try{const xml=parseDebugDataFromBuffer(gr.ab,gr.bundle.header); if(xml)dbg=parseDebugDataFromXml(xml);}catch{}
const norm=(s:string)=>s.toLowerCase().replace(/^0x/,'').replace(/^0+(?=.)/,''); const dn=new Map<string,string>(); for(const d of dbg) if(d.id&&d.name) dn.set(norm(d.id),d.name);

const srcs=[{source:'primary',bundle:gr.bundle,arrayBuffer:gr.ab,debug:dbg},{source:'tex',bundle:tex.bundle,arrayBuffer:tex.ab,debug:[]},{source:'sh',bundle:sh.bundle,arrayBuffer:sh.ab,debug:[]}];
const cat=buildTextureCatalog(srcs as any); const matIdx=buildMaterialIndex(srcs as any, cat);
const dec=decodeAllRenderables(gr.ab,gr.bundle,dn,false,'graphics',[{buffer:tex.ab,bundle:tex.bundle},{buffer:sh.ab,bundle:sh.bundle}],null);
const shaderRegs=(sid:bigint)=>{ for(let i=0;i<sh.bundle.resources.length;i++){const r=sh.bundle.resources[i];if(r.resourceTypeId!==SHADER_TYPE_ID||u64ToBigInt(r.resourceId)!==sid)continue; const ids=getImportIds(sh.bundle.imports,sh.bundle.resources,i); for(const id of ids){const t=sh.bundle.resources.find(rr=>u64ToBigInt(rr.resourceId)===id&&rr.resourceTypeId===SHADER_PROGRAM_BUFFER_TYPE_ID);if(!t)continue;const bc=getResourceBlocks(sh.ab,sh.bundle,t as ResourceEntry)[1];if(!bc)continue;try{const tr=translateDxbc(bc);if(tr.parsed.programType==='pixel') return [...tr.source.matchAll(/uniform sampler2D ([A-Za-z0-9_]+);\s*\/\/\s*t(\d+)/g)].map(m=>`t${m[2]}:${m[1]}`);}catch{}}} return []; };
const cache=new Map<bigint,any>();
for(const r of dec.renderables){
  if(!/BumperFront/i.test(r.debugName||'')) continue;
  console.log('RENDERABLE', r.debugName, 'meshes='+r.meshes.length);
  for(const m of r.meshes){
    const matId=m.materialAssemblyId; if(!matId)continue;
    const matHex=formatResourceId(matId);
    const matRes=gr.bundle.resources.find(x=>x.resourceTypeId===MATERIAL_TYPE_ID&&u64ToBigInt(x.resourceId)===matId);
    let shaderId:bigint|null=null; if(matRes){try{shaderId=parseMaterialData(getResourceBlocks(gr.ab,gr.bundle,matRes as ResourceEntry)[0]!).shaderImport.id;}catch{}}
    const sName=shaderId?shName.get(shaderId.toString(16)):'?';
    console.log('  mat',matHex,'shader',sName);
    console.log('    PS regs:', shaderId?shaderRegs(shaderId).join('  '):'-');
    // PBR path
    const pbr=resolveMaterialTextures(gr.ab,gr.bundle,matId,cache,[{buffer:tex.ab,bundle:tex.bundle},{buffer:sh.ab,bundle:sh.bundle}],null);
    console.log('    PBR resolveMaterialTextures: diffuse='+(pbr?.diffuse?pbr.diffuse.header.width+'x'+pbr.diffuse.header.height:'NONE')+' normal='+(pbr?.normal?'y':'-')+' specular='+(pbr?.specular?'y':'-')+' crossMiss='+pbr?.crossBundleMisses);
    // translated path
    const sHex=shaderId?formatResourceId(shaderId):""; const b=matIdx.get(sHex)?.find(x=>x.materialId===matHex)??(shaderId?pickBestMaterial(sHex,[],matIdx):null);
    console.log('    translated buildMaterialIndex bindings:', b?[...b.samplerBindings.keys()].sort((a,c)=>a-c).map(k=>'ch'+k+'→'+b.samplerBindings.get(k)!.id).join('  '):'NO BINDING');
  }
}

// Classify how each shader computes gl_Position: which cb0 slot feeds o0.x and
// whether via the MAD pattern (pos.x*cb0[N]+... → needs COLUMNS) or the DOT
// pattern (dot(v, cb0[N]) → needs ROWS). Finds shaders NOT using the
// world@W + ViewProjectionModified scheme (those still mislocate after the
// world-columns fix).
import { readFileSync } from 'node:fs';
import { parseBundle, getImportIds } from '../src/lib/core/bundle/index';
import { SHADER_TYPE_ID, SHADER_PROGRAM_BUFFER_TYPE_ID, parseShaderData } from '../src/lib/core/shader';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { translateDxbc } from '../src/lib/core/dxbc';
import { u64ToBigInt } from '../src/lib/core/u64';
import type { ResourceEntry } from '../src/lib/core/types';
const buf = readFileSync(process.argv[2] ?? 'example/SHADERS.BNDL');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const bundle = parseBundle(ab);
const tally = new Map<string, number>();
const examples = new Map<string, string>();
for (let i=0;i<bundle.resources.length;i++){ const r=bundle.resources[i]; if(r.resourceTypeId!==SHADER_TYPE_ID)continue;
  let s; try{s=parseShaderData(getResourceBlocks(ab,bundle,r as ResourceEntry)[0]!);}catch{continue;}
  if(!s.name.startsWith('Vehicle'))continue;
  const ids=getImportIds(bundle.imports,bundle.resources,i); let vs:any=null;
  for(const id of ids){const t=bundle.resources.find(rr=>u64ToBigInt(rr.resourceId)===id&&rr.resourceTypeId===SHADER_PROGRAM_BUFFER_TYPE_ID);if(!t)continue;const bc=getResourceBlocks(ab,bundle,t as ResourceEntry)[1];if(!bc)continue;try{const tr=translateDxbc(bc);if(tr.parsed.programType==='vertex'){vs=tr;break}}catch{}}
  if(!vs)continue;
  // name slots by reflection
  const names = new Map<number,string>();
  for(const cb of vs.parsed.reflection.constantBuffers) for(const v of cb.variables){ const start=Math.floor(v.startOffset/16), end=Math.floor((v.startOffset+v.size-1)/16); for(let sl=start;sl<=end;sl++) names.set(sl, v.name); }
  const src: string = vs.source;
  const lines = src.split('\n');
  const oline = lines.find(l=>/o0\.x\s*=/.test(l)) || lines.find(l=>/o0\.xy/.test(l)) || '';
  // which slot in the o0.x line
  const m = oline.match(/cb0\[(\d+)\]/);
  const slot = m ? Number(m[1]) : -1;
  const slotName = names.get(slot) ?? ('cb0['+slot+']');
  const pattern = /dot\(/.test(oline) ? 'dot' : (/\*\s*cb0\[/.test(oline) ? 'mad' : '?');
  const key = `clipVia=${slotName} (${pattern})`;
  tally.set(key, (tally.get(key)??0)+1);
  if(!examples.has(key)) examples.set(key, s.name);
}
console.log('=== gl_Position scheme tally (vehicle shaders) ===');
for(const [k,n] of [...tally].sort((a,b)=>b[1]-a[1])) console.log(`  ${n.toString().padStart(3)}  ${k}   e.g. ${examples.get(k)}`);

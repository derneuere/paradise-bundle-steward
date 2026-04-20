// Pick one ShaderProgramBuffer out of SHADERS.BNDL, parse+translate it,
// and print the emitted GLSL. Quick feedback loop while the translator
// is still maturing.

import { readFileSync } from 'node:fs';
import { parseBundle } from '../src/lib/core/bundle/index';
import { resourceCtxFromBundle } from '../src/lib/core/registry';
import { getResourceBlocks } from '../src/lib/core/resourceManager';
import { translateDxbc } from '../src/lib/core/dxbc';

const [indexArg] = process.argv.slice(2);
const idx = Number(indexArg ?? '0');

const buf = readFileSync('example/SHADERS.BNDL');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bundle = parseBundle(ab);
void resourceCtxFromBundle(bundle);
const pbs = bundle.resources.filter((r) => r.resourceTypeId === 0x12);
if (idx < 0 || idx >= pbs.length) { console.error('bad index'); process.exit(1); }
const blocks = getResourceBlocks(ab, bundle, pbs[idx]);
const bytecode = blocks[1];
if (!bytecode) { console.error('no bytecode block'); process.exit(1); }

const result = translateDxbc(bytecode);
console.log('--- summary ---');
console.log(result.summary);
console.log('unsupported ops:', result.unsupported.length ? result.unsupported.join(', ') : '(none)');
console.log('');
console.log('--- GLSL ---');
console.log(result.source);

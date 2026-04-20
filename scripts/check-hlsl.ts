import { readFileSync } from 'node:fs';
import { parseBundle } from '../src/lib/core/bundle/index';
import { extractResourceRaw, getHandlerByKey, resourceCtxFromBundle } from '../src/lib/core/registry';
import type { ParsedShader } from '../src/lib/core/shader';

const buf = readFileSync('example/SHADERS.BNDL');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bundle = parseBundle(ab);
const handler = getHandlerByKey('shader')!;
const ctx = resourceCtxFromBundle(bundle);
const matches = bundle.resources.filter((r) => r.resourceTypeId === handler.typeId);
let withInline = 0;
let sampleName = '';
let sampleSrc = '';
for (const r of matches) {
	const raw = extractResourceRaw(ab, bundle, r);
	const m = handler.parseRaw(raw, ctx) as ParsedShader;
	if (m.hasInlineHLSL) {
		withInline++;
		if (!sampleName) { sampleName = m.name; sampleSrc = m.hlslSource.slice(0, 500); }
	}
}
console.log('total shaders:', matches.length);
console.log('with inline HLSL:', withInline);
console.log('sample name:', sampleName);
if (sampleSrc) { console.log('sample source head:\n' + sampleSrc); }

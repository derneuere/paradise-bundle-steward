import { readFileSync } from 'node:fs';
import { parseBundle } from '../src/lib/core/bundle/index';
import {
	getHandlerByKey,
	resourceCtxFromBundle,
} from '../src/lib/core/registry';
import { getResourceBlocks } from '../src/lib/core/resourceManager';

const buf = readFileSync('example/SHADERS.BNDL');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bundle = parseBundle(ab);
const handler = getHandlerByKey('shaderProgramBuffer')!;
const ctx = resourceCtxFromBundle(bundle);
const matches = bundle.resources.filter((r) => r.resourceTypeId === handler.typeId);

for (let i = 0; i < 5; i++) {
	const blocks = getResourceBlocks(ab, bundle, matches[i]);
	console.log(`\n=== pb ${i} blocks: [${blocks.map((b) => b ? b.byteLength : 'null').join(', ')}] ===`);
	// Try each non-null block for DXBC presence
	for (let bi = 0; bi < blocks.length; bi++) {
		const b = blocks[bi];
		if (!b) continue;
		let off = -1;
		for (let j = 0; j + 4 <= b.byteLength; j++) {
			if (b[j] === 0x44 && b[j+1] === 0x58 && b[j+2] === 0x42 && b[j+3] === 0x43) {
				off = j; break;
			}
		}
		console.log(`  block ${bi}: ${b.byteLength} bytes, DXBC magic @ ${off >= 0 ? '0x' + off.toString(16) : 'not found'}`);
	}
	// Pick the first non-null block for the old peek output
	const raw = blocks.find((b) => b != null)!;
	console.log(`\n--- program buffer ${i} (${raw.byteLength} bytes) ---`);
	const head = Array.from(raw.slice(0, 96)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
	console.log('first 96 bytes hex:');
	console.log(head);
	console.log('ascii:');
	console.log(Array.from(raw.slice(0, 96)).map((b) => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join(''));
	// Scan for DXBC magic anywhere
	let off = -1;
	for (let j = 0; j + 4 <= raw.byteLength; j++) {
		if (raw[j] === 0x44 && raw[j+1] === 0x58 && raw[j+2] === 0x42 && raw[j+3] === 0x43) {
			off = j; break;
		}
	}
	console.log('DXBC magic offset:', off);
	// Also scan for common signatures
	const sigs = ['DXBC', 'SPV\0', 'GXPC', 'GCGL', 'GFXP', 'RSH\0', 'CSG1'];
	for (const s of sigs) {
		const bytes = s.split('').map((c) => c.charCodeAt(0));
		let f = -1;
		outer: for (let j = 0; j + bytes.length <= raw.byteLength; j++) {
			for (let k = 0; k < bytes.length; k++) if (raw[j+k] !== bytes[k]) continue outer;
			f = j; break;
		}
		if (f >= 0) console.log(`  found "${s}" @ 0x${f.toString(16)}`);
	}
}

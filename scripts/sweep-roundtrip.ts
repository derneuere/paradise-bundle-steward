// Sweep every resource of a given handler key in a bundle and assert
// byte-exact + idempotent round-trip on each one. Used as a smoke test
// for newly added handlers. Exits non-zero on any failure.
//
// Usage: npx bun run scripts/sweep-roundtrip.ts <bundle> <handler-key>

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseBundle } from '../src/lib/core/bundle/index';
import {
	getHandlerByKey,
	extractResourceRaw,
	resourceCtxFromBundle,
} from '../src/lib/core/registry';

const sha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const [bundlePath, key] = process.argv.slice(2);
if (!bundlePath || !key) {
	console.error('Usage: sweep-roundtrip <bundle> <handler-key>');
	process.exit(2);
}
const handler = getHandlerByKey(key);
if (!handler) { console.error(`No handler "${key}"`); process.exit(2); }
if (!handler.caps.write) { console.error(`Handler ${key} is read-only`); process.exit(2); }

const buf = readFileSync(bundlePath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bundle = parseBundle(ab);
const ctx = resourceCtxFromBundle(bundle);
const targets = bundle.resources.filter((r) => r.resourceTypeId === handler.typeId);

let okExact = 0;
let okIdempotent = 0;
let failed = 0;
const failures: string[] = [];

for (let i = 0; i < targets.length; i++) {
	const r = targets[i];
	try {
		const raw = extractResourceRaw(ab, bundle, r);
		const m1 = handler.parseRaw(raw, ctx);
		const w1 = handler.writeRaw!(m1, ctx);
		const m2 = handler.parseRaw(w1, ctx);
		const w2 = handler.writeRaw!(m2, ctx);
		if (!bytesEq(w1, w2)) {
			failed++;
			failures.push(`[${i}] not idempotent: w1=${sha1(w1)} w2=${sha1(w2)}`);
			continue;
		}
		if (bytesEq(w1, raw)) okExact++;
		else {
			okIdempotent++;
			if (failures.length < 5) failures.push(`[${i}] not byte-exact (idempotent ok): raw=${sha1(raw)} w1=${sha1(w1)}`);
		}
	} catch (e) {
		failed++;
		failures.push(`[${i}] threw: ${(e as Error).message}`);
	}
}

console.log(`\n${bundlePath} : ${handler.name} sweep`);
console.log(`  total:        ${targets.length}`);
console.log(`  byte-exact:   ${okExact}`);
console.log(`  idempotent:   ${okIdempotent}`);
console.log(`  failed:       ${failed}`);
if (failures.length > 0) {
	console.log(`  first ${Math.min(failures.length, 10)} notes:`);
	for (const f of failures.slice(0, 10)) console.log(`    ${f}`);
}
process.exit(failed > 0 ? 1 : 0);

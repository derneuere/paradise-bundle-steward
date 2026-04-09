// Auto-generated fixture suite. For every registered handler, for every
// fixture it declares, assert:
//   - parseRaw does not throw (when expect.parseOk !== false)
//   - writeRaw(parseRaw(raw)) === raw byte-for-byte (when expect.roundTripEqual)
//
// Adding a new handler + fixture to registry/index.ts automatically enrolls
// it in this suite; no edits to this file are needed.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../bundle';
import { registry, extractResourceRaw, resourceCtxFromBundle } from './index';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function loadBundle(repoRelativePath: string) {
	const abs = path.resolve(REPO_ROOT, repoRelativePath);
	const raw = fs.readFileSync(abs);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return { buffer: bytes.buffer as ArrayBuffer };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

for (const handler of registry) {
	describe(`${handler.name} [${handler.key}]`, () => {
		if (handler.fixtures.length === 0) {
			it.skip('has no registered fixtures', () => { /* placeholder */ });
			return;
		}
		for (const fixture of handler.fixtures) {
			describe(fixture.bundle, () => {
				const { buffer } = loadBundle(fixture.bundle);
				const bundle = parseBundle(buffer);
				const resource = bundle.resources.find((r) => r.resourceTypeId === handler.typeId);
				if (!resource) {
					it.fails(`bundle does not contain a resource of type 0x${handler.typeId.toString(16)}`, () => {
						throw new Error(`Fixture ${fixture.bundle} is missing handler.typeId`);
					});
					return;
				}
				const ctx = resourceCtxFromBundle(bundle);
				const raw = extractResourceRaw(buffer, bundle, resource);

				if (fixture.expect?.parseOk !== false) {
					it('parses without throwing', () => {
						expect(() => handler.parseRaw(raw, ctx)).not.toThrow();
					});
				}

				if (fixture.expect?.byteRoundTrip && handler.writeRaw) {
					it('write(parse(raw)) is byte-equal to raw', () => {
						const model = handler.parseRaw(raw, ctx);
						const rewritten = handler.writeRaw!(model, ctx);
						if (!bytesEqual(rewritten, raw)) {
							throw new Error(
								`byte mismatch: raw=${raw.byteLength} bytes sha1 ${sha1(raw)}, rewritten=${rewritten.byteLength} bytes sha1 ${sha1(rewritten)}`,
							);
						}
					});
				}

				if (fixture.expect?.stableWriter && handler.writeRaw) {
					it('writer is idempotent (write(parse(write(parse(raw)))) === write(parse(raw)))', () => {
						const first = handler.parseRaw(raw, ctx);
						const write1 = handler.writeRaw!(first, ctx);
						const second = handler.parseRaw(write1, ctx);
						const write2 = handler.writeRaw!(second, ctx);
						if (!bytesEqual(write1, write2)) {
							throw new Error(
								`writer not idempotent: write1 sha1 ${sha1(write1)} (${write1.byteLength} bytes), write2 sha1 ${sha1(write2)} (${write2.byteLength} bytes)`,
							);
						}
					});
				}
			});
		}
	});
}

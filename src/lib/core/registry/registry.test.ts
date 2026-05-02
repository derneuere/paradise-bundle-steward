// Auto-generated fixture suite. For every registered handler, for every
// fixture it declares, assert:
//   - parseRaw does not throw (when expect.parseOk !== false)
//   - writeRaw(parseRaw(raw)) === raw byte-for-byte (when expect.byteRoundTrip)
//   - writer is idempotent on a second pass (when expect.stableWriter)
//   - describe(model) returns a non-empty string (always — every handler
//     implements it and the bundle-cli depends on it)
//   - picker.labelOf / sortKeys / searchText behave as advertised when the
//     handler exposes a picker config
//   - every stressScenarios entry survives parse → mutate → write → parse
//     and the optional verify() reports no problems
//
// Adding a new handler + fixture to registry/index.ts automatically enrolls
// it in this suite; no edits to this file are needed.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../bundle';
import { registry, extractResourceRaw, resourceCtxFromBundle } from './index';
import type { PickerEntry, PickerResourceCtx } from './handler';

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

				// `describe()` is part of every handler's contract — the
				// bundle-cli `parse` subcommand prints it for every resource,
				// and the UI uses it for resource summaries. Cheap to call,
				// so always exercise it.
				if (fixture.expect?.parseOk !== false) {
					it('describe(model) returns a non-empty string', () => {
						const model = handler.parseRaw(raw, ctx);
						const summary = handler.describe(model);
						expect(typeof summary).toBe('string');
						expect(summary.length).toBeGreaterThan(0);
					});
				}

				// Picker config (only present on multi-resource handlers like
				// PolygonSoupList and Texture). Walk every advertised callback
				// to make sure they handle both populated and `null` models —
				// the picker UI passes `null` when a fixture entry failed to
				// parse, so labelOf must not throw on it.
				if (handler.picker && fixture.expect?.parseOk !== false) {
					it('picker config exercises labelOf / sortKeys / searchText', () => {
						const model = handler.parseRaw(raw, ctx);
						const picker = handler.picker!;
						const ctxA: PickerResourceCtx = {
							id: '0x0000000000000001',
							name: 'fixture_a',
							index: 0,
						};
						const ctxB: PickerResourceCtx = {
							id: '0x0000000000000002',
							name: 'fixture_b',
							index: 1,
						};

						// labelOf with both null and populated models — both
						// must produce a string `primary`.
						const labelEmpty = picker.labelOf(null, ctxA);
						expect(typeof labelEmpty.primary).toBe('string');
						const labelFull = picker.labelOf(model, ctxA);
						expect(typeof labelFull.primary).toBe('string');

						// sortKeys: every key produces a finite compare result
						// when given two synthesised entries, has a string
						// label, and `defaultSort` matches one of them.
						expect(picker.sortKeys.length).toBeGreaterThan(0);
						const entries: PickerEntry<unknown>[] = [
							{ model, ctx: ctxA },
							{ model, ctx: ctxB },
							// Include a null-model entry so compare functions
							// hit any "empty resource" branches.
							{ model: null, ctx: { ...ctxA, index: 2, name: 'fixture_c' } },
						];
						let sawDefault = false;
						for (const sk of picker.sortKeys) {
							if (sk.id === picker.defaultSort) sawDefault = true;
							expect(typeof sk.label).toBe('string');
							for (let i = 0; i < entries.length; i++) {
								for (let j = 0; j < entries.length; j++) {
									const r = sk.compare(entries[i], entries[j]);
									expect(Number.isFinite(r)).toBe(true);
								}
							}
						}
						expect(sawDefault).toBe(true);

						// searchText (when present) — same null/full coverage.
						if (picker.searchText) {
							expect(typeof picker.searchText(model, ctxA)).toBe('string');
							expect(typeof picker.searchText(null, ctxA)).toBe('string');
						}
					});
				}

				// Stress scenarios — pinned mutation cases the handler author
				// wants exercised on every CI run. We only run them when the
				// handler is writable AND this specific fixture advertises a
				// successful round-trip (byteRoundTrip or stableWriter). Some
				// fixtures parse fine but aren't writable — e.g., the B5
				// TrafficData prototype parses into the `kind: 'v22'` variant
				// of the discriminated union and the writer has no spec for
				// it, so it sets `parseOk: true` only and we must skip stress
				// on it.
				const fixtureIsWritable =
					!!(fixture.expect?.byteRoundTrip || fixture.expect?.stableWriter);
				if (
					handler.stressScenarios &&
					handler.stressScenarios.length > 0 &&
					handler.caps.write &&
					handler.writeRaw &&
					fixtureIsWritable
				) {
					for (const scenario of handler.stressScenarios) {
						it(`stress: ${scenario.name}`, () => {
							const baseModel = handler.parseRaw(raw, ctx);
							// Deep clone before passing to mutate — scenarios
							// are documented as "may mutate in place", so we
							// hand them a copy to keep test ordering safe.
							const cloned = structuredClone(baseModel);
							const afterMutate = scenario.mutate(cloned);
							const written = handler.writeRaw!(afterMutate, ctx);
							const afterReparse = handler.parseRaw(written, ctx);
							if (scenario.verify) {
								const problems = scenario.verify(afterMutate, afterReparse);
								if (problems.length > 0) {
									throw new Error(
										`scenario '${scenario.name}' verify failed: ${problems.join('; ')}`,
									);
								}
							}
						});
					}
				}
			});
		}
	});
}

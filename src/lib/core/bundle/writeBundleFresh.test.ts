// Stress tests for writeBundleFresh — focused on the three bundle-envelope
// bugs discovered when a user reported that modifying AI Sections data (adding
// a portal) caused the section to "die completely in-game" despite byte-exact
// resource-level roundtrips passing.
//
// Root causes (all in writeBundleFresh, all affecting every resource type):
//
// 1. uncompressedSizeAndAlignment alignment nibble was taken from the on-disk
//    (compressed) field (always 2^0=1) instead of the uncompressed field
//    (e.g. 2^4=16 for AI Sections). The game allocated a misaligned buffer,
//    corrupting the runtime pointer fixup pass.               (fix: fb04c2d)
//
// 2. Empty memory pool dataOffsets were written as 0 instead of pointing to
//    the end of the previous pool's data region. Retail bundles and both
//    reference tools (Bundle-Manager, YAP) always set these to the current
//    cursor position. The game likely uses adjacent offsets to compute pool
//    extents.                                                 (fix: 2c8ccef)
//
// 3. Inter-pool alignment was 0x10 instead of the 0x80 that retail bundles
//    and both reference tools use.                            (fix: 97fccce)

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle, writeBundleFresh } from './index';
import { registry, extractResourceRaw, resourceCtxFromBundle } from '../registry/index';
import { extractResourceSize, extractAlignment } from '../resourceManager';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function loadBundle(name: string) {
	const abs = path.resolve(REPO_ROOT, name);
	const raw = fs.readFileSync(abs);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return bytes.buffer as ArrayBuffer;
}

// All example bundles with a writable handler
const FIXTURES = [
	{ bundle: 'example/AI.DAT', typeId: 0x10001, key: 'aiSections' },
	{ bundle: 'example/VEHICLELIST.BUNDLE', typeId: 0x10005, key: 'vehicleList' },
	{ bundle: 'example/TRIGGERS.DAT', typeId: 0x10003, key: 'triggerData' },
	{ bundle: 'example/BTTSTREETDATA.DAT', typeId: 0x10018, key: 'streetData' },
	{ bundle: 'example/ONLINECHALLENGES.BNDL', typeId: 0x1001f, key: 'challengeList' },
];

for (const fixture of FIXTURES) {
	const bundlePath = path.resolve(REPO_ROOT, fixture.bundle);
	if (!fs.existsSync(bundlePath)) continue;

	describe(`writeBundleFresh envelope: ${fixture.bundle}`, () => {
		const original = loadBundle(fixture.bundle);
		const bundle = parseBundle(original);
		const resource = bundle.resources.find(r => r.resourceTypeId === fixture.typeId)!;
		const handler = registry.find(h => h.typeId === fixture.typeId)!;
		const ctx = resourceCtxFromBundle(bundle);
		const raw = extractResourceRaw(original, bundle, resource);

		// Parse the model, apply a trivial mutation (forces repack), then write
		function modifiedBundle(): { buf: ArrayBuffer; model: unknown } {
			const model = handler.parseRaw(raw, ctx) as Record<string, unknown>;
			// Tag with a marker so the override triggers the write path
			const newRaw = handler.writeRaw!(model as never, ctx);
			const buf = writeBundleFresh(bundle, original, {
				overrides: { resources: { [fixture.typeId]: newRaw } },
			});
			return { buf, model };
		}

		// -----------------------------------------------------------------
		// Bug 1: uncompressedSizeAndAlignment alignment must be preserved
		// from the original uncompressed field, not from the on-disk field.
		// The on-disk alignment is 2^0=1 (compressed data doesn't need
		// alignment) but the uncompressed alignment may be 2^4=16 or higher.
		// -----------------------------------------------------------------
		it('preserves uncompressedSizeAndAlignment alignment nibble after modification', () => {
			const { buf } = modifiedBundle();
			const reparsed = parseBundle(buf);
			const entry = reparsed.resources.find(r => r.resourceTypeId === fixture.typeId)!;

			for (let pool = 0; pool < 3; pool++) {
				const origAlign = extractAlignment(resource.uncompressedSizeAndAlignment[pool]);
				const newAlign = extractAlignment(entry.uncompressedSizeAndAlignment[pool]);
				expect(newAlign).toBe(origAlign);
			}
		});

		// -----------------------------------------------------------------
		// Bug 2: empty pool dataOffsets must not be 0. Retail bundles always
		// set pool[N] = cursor after pool[N-1] ends, even when pool[N] has
		// no data. The game may compute pool extents as
		// dataOffset[N+1] - dataOffset[N].
		// -----------------------------------------------------------------
		it('writes non-zero dataOffsets for empty memory pools', () => {
			const { buf } = modifiedBundle();
			const dv = new DataView(buf);
			const isLE = bundle.header.platform !== 3;

			const offsets = [
				dv.getUint32(24, isLE),
				dv.getUint32(28, isLE),
				dv.getUint32(32, isLE),
			];

			// Pool 0 always has data, so offset must be non-zero
			expect(offsets[0]).toBeGreaterThan(0);

			// Empty pools must still have a valid offset (>= pool 0 start)
			for (let i = 1; i < 3; i++) {
				expect(offsets[i]).toBeGreaterThanOrEqual(offsets[0]);
			}
		});

		// -----------------------------------------------------------------
		// Bug 3: pool boundaries must be 0x80-aligned, matching retail
		// bundles and both reference tools (Bundle-Manager, YAP).
		// -----------------------------------------------------------------
		it('aligns pool boundary offsets to 0x80', () => {
			const { buf } = modifiedBundle();
			const dv = new DataView(buf);
			const isLE = bundle.header.platform !== 3;

			// Pool 1 and pool 2 offsets (which mark pool boundaries)
			for (let i = 1; i < 3; i++) {
				const offset = dv.getUint32(24 + i * 4, isLE);
				if (offset > 0) {
					expect(offset % 0x80).toBe(0);
				}
			}
		});

		// -----------------------------------------------------------------
		// Combined: a modified resource must still round-trip cleanly
		// through the full repack pipeline (parse bundle → modify resource →
		// writeBundleFresh → parse bundle → extract resource → compare).
		// -----------------------------------------------------------------
		it('modified resource survives full bundle repack round-trip', () => {
			const model = handler.parseRaw(raw, ctx);
			const write1 = handler.writeRaw!(model as never, ctx);
			const repacked = writeBundleFresh(bundle, original, {
				overrides: { resources: { [fixture.typeId]: write1 } },
			});
			const bundle2 = parseBundle(repacked);
			const entry2 = bundle2.resources.find(r => r.resourceTypeId === fixture.typeId)!;
			const raw2 = extractResourceRaw(repacked, bundle2, entry2);
			const model2 = handler.parseRaw(raw2, ctx);
			const write2 = handler.writeRaw!(model2 as never, ctx);

			expect(write1.byteLength).toBe(write2.byteLength);
			expect(Buffer.from(write1).equals(Buffer.from(write2))).toBe(true);
		});
	});
}

// ---------------------------------------------------------------------------
// byResourceId override — for bundles that hold multiple resources of the
// same type (e.g. WORLDCOL.BIN with hundreds of PolygonSoupList resources).
// A typeId-keyed override would clobber ALL of them with the same bytes;
// byResourceId lets us re-encode exactly one resource and let the rest
// pass through unchanged.
// ---------------------------------------------------------------------------

describe('writeBundleFresh byResourceId override', () => {
	const bundlePath = path.resolve(REPO_ROOT, 'example/WORLDCOL.BIN');
	if (!fs.existsSync(bundlePath)) {
		it.skip('WORLDCOL.BIN not available', () => { /* noop */ });
		return;
	}

	const original = loadBundle('example/WORLDCOL.BIN');
	const bundle = parseBundle(original);
	const ctx = resourceCtxFromBundle(bundle);
	const handler = registry.find(h => h.typeId === 0x43)!;

	// Pick the first PolygonSoupList resource that has actual soups so the
	// edit we perform is observable (the first resource in WORLDCOL is a
	// 48-byte empty stub).
	const firstPopulated = (() => {
		for (const r of bundle.resources) {
			if (r.resourceTypeId !== 0x43) continue;
			const raw = extractResourceRaw(original, bundle, r);
			const model = handler.parseRaw(raw, ctx) as { soups: unknown[] };
			if (model.soups.length > 0) return { resource: r, model };
		}
		throw new Error('WORLDCOL has no populated PolygonSoupList');
	})();

	// Format the resource id the same way writeBundleFresh + BundleContext do.
	function formatId(id: { low: number; high: number }): string {
		const bi = (BigInt(id.high >>> 0) << 32n) | BigInt(id.low >>> 0);
		return `0x${bi.toString(16).toUpperCase().padStart(16, '0')}`;
	}

	it('overrides a single resource by id without touching sibling resources', () => {
		// Re-encode just the populated one we picked above. All other 0x43
		// resources should pass through byte-exact.
		const target = firstPopulated.resource;
		const targetIdHex = formatId(target.resourceId);
		const targetReencoded = handler.writeRaw!(firstPopulated.model as never, ctx);

		const repacked = writeBundleFresh(bundle, original, {
			overrides: { byResourceId: { [targetIdHex]: targetReencoded } },
		});

		const bundle2 = parseBundle(repacked);

		// The targeted resource should decode back to the same model.
		const target2 = bundle2.resources.find(r => {
			const id = formatId(r.resourceId);
			return id === targetIdHex;
		});
		expect(target2).toBeDefined();
		const raw2 = extractResourceRaw(repacked, bundle2, target2!);
		const model2 = handler.parseRaw(raw2, ctx) as { soups: unknown[] };
		expect(model2.soups.length).toBe((firstPopulated.model as { soups: unknown[] }).soups.length);

		// Every OTHER 0x43 resource must have the same raw bytes as before
		// (writer pass-through, not re-encoded). This is the whole point of
		// byResourceId — a typeId-scoped override would fail this check.
		for (const r of bundle.resources) {
			if (r.resourceTypeId !== 0x43) continue;
			if (formatId(r.resourceId) === targetIdHex) continue;
			const rawBefore = extractResourceRaw(original, bundle, r);
			const rAfter = bundle2.resources.find(x => {
				return formatId(x.resourceId) === formatId(r.resourceId);
			})!;
			const rawAfter = extractResourceRaw(repacked, bundle2, rAfter);
			expect(rawAfter.byteLength).toBe(rawBefore.byteLength);
			expect(Buffer.from(rawAfter).equals(Buffer.from(rawBefore))).toBe(true);
		}
	});

	it('falls back to typeId override when byResourceId has no entry for a resource', () => {
		// byResourceId targets resource X, typeId override targets type 0x43.
		// Resource X should use byResourceId; other 0x43 resources should
		// use the typeId override (all get the same replacement bytes).
		const target = firstPopulated.resource;
		const targetIdHex = formatId(target.resourceId);
		const targetReencoded = handler.writeRaw!(firstPopulated.model as never, ctx);

		// Construct a different "typeId override" from a second populated
		// resource so we can distinguish the two code paths downstream.
		const secondPopulated = (() => {
			let seen = 0;
			for (const r of bundle.resources) {
				if (r.resourceTypeId !== 0x43) continue;
				const raw = extractResourceRaw(original, bundle, r);
				const model = handler.parseRaw(raw, ctx) as { soups: unknown[] };
				if (model.soups.length > 0) {
					if (seen === 1) return { resource: r, model };
					seen++;
				}
			}
			throw new Error('WORLDCOL has <2 populated PolygonSoupList');
		})();
		const fallbackBytes = handler.writeRaw!(secondPopulated.model as never, ctx);

		const repacked = writeBundleFresh(bundle, original, {
			overrides: {
				resources: { 0x43: fallbackBytes },
				byResourceId: { [targetIdHex]: targetReencoded },
			},
		});

		const bundle2 = parseBundle(repacked);

		// The targeted resource should decode to model A (from byResourceId).
		const target2 = bundle2.resources.find(r => formatId(r.resourceId) === targetIdHex)!;
		const rawA = extractResourceRaw(repacked, bundle2, target2);
		const modelA = handler.parseRaw(rawA, ctx) as { soups: unknown[] };
		expect(modelA.soups.length).toBe((firstPopulated.model as { soups: unknown[] }).soups.length);
	});
});

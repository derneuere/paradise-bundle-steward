// Exhaustive round-trip tests for the PolygonSoupList parser+writer across
// every 0x43 resource in example/WORLDCOL.BIN. The registry auto-test picks
// up only the first matching resource, which happens to be a 48-byte empty
// list in this fixture — not nearly enough coverage for a pointer-heavy
// format. This file walks the full set so a single drifted byte on any of
// the 428 resources stands out.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from './bundle';
import { extractResourceRaw, resourceCtxFromBundle } from './registry';
import {
	parsePolygonSoupListData,
	writePolygonSoupListData,
	unpackSoupVertex,
} from './polygonSoupList';

const FIXTURE = path.resolve(__dirname, '../../../example/WORLDCOL.BIN');
const POLYGON_SOUP_LIST_TYPE_ID = 0x43;
const EXPECTED_COUNT = 428;

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadBundle(): ArrayBuffer {
	const raw = fs.readFileSync(FIXTURE);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return bytes.buffer;
}

describe('polygonSoupList round-trip across WORLDCOL.BIN', () => {
	it(`finds exactly ${EXPECTED_COUNT} PolygonSoupList resources`, () => {
		const buffer = loadBundle();
		const bundle = parseBundle(buffer);
		const count = bundle.resources.filter(
			(r) => r.resourceTypeId === POLYGON_SOUP_LIST_TYPE_ID,
		).length;
		expect(count).toBe(EXPECTED_COUNT);
	});

	it(`parses + byte-exact writes every PolygonSoupList in the fixture`, () => {
		const buffer = loadBundle();
		const bundle = parseBundle(buffer);
		const ctx = resourceCtxFromBundle(bundle);
		const targets = bundle.resources.filter(
			(r) => r.resourceTypeId === POLYGON_SOUP_LIST_TYPE_ID,
		);

		let parsedOk = 0;
		let roundTripped = 0;
		let idempotentOnly = 0; // stableWriter-level: write1 == write2 but != raw
		const failures: string[] = [];

		// Aggregate counters — eyeballed in CI logs to spot regressions.
		let totalSoups = 0;
		let totalPolys = 0;
		let totalVerts = 0;

		for (let idx = 0; idx < targets.length; idx++) {
			const r = targets[idx];
			try {
				const raw = extractResourceRaw(buffer, bundle, r);
				const model = parsePolygonSoupListData(raw, ctx.littleEndian);
				parsedOk++;
				totalSoups += model.soups.length;
				for (const s of model.soups) {
					totalPolys += s.polygons.length;
					totalVerts += s.vertices.length;
				}

				const write1 = writePolygonSoupListData(model, ctx.littleEndian);

				if (write1.byteLength === raw.byteLength && sha1(write1) === sha1(raw)) {
					roundTripped++;
					continue;
				}

				// Not byte-exact — check if at least writer is idempotent
				// (stable across a second pass).
				const model2 = parsePolygonSoupListData(write1, ctx.littleEndian);
				const write2 = writePolygonSoupListData(model2, ctx.littleEndian);
				if (sha1(write1) === sha1(write2)) {
					idempotentOnly++;
					if (failures.length < 3) {
						failures.push(
							`resource[${idx}] soups=${model.soups.length} raw=${raw.byteLength}B sha1=${sha1(raw).slice(0, 12)} write1=${write1.byteLength}B sha1=${sha1(write1).slice(0, 12)} (idempotent but not byte-exact)`,
						);
					}
					continue;
				}

				failures.push(
					`resource[${idx}] soups=${model.soups.length} NOT IDEMPOTENT: raw=${sha1(raw).slice(0, 12)} w1=${sha1(write1).slice(0, 12)} w2=${sha1(write2).slice(0, 12)}`,
				);
			} catch (err) {
				failures.push(
					`resource[${idx}] THREW: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		// Surface aggregate counts as a smoke signal.
		console.log(
			`polygonSoupList: ${parsedOk}/${targets.length} parsed, ` +
				`${roundTripped} byte-exact, ${idempotentOnly} idempotent-only, ` +
				`${failures.length} failures — ` +
				`totals: ${totalSoups} soups, ${totalPolys} polys, ${totalVerts} verts`,
		);

		if (failures.length > 0) {
			console.log('First failures:');
			for (const f of failures.slice(0, 10)) console.log('  ' + f);
		}

		expect(parsedOk).toBe(targets.length);
		expect(failures).toHaveLength(0);
		expect(roundTripped).toBe(targets.length);
	});
});

describe('unpackSoupVertex — unsigned u16 semantics', () => {
	it('treats coordinates with the high bit set as unsigned, not sign-extended', () => {
		// Regression guard: the viewport previously sign-extended packed u16
		// coordinates as i16, wrecking any vertex whose packed value was
		// ≥ 0x8000. Both the wiki spec and the official Burnout Paradise
		// Blender importer define these as unsigned. Verify directly on a
		// high-bit value with distinct-per-axis inputs so a swap bug can't hide.
		const high = { x: 0x8000, y: 0xABCD, z: 0xFFFF };
		const offsets: [number, number, number] = [10, 20, 30];
		const granularity = 0.5;
		const [wx, wy, wz] = unpackSoupVertex(high, offsets, granularity);
		// Plain unsigned arithmetic, per the spec and the Blender importer.
		expect(wx).toBeCloseTo((0x8000 + 10) * 0.5, 6);
		expect(wy).toBeCloseTo((0xABCD + 20) * 0.5, 6);
		expect(wz).toBeCloseTo((0xFFFF + 30) * 0.5, 6);
		// Sanity: all outputs must stay on the correct side of the overall
		// bbox. A sign-extended 0x8000 would land at a massively negative
		// value; the unsigned result is strictly positive given the inputs.
		expect(wx).toBeGreaterThan(0);
		expect(wy).toBeGreaterThan(0);
		expect(wz).toBeGreaterThan(0);
	});

	it('matches the unsigned (v + offset) * granularity formula across every high-bit vertex in WORLDCOL.BIN', () => {
		const buffer = loadBundle();
		const bundle = parseBundle(buffer);
		const ctx = resourceCtxFromBundle(bundle);
		const targets = bundle.resources.filter(
			(r) => r.resourceTypeId === POLYGON_SOUP_LIST_TYPE_ID,
		);

		let highBitVerts = 0;
		let checked = 0;
		let outOfRangeSeen = false;
		let maxDelta = 0;

		for (const r of targets) {
			const raw = extractResourceRaw(buffer, bundle, r);
			const model = parsePolygonSoupListData(raw, ctx.littleEndian);
			for (const soup of model.soups) {
				const vOff = soup.vertexOffsets;
				const g = soup.comprGranularity;
				for (const v of soup.vertices) {
					// Storage guarantees 0..0xFFFF. Flag once if that ever
					// drifts — asserted outside the hot loop.
					if (v.x < 0 || v.x > 0xFFFF || v.y < 0 || v.y > 0xFFFF || v.z < 0 || v.z > 0xFFFF) {
						outOfRangeSeen = true;
					}
					if (v.x >= 0x8000 || v.y >= 0x8000 || v.z >= 0x8000) highBitVerts++;

					const [wx, wy, wz] = unpackSoupVertex(v, vOff, g);
					const ex = (v.x + vOff[0]) * g;
					const ey = (v.y + vOff[1]) * g;
					const ez = (v.z + vOff[2]) * g;
					const dx = Math.abs(wx - ex);
					const dy = Math.abs(wy - ey);
					const dz = Math.abs(wz - ez);
					if (dx > maxDelta) maxDelta = dx;
					if (dy > maxDelta) maxDelta = dy;
					if (dz > maxDelta) maxDelta = dz;
					checked++;
				}
			}
		}

		console.log(
			`unpackSoupVertex: verified ${checked} vertices across ${targets.length} resources, ` +
				`${highBitVerts} with at least one coord ≥ 0x8000, maxDelta=${maxDelta}`,
		);
		expect(outOfRangeSeen).toBe(false);
		// Helper output must match the unsigned formula bit-for-bit (the two
		// expressions should produce the same float64).
		expect(maxDelta).toBe(0);
		// The fixture must contain high-bit vertices — if it doesn't, this
		// test can't actually catch the i16 sign-extension regression and the
		// fixture needs to be replaced with one that does.
		expect(highBitVerts).toBeGreaterThan(0);
	});
});

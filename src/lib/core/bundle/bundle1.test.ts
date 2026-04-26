// Bundle V1 ('bndl') reader / writer tests. Drives the older PVS fixture
// (Burnout 5 Nov 13 2006 / Feb 22 2007 prototypes) through:
//   - parseBundle1: header + entry decoding into a ParsedBundle with
//     bundle1Extras populated.
//   - writeBundle1Fresh with no overrides: must reproduce the original
//     buffer byte-for-byte (the round-trip contract).
//   - writeBundleFresh dispatch: when given a BND1-shaped ParsedBundle,
//     must route to the BND1 writer.
//   - parseBundle dispatch: when given a 'bndl' magic, must route to the
//     BND1 reader.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle, writeBundleFresh, convertBundle } from './index';
import { parseBundle1, writeBundle1Fresh, isBundle1Magic, bnd2ToBnd1Shape, bnd1ToBnd2Shape, convertBnd1Platform } from './bundle1';
import { extractResourceRaw, resourceCtxFromBundle } from '../registry';
import { parseZoneListData } from '../zoneList';
import { parseTextFileData } from '../textFile';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function loadBuffer(rel: string): ArrayBuffer {
	const abs = path.resolve(REPO_ROOT, rel);
	const raw = fs.readFileSync(abs);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return bytes.buffer;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

function sha1(bytes: Uint8Array | ArrayBuffer): string {
	const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	return createHash('sha1').update(u).digest('hex');
}

const OLDER_PVS = 'example/older builds/PVS.BNDL';
const RETAIL_PVS = 'example/PVS.BNDL';

describe('Bundle V1 (bndl)', () => {
	it('detects bndl magic', () => {
		const buf = loadBuffer(OLDER_PVS);
		expect(isBundle1Magic(buf)).toBe(true);
	});

	it('does not flag bnd2 buffers as bndl', () => {
		const buf = loadBuffer(RETAIL_PVS);
		expect(isBundle1Magic(buf)).toBe(false);
	});

	it('parseBundle dispatches BND1 fixtures into parseBundle1', () => {
		const buf = loadBuffer(OLDER_PVS);
		const bundle = parseBundle(buf, { strict: false });
		expect(bundle.bundle1Extras).toBeDefined();
		expect(bundle.bundle1Extras!.bndVersion).toBe(5);
		expect(bundle.bundle1Extras!.platform).toBe(2); // X360
		expect(bundle.header.magic).toBe('bndl');
		expect(bundle.resources.length).toBe(2);
		// First resource is the ZoneList (type 0xB000); second is auxiliary.
		expect(bundle.resources[0].resourceTypeId).toBe(0xB000);
	});

	it('parseBundle1 yields per-resource extras', () => {
		const buf = loadBuffer(OLDER_PVS);
		const bundle = parseBundle1(buf);
		const extras = bundle.bundle1Extras!;
		expect(extras.perResource.length).toBe(2);
		expect(extras.perResource[0].compressed).toBe(true);
		// X360 has 5 base resource pools.
		expect(extras.perResource[0].chunkSizes.length).toBe(5);
		expect(extras.perResource[0].chunkFileOffsets.length).toBe(5);
		// Hash table should expose both resource IDs.
		expect(extras.resourceIds.length).toBe(2);
	});

	it('writeBundle1Fresh with no overrides reproduces the input byte-for-byte', () => {
		const buf = loadBuffer(OLDER_PVS);
		const bundle = parseBundle1(buf);
		const out = writeBundle1Fresh(bundle, buf);
		const original = new Uint8Array(buf);
		const written = new Uint8Array(out);
		if (!bytesEqual(original, written)) {
			throw new Error(
				`BND1 round-trip mismatch: original sha1 ${sha1(original)} (${original.byteLength} B), ` +
					`written sha1 ${sha1(written)} (${written.byteLength} B)`,
			);
		}
	});

	it('writeBundleFresh dispatches BND1 bundles to the BND1 writer', () => {
		const buf = loadBuffer(OLDER_PVS);
		const bundle = parseBundle(buf);
		const out = writeBundleFresh(bundle, buf);
		const original = new Uint8Array(buf);
		const written = new Uint8Array(out);
		expect(written.byteLength).toBe(original.byteLength);
		expect(bytesEqual(original, written)).toBe(true);
	});

	it('writer is idempotent', () => {
		const buf = loadBuffer(OLDER_PVS);
		const bundle1 = parseBundle1(buf);
		const out1 = writeBundle1Fresh(bundle1, buf);
		const bundle2 = parseBundle1(out1);
		const out2 = writeBundle1Fresh(bundle2, out1);
		expect(bytesEqual(new Uint8Array(out1), new Uint8Array(out2))).toBe(true);
	});
});

// ============================================================================
// Cross-container conversion tests.
// ============================================================================

/**
 * Pull the ZoneList model out of a parsed bundle, regardless of which
 * container the bytes came from. Lets us assert that the same logical
 * payload survives every conversion direction.
 */
function readZoneListModel(ab: ArrayBuffer) {
	const bundle = parseBundle(ab, { strict: false });
	const zoneRes = bundle.resources.find((r) => r.resourceTypeId === 0xB000);
	if (!zoneRes) throw new Error('ZoneList resource missing from bundle');
	const ctx = resourceCtxFromBundle(bundle);
	const raw = extractResourceRaw(ab, bundle, zoneRes);
	return { bundle, model: parseZoneListData(raw, ctx.littleEndian), raw };
}

describe('Bundle V1 (bndl) — cross-container conversion', () => {
	// ----------------------------------------------------------------------
	// Source → target: container changes, endianness changes
	// ----------------------------------------------------------------------

	it('BND1 X360 → BND2 PC (container + BE→LE flip)', () => {
		const buf = loadBuffer(OLDER_PVS);
		const sourceBundle = parseBundle(buf, { strict: false });
		const out = convertBundle(sourceBundle, buf, {
			container: 'bnd2',
			platform: 1,
		});
		// Output must be a valid BND2 bundle.
		expect(isBundle1Magic(out)).toBe(false);
		const outBundle = parseBundle(out, { strict: false });
		expect(outBundle.bundle1Extras).toBeUndefined();
		expect(outBundle.header.platform).toBe(1);
		// ZoneList model must survive the flip with identical zone data.
		const { model: srcModel } = readZoneListModel(buf);
		const { model: outModel } = readZoneListModel(out);
		expect(outModel.zones.length).toBe(srcModel.zones.length);
		for (let i = 0; i < srcModel.zones.length; i++) {
			expect(outModel.zones[i].muZoneId).toBe(srcModel.zones[i].muZoneId);
			expect(outModel.zones[i].miZoneType).toBe(srcModel.zones[i].miZoneType);
			expect(outModel.zones[i].unsafeNeighbours.length).toBe(srcModel.zones[i].unsafeNeighbours.length);
		}
		// Spot-check a point coordinate to confirm endianness flipped correctly.
		expect(outModel.zones[0].points[0].x).toBeCloseTo(srcModel.zones[0].points[0].x, 5);
		expect(outModel.zones[0].points[0].y).toBeCloseTo(srcModel.zones[0].points[0].y, 5);
	});

	it('BND1 X360 → BND2 X360 (container flip, BE→BE same endianness)', () => {
		const buf = loadBuffer(OLDER_PVS);
		const sourceBundle = parseBundle(buf, { strict: false });
		const out = convertBundle(sourceBundle, buf, {
			container: 'bnd2',
			platform: 2,
		});
		const outBundle = parseBundle(out, { strict: false });
		expect(outBundle.bundle1Extras).toBeUndefined();
		expect(outBundle.header.platform).toBe(2);
		// Same endianness — no handler call needed for type-0x0003 either.
		const { model: srcModel } = readZoneListModel(buf);
		const { model: outModel } = readZoneListModel(out);
		expect(outModel.zones.length).toBe(srcModel.zones.length);
		expect(outModel.zones[0].muZoneId).toBe(srcModel.zones[0].muZoneId);
	});

	it('BND2 PC → BND1 X360 (container + LE→BE flip)', () => {
		const buf = loadBuffer(RETAIL_PVS);
		const sourceBundle = parseBundle(buf);
		const out = convertBundle(sourceBundle, buf, {
			container: 'bnd1',
			platform: 2,
		});
		// Output must be a valid BND1 X360 bundle.
		expect(isBundle1Magic(out)).toBe(true);
		const outBundle = parseBundle(out, { strict: false });
		expect(outBundle.bundle1Extras).toBeDefined();
		expect(outBundle.bundle1Extras!.platform).toBe(2);
		// ZoneList payload must round-trip the model exactly.
		const { model: srcModel } = readZoneListModel(buf);
		const { model: outModel } = readZoneListModel(out);
		expect(outModel.zones.length).toBe(srcModel.zones.length);
		expect(outModel.zones[0].muZoneId).toBe(srcModel.zones[0].muZoneId);
		expect(outModel.zones[0].points[0].x).toBeCloseTo(srcModel.zones[0].points[0].x, 5);
	});

	it('BND2 PC → BND1 PC (container flip, LE→LE same endianness)', () => {
		const buf = loadBuffer(RETAIL_PVS);
		const sourceBundle = parseBundle(buf);
		const out = convertBundle(sourceBundle, buf, {
			container: 'bnd1',
			platform: 1,
		});
		expect(isBundle1Magic(out)).toBe(true);
		const outBundle = parseBundle(out, { strict: false });
		expect(outBundle.bundle1Extras!.platform).toBe(1);
		// Endianness is the same — re-encoded bytes should match decompressed
		// source byte-for-byte (handler trip via parseRaw/writeRaw at the same
		// ctx is idempotent for ZoneList).
		const { model: srcModel } = readZoneListModel(buf);
		const { model: outModel } = readZoneListModel(out);
		expect(outModel.zones.length).toBe(srcModel.zones.length);
	});

	it('BND2 PC → BND2 X360 (existing cross-platform export, LE→BE)', () => {
		const buf = loadBuffer(RETAIL_PVS);
		const sourceBundle = parseBundle(buf);
		const out = convertBundle(sourceBundle, buf, {
			container: 'bnd2',
			platform: 2,
		});
		expect(isBundle1Magic(out)).toBe(false);
		const outBundle = parseBundle(out, { strict: false });
		expect(outBundle.bundle1Extras).toBeUndefined();
		expect(outBundle.header.platform).toBe(2);
		const { model: srcModel } = readZoneListModel(buf);
		const { model: outModel } = readZoneListModel(out);
		expect(outModel.zones.length).toBe(srcModel.zones.length);
		expect(outModel.zones[0].muZoneId).toBe(srcModel.zones[0].muZoneId);
	});

	it('BND2 X360 → BND2 PC (BE→LE flip, BND2 throughout)', () => {
		// Synthesize a BND2 X360 fixture by converting from BND1 X360, then
		// flip it back to PC. Validates that the BND2 cross-platform path
		// reads BE bundles correctly.
		const buf = loadBuffer(OLDER_PVS);
		const sourceBundle = parseBundle(buf, { strict: false });
		const beBnd2 = convertBundle(sourceBundle, buf, {
			container: 'bnd2',
			platform: 2,
		});
		const beBnd2Bundle = parseBundle(beBnd2, { strict: false });
		expect(beBnd2Bundle.header.platform).toBe(2);
		const leBnd2 = convertBundle(beBnd2Bundle, beBnd2, {
			container: 'bnd2',
			platform: 1,
		});
		const leBundle = parseBundle(leBnd2, { strict: false });
		expect(leBundle.header.platform).toBe(1);
		// Zone IDs survive the double-flip.
		const { model: srcModel } = readZoneListModel(buf);
		const { model: leModel } = readZoneListModel(leBnd2);
		expect(leModel.zones.length).toBe(srcModel.zones.length);
		expect(leModel.zones[0].muZoneId).toBe(srcModel.zones[0].muZoneId);
	});

	// ----------------------------------------------------------------------
	// Round-trips through the alternate container.
	// ----------------------------------------------------------------------

	it('BND1 X360 → BND2 PC → BND1 X360 preserves ZoneList model', () => {
		const buf = loadBuffer(OLDER_PVS);
		const sourceBundle = parseBundle(buf, { strict: false });
		const intermediate = convertBundle(sourceBundle, buf, {
			container: 'bnd2',
			platform: 1,
		});
		const intermediateBundle = parseBundle(intermediate, { strict: false });
		const back = convertBundle(intermediateBundle, intermediate, {
			container: 'bnd1',
			platform: 2,
		});
		// Model survives. Exact bytes won't because the BND2 intermediate
		// can't carry BND1-only artefacts (orphan neighbour padding, the
		// non-zero `_finalPad` tail) — but the logical model does.
		const { model: srcModel } = readZoneListModel(buf);
		const { model: backModel } = readZoneListModel(back);
		expect(backModel.zones.length).toBe(srcModel.zones.length);
		for (let i = 0; i < srcModel.zones.length; i++) {
			expect(backModel.zones[i].muZoneId).toBe(srcModel.zones[i].muZoneId);
			expect(backModel.zones[i].miZoneType).toBe(srcModel.zones[i].miZoneType);
			expect(backModel.zones[i].safeNeighbours.length).toBe(srcModel.zones[i].safeNeighbours.length);
			expect(backModel.zones[i].unsafeNeighbours.length).toBe(srcModel.zones[i].unsafeNeighbours.length);
		}
	});

	it('BND2 PC → BND1 X360 → BND2 PC preserves ZoneList model', () => {
		const buf = loadBuffer(RETAIL_PVS);
		const sourceBundle = parseBundle(buf);
		const intermediate = convertBundle(sourceBundle, buf, {
			container: 'bnd1',
			platform: 2,
		});
		const intermediateBundle = parseBundle(intermediate, { strict: false });
		const back = convertBundle(intermediateBundle, intermediate, {
			container: 'bnd2',
			platform: 1,
		});
		const { model: srcModel } = readZoneListModel(buf);
		const { model: backModel } = readZoneListModel(back);
		expect(backModel.zones.length).toBe(srcModel.zones.length);
		for (let i = 0; i < srcModel.zones.length; i++) {
			expect(backModel.zones[i].muZoneId).toBe(srcModel.zones[i].muZoneId);
			expect(backModel.zones[i].unsafeNeighbours.length).toBe(srcModel.zones[i].unsafeNeighbours.length);
			// Point coordinates survive both endianness flips.
			for (let p = 0; p < srcModel.zones[i].points.length; p++) {
				expect(backModel.zones[i].points[p].x).toBeCloseTo(srcModel.zones[i].points[p].x, 5);
				expect(backModel.zones[i].points[p].y).toBeCloseTo(srcModel.zones[i].points[p].y, 5);
			}
		}
	});

	// ----------------------------------------------------------------------
	// Failure modes / safety.
	// ----------------------------------------------------------------------

	it('rejects endian-flip of unhandled resource type when policy is "fail" (default)', () => {
		// Synthesize a bundle with an unhandled type id so we don't depend on
		// any production resource staying handler-less. Mutate a clone of the
		// older fixture: change one resource's typeId to a guaranteed-unknown
		// value (0xDEADBEEF). The conversion path must refuse to endian-flip
		// it without explicit `unknownResourcePolicy: 'passthrough'`.
		const buf = loadBuffer(OLDER_PVS);
		const sourceBundle = parseBundle(buf, { strict: false });
		const mutated = {
			...sourceBundle,
			resources: sourceBundle.resources.map((r, i) =>
				i === 1 ? { ...r, resourceTypeId: 0xDEADBEEF } : r,
			),
		};
		expect(() =>
			convertBundle(mutated, buf, { container: 'bnd2', platform: 1 }),
		).toThrow(/cannot endian-flip resource type 0xdeadbeef/);
	});

	it('rejects target container=bnd1 for a source with unsupported handler platform', () => {
		// Sanity: ZoneList's writePlatforms is [PC, X360]; PS3 is unsupported.
		const buf = loadBuffer(RETAIL_PVS);
		const sourceBundle = parseBundle(buf);
		expect(() =>
			convertBundle(sourceBundle, buf, { container: 'bnd1', platform: 3 }),
		).toThrow(/zoneList.*not validated for target platform/);
	});

	// ----------------------------------------------------------------------
	// Helper-function smoke tests (covered indirectly by convertBundle, but
	// exercise the helpers directly so failures point at the right layer).
	// ----------------------------------------------------------------------

	it('bnd1ToBnd2Shape strips bundle1Extras and rewrites the header', () => {
		const buf = loadBuffer(OLDER_PVS);
		const bundle = parseBundle1(buf);
		const shaped = bnd1ToBnd2Shape(bundle, 1);
		expect(shaped.bundle1Extras).toBeUndefined();
		expect(shaped.header.magic).toBe('bnd2');
		expect(shaped.header.version).toBe(2);
		expect(shaped.header.platform).toBe(1);
		// Resources untouched in shape.
		expect(shaped.resources.length).toBe(bundle.resources.length);
	});

	it('bnd2ToBnd1Shape synthesizes a sensible bundle1Extras', () => {
		const buf = loadBuffer(RETAIL_PVS);
		const bundle = parseBundle(buf);
		const shaped = bnd2ToBnd1Shape(bundle, buf, 2);
		expect(shaped.bundle1Extras).toBeDefined();
		const x = shaped.bundle1Extras!;
		expect(x.bndVersion).toBe(5);
		expect(x.platform).toBe(2);
		expect(x.perResource.length).toBe(bundle.resources.length);
		// X360 has 5 chunks per resource.
		expect(x.perResource[0].chunkSizes.length).toBe(5);
		// Compressed flag derived from the source.
		expect(x.flags & 0x1).toBe(0x1);
	});

	it('convertBnd1Platform reshapes the per-resource chunk arrays', () => {
		const buf = loadBuffer(OLDER_PVS);
		const bundle = parseBundle1(buf);
		const pcShape = convertBnd1Platform(bundle, 1);
		expect(pcShape.bundle1Extras!.platform).toBe(1);
		// PC has 4 chunks per resource (vs X360's 5).
		expect(pcShape.bundle1Extras!.perResource[0].chunkSizes.length).toBe(4);
		expect(pcShape.bundle1Extras!.allocatedResourcePointers.length).toBe(4);
	});

	it('parseBundle1 rejects bnd2 magic', () => {
		const buf = loadBuffer(RETAIL_PVS);
		expect(() => parseBundle1(buf)).toThrow(/Not a BND1/);
	});

	it('TextFile (type 0x3) content survives BND1 → BND2 conversion', () => {
		// The auxiliary BundleImports XML from the older PVS fixture must
		// reach the BND2 output bit-for-bit identical (text + length prefix
		// + null-and-pad tail). The TextFile handler's mLength is always
		// little-endian on disk, so it must NOT flip when we cross from BND1
		// X360 (BE bundle) to BND2 PC (LE bundle).
		const buf = loadBuffer(OLDER_PVS);
		const sourceBundle = parseBundle(buf, { strict: false });
		const sourceAuxRes = sourceBundle.resources.find((r) => r.resourceTypeId === 0x3);
		expect(sourceAuxRes).toBeDefined();
		const sourceCtx = resourceCtxFromBundle(sourceBundle);
		const sourceAuxRaw = extractResourceRaw(buf, sourceBundle, sourceAuxRes!);
		const sourceModel = parseTextFileData(sourceAuxRaw, sourceCtx.littleEndian);
		expect(sourceModel.text).toContain('<ResourceStringTable>');
		expect(sourceModel.text).toContain('5a4a4cdb');
		expect(sourceModel.text).toContain('newgrid');

		const out = convertBundle(sourceBundle, buf, { container: 'bnd2', platform: 1 });
		const outBundle = parseBundle(out, { strict: false });
		const outAuxRes = outBundle.resources.find((r) => r.resourceTypeId === 0x3);
		expect(outAuxRes).toBeDefined();
		const outCtx = resourceCtxFromBundle(outBundle);
		const outAuxRaw = extractResourceRaw(out, outBundle, outAuxRes!);
		const outModel = parseTextFileData(outAuxRaw, outCtx.littleEndian);
		expect(outModel.text).toBe(sourceModel.text);
		expect(bytesEqual(outModel._trailingBytes, sourceModel._trailingBytes)).toBe(true);
	});

	it('passthrough policy still works for explicitly-unhandled types', () => {
		// Stress the escape hatch: tag a resource as 0xDEADBEEF and pass
		// `unknownResourcePolicy: 'passthrough'`. The conversion should
		// succeed without throwing, and the bytes pass through verbatim
		// since we asked for it.
		const buf = loadBuffer(OLDER_PVS);
		const sourceBundle = parseBundle(buf, { strict: false });
		const mutated = {
			...sourceBundle,
			resources: sourceBundle.resources.map((r, i) =>
				i === 1 ? { ...r, resourceTypeId: 0xDEADBEEF } : r,
			),
		};
		const out = convertBundle(mutated, buf, {
			container: 'bnd2',
			platform: 1,
			unknownResourcePolicy: 'passthrough',
		});
		const outBundle = parseBundle(out, { strict: false });
		expect(outBundle.resources.find((r) => r.resourceTypeId === 0xDEADBEEF)).toBeDefined();
	});
});


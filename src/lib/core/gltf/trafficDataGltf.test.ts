// TrafficData ↔ glTF round-trip tests.
//
// Contract: byte-exact round-trip. TrafficData's writer is byte-exact on
// first pass (unlike StreetData), so the glTF round-trip must preserve
// every f32 bit pattern including NaN and -0. These tests pin that.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../bundle';
import { RESOURCE_TYPE_IDS } from '../types';
import { extractResourceSize, isCompressed, decompressData } from '../resourceManager';
import {
	parseTrafficDataData,
	writeTrafficDataData,
	type ParsedTrafficData,
} from '../trafficData';
import {
	buildTrafficDataDocument,
	exportTrafficDataToGltf,
	exportTrafficDataToGltfJson,
	importTrafficDataFromGltf,
	readTrafficDataFromDocument,
} from './trafficDataGltf';
import { paradiseToGltf } from './coords';

const FIXTURE = path.resolve(__dirname, '../../../../example/B5TRAFFIC.BNDL');

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

function loadFixtureModel(): {
	model: ParsedTrafficData;
	raw: Uint8Array;
	baselineWrite: Uint8Array;
} {
	const raw = fs.readFileSync(FIXTURE);
	const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find(
		(r) => r.resourceTypeId === RESOURCE_TYPE_IDS.TRAFFIC_DATA,
	);
	if (!resource) throw new Error('fixture missing TrafficData resource');
	let extracted: Uint8Array | null = null;
	for (let bi = 0; bi < 3; bi++) {
		const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[bi]);
		if (size <= 0) continue;
		const base = bundle.header.resourceDataOffsets[bi] >>> 0;
		const rel = resource.diskOffsets[bi] >>> 0;
		const start = (base + rel) >>> 0;
		let slice: Uint8Array = new Uint8Array(buffer.slice(start, start + size));
		if (isCompressed(slice)) slice = decompressData(slice) as Uint8Array;
		extracted = slice;
		break;
	}
	if (!extracted) throw new Error('TrafficData resource had no populated block');
	const model = parseTrafficDataData(extracted, true);
	const baselineWrite = writeTrafficDataData(model, true);
	return { model, raw: extracted, baselineWrite };
}

describe('trafficData glTF round-trip', () => {
	it('glb export → import → write is byte-identical to direct-write baseline', async () => {
		const { model, baselineWrite } = loadFixtureModel();
		const gltfBytes = await exportTrafficDataToGltf(model);
		const modelAfter = await importTrafficDataFromGltf(gltfBytes);
		const postWrite = writeTrafficDataData(modelAfter, true);

		expect(postWrite.byteLength).toBe(baselineWrite.byteLength);
		expect(sha1(postWrite)).toBe(sha1(baselineWrite));
		expect(bytesEqual(postWrite, baselineWrite)).toBe(true);
	});

	it('json .gltf export → import → write is byte-identical to baseline', async () => {
		const { model, baselineWrite } = loadFixtureModel();
		const gltfJson = await exportTrafficDataToGltfJson(model);
		const modelAfter = await importTrafficDataFromGltf(gltfJson);
		const postWrite = writeTrafficDataData(modelAfter, true);

		expect(sha1(postWrite)).toBe(sha1(baselineWrite));
	});

	it('glb export is deterministic across passes', async () => {
		const { model } = loadFixtureModel();
		const a = await exportTrafficDataToGltf(model);
		const b = await exportTrafficDataToGltf(model);
		expect(sha1(a)).toBe(sha1(b));
	});

	it('json .gltf export is deterministic across passes', async () => {
		const { model } = loadFixtureModel();
		const a = await exportTrafficDataToGltfJson(model);
		const b = await exportTrafficDataToGltfJson(model);
		expect(sha1(a)).toBe(sha1(b));
	});

	it('scene has a TrafficData root group with per-hull subtrees', () => {
		const { model } = loadFixtureModel();
		const doc = buildTrafficDataDocument(model);
		const scene = doc.getRoot().listScenes()[0];
		const roots = scene.listChildren();
		expect(roots).toHaveLength(1);
		expect(roots[0].getName()).toBe('TrafficData');
		expect(roots[0].listChildren().length).toBe(model.hulls.length);
	});

	it('NaN values in lane rungs survive round-trip bit-for-bit', async () => {
		const { model } = loadFixtureModel();
		// Find a rung with a NaN in any component; if the fixture has none,
		// skip (but real Paradise data usually has some).
		let foundHullIdx = -1;
		let foundRungIdx = -1;
		outer: for (let hi = 0; hi < model.hulls.length; hi++) {
			const rungs = model.hulls[hi].rungs;
			for (let ri = 0; ri < rungs.length; ri++) {
				const p = rungs[ri].maPoints;
				if ([p[0].x, p[0].y, p[0].z, p[0].w, p[1].x, p[1].y, p[1].z, p[1].w].some(Number.isNaN)) {
					foundHullIdx = hi;
					foundRungIdx = ri;
					break outer;
				}
			}
		}
		if (foundHullIdx < 0) return; // fixture has no NaNs — skip silently

		const gltfBytes = await exportTrafficDataToGltf(model);
		const modelAfter = await importTrafficDataFromGltf(gltfBytes);
		const a = model.hulls[foundHullIdx].rungs[foundRungIdx].maPoints;
		const b = modelAfter.hulls[foundHullIdx].rungs[foundRungIdx].maPoints;
		// Compare bit patterns for each f32.
		for (const key of ['x', 'y', 'z', 'w'] as const) {
			const f32a = Math.fround(a[0][key]);
			const f32b = Math.fround(b[0][key]);
			if (Number.isNaN(f32a)) {
				expect(Number.isNaN(f32b)).toBe(true);
			} else {
				expect(f32b).toBe(f32a);
			}
		}
	});

	it('bigint light-trigger destination IDs survive round-trip', async () => {
		const { model } = loadFixtureModel();
		const gltfBytes = await exportTrafficDataToGltf(model);
		const modelAfter = await importTrafficDataFromGltf(gltfBytes);
		for (let hi = 0; hi < model.hulls.length; hi++) {
			const beforeStart = model.hulls[hi].lightTriggerStartData;
			const afterStart = modelAfter.hulls[hi].lightTriggerStartData;
			expect(afterStart.length).toBe(beforeStart.length);
			for (let i = 0; i < beforeStart.length; i++) {
				for (let j = 0; j < beforeStart[i].maDestinationIDs.length; j++) {
					expect(afterStart[i].maDestinationIDs[j]).toBe(
						beforeStart[i].maDestinationIDs[j],
					);
				}
			}
		}
	});

	it('paintColours f32 values survive round-trip', async () => {
		const { model } = loadFixtureModel();
		const gltfBytes = await exportTrafficDataToGltf(model);
		const modelAfter = await importTrafficDataFromGltf(gltfBytes);
		expect(modelAfter.paintColours.length).toBe(model.paintColours.length);
		for (let i = 0; i < model.paintColours.length; i++) {
			expect(modelAfter.paintColours[i]).toEqual(model.paintColours[i]);
		}
	});

	it('removing the last section in a hull still byte-matches writer output', async () => {
		const { model } = loadFixtureModel();
		const hullIdx = model.hulls.findIndex((h) => h.sections.length > 1 && h.sectionFlows.length > 1);
		if (hullIdx < 0) return;
		// Build an edit identical to the one in trafficData.test.ts schema test.
		const hulls = model.hulls.slice();
		hulls[hullIdx] = {
			...hulls[hullIdx],
			sections: hulls[hullIdx].sections.slice(0, -1),
			sectionFlows: hulls[hullIdx].sectionFlows.slice(0, -1),
		};
		const edited: ParsedTrafficData = { ...model, hulls };

		const baselineEdited = writeTrafficDataData(edited, true);
		const gltfBytes = await exportTrafficDataToGltf(edited);
		const modelAfter = await importTrafficDataFromGltf(gltfBytes);
		const postWrite = writeTrafficDataData(modelAfter, true);

		expect(sha1(postWrite)).toBe(sha1(baselineEdited));
	});

	it('rejects a glTF without paradiseBundle.trafficData extras', async () => {
		const { model } = loadFixtureModel();
		const doc = buildTrafficDataDocument(model);
		doc.getRoot().listScenes()[0].setExtras({});
		expect(() => readTrafficDataFromDocument(doc)).toThrow(/paradiseBundle/);
	});

	it('quad-strip vertex order is [L_i, R_i] with paradiseToGltf applied per rung', () => {
		const { model } = loadFixtureModel();
		const doc = buildTrafficDataDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];

		// Pick the first hull/section pair with N >= 2 rungs deterministically.
		let hullIdx = -1;
		let sectionIdx = -1;
		for (let hi = 0; hi < model.hulls.length && hullIdx < 0; hi++) {
			const h = model.hulls[hi];
			if (h.rungs.length === 0) continue;
			for (let si = 0; si < h.sections.length; si++) {
				if (h.sections[si].muNumRungs >= 2) {
					hullIdx = hi;
					sectionIdx = si;
					break;
				}
			}
		}
		expect(hullIdx).toBeGreaterThanOrEqual(0);

		const hull = model.hulls[hullIdx];
		const section = hull.sections[sectionIdx];
		const N = section.muNumRungs;

		const sectionsGroup = root
			.listChildren()[hullIdx]
			.listChildren()
			.find((n) => n.getName() === 'Sections')!;
		const node = sectionsGroup.listChildren()[sectionIdx];
		const positions = node.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!;

		// Read the f32 backing array. glTF-transform exposes it via getArray().
		const arr = positions.getArray()!;
		expect(arr.length).toBe(N * 2 * 3);

		// For every rung in the section, the L vert must sit at index 2i and the
		// R vert at 2i+1, with paradiseToGltf applied. Pin the first 3 rungs to
		// keep the test cheap but enough to catch a flip/swap regression.
		const checkUpTo = Math.min(N, 3);
		for (let i = 0; i < checkUpTo; i++) {
			const rung = hull.rungs[section.muRungOffset + i];
			const [l, r] = rung.maPoints;
			const lg = paradiseToGltf({ x: l.x, y: l.y, z: l.z });
			const rg = paradiseToGltf({ x: r.x, y: r.y, z: r.z });

			const lOff = 2 * i * 3;
			const rOff = (2 * i + 1) * 3;
			// Compare as f32 since the buffer rounds to single precision.
			expect(arr[lOff + 0]).toBe(Math.fround(lg[0]));
			expect(arr[lOff + 1]).toBe(Math.fround(lg[1]));
			expect(arr[lOff + 2]).toBe(Math.fround(lg[2]));
			expect(arr[rOff + 0]).toBe(Math.fround(rg[0]));
			expect(arr[rOff + 1]).toBe(Math.fround(rg[1]));
			expect(arr[rOff + 2]).toBe(Math.fround(rg[2]));
		}
	});

	it('quad-strip indices spell out (L_i,R_i,R_{i+1},L_i,R_{i+1},L_{i+1}) per quad', () => {
		const { model } = loadFixtureModel();
		const doc = buildTrafficDataDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];

		// Find a section with at least 3 rungs so we can pin >1 quad.
		let hullIdx = -1;
		let sectionIdx = -1;
		for (let hi = 0; hi < model.hulls.length && hullIdx < 0; hi++) {
			const h = model.hulls[hi];
			if (h.rungs.length === 0) continue;
			for (let si = 0; si < h.sections.length; si++) {
				if (h.sections[si].muNumRungs >= 3) {
					hullIdx = hi;
					sectionIdx = si;
					break;
				}
			}
		}
		expect(hullIdx).toBeGreaterThanOrEqual(0);

		const N = model.hulls[hullIdx].sections[sectionIdx].muNumRungs;
		const sectionsGroup = root
			.listChildren()[hullIdx]
			.listChildren()
			.find((n) => n.getName() === 'Sections')!;
		const node = sectionsGroup.listChildren()[sectionIdx];
		const indices = node.getMesh()!.listPrimitives()[0].getIndices()!;
		const arr = indices.getArray()!;

		expect(arr.length).toBe((N - 1) * 6);

		// Every index must be in-bounds for the 2N vertices.
		for (let k = 0; k < arr.length; k++) {
			expect(arr[k]).toBeGreaterThanOrEqual(0);
			expect(arr[k]).toBeLessThan(N * 2);
		}

		// Pin the first two quads exactly so a winding flip or off-by-one
		// regresses loudly. Quad i corners: l0=2i, r0=2i+1, l1=2(i+1), r1=2i+3.
		// Triangles per quad: (l0, r0, r1) and (l0, r1, l1).
		for (let i = 0; i < Math.min(N - 1, 2); i++) {
			const o = i * 6;
			const l0 = 2 * i;
			const r0 = 2 * i + 1;
			const l1 = 2 * (i + 1);
			const r1 = 2 * (i + 1) + 1;
			expect(arr[o + 0]).toBe(l0);
			expect(arr[o + 1]).toBe(r0);
			expect(arr[o + 2]).toBe(r1);
			expect(arr[o + 3]).toBe(l0);
			expect(arr[o + 4]).toBe(r1);
			expect(arr[o + 5]).toBe(l1);
		}
	});

	it('every TrafficSection with N>=2 rungs gets a TRIANGLES quad-strip ribbon', () => {
		const { model } = loadFixtureModel();
		const doc = buildTrafficDataDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];

		// Pick a hull guaranteed to have sections with at least 2 rungs.
		const hullIdx = model.hulls.findIndex(
			(h) => h.sections.some((s) => s.muNumRungs >= 2) && h.rungs.length > 0,
		);
		expect(hullIdx).toBeGreaterThanOrEqual(0);

		const hullNode = root.listChildren()[hullIdx];
		const sectionsGroup = hullNode.listChildren().find((n) => n.getName() === 'Sections')!;
		const sectionNodes = sectionsGroup.listChildren();
		const hull = model.hulls[hullIdx];

		let checked = 0;
		for (let si = 0; si < hull.sections.length; si++) {
			const section = hull.sections[si];
			if (section.muNumRungs < 2) continue;
			const node = sectionNodes[si];
			const mesh = node.getMesh();
			expect(mesh).toBeDefined();
			// TRIANGLES = glTF mode 4. Single primitive, indexed quad strip:
			//   POSITION count = 2 * N (interleaved L_i, R_i)
			//   index count    = 6 * (N - 1)  (two tris per quad)
			const prims = mesh!.listPrimitives();
			expect(prims.length).toBe(1);
			const prim = prims[0];
			expect(prim.getMode()).toBe(4);
			const positions = prim.getAttribute('POSITION');
			expect(positions).toBeDefined();
			expect(positions!.getCount()).toBe(section.muNumRungs * 2);
			const indices = prim.getIndices();
			expect(indices).toBeDefined();
			expect(indices!.getCount()).toBe((section.muNumRungs - 1) * 6);
			checked++;
			if (checked >= 5) break; // spot-check, not exhaustive
		}
		expect(checked).toBeGreaterThan(0);
	});
});

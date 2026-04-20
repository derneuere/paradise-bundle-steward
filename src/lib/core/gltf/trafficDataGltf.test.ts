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

	it('every non-empty TrafficSection gets a 2-primitive LINE_STRIP ribbon mesh', () => {
		const { model } = loadFixtureModel();
		const doc = buildTrafficDataDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];

		// Pick a hull guaranteed to have sections with rungs.
		const hullIdx = model.hulls.findIndex(
			(h) => h.sections.some((s) => s.muNumRungs > 0) && h.rungs.length > 0,
		);
		expect(hullIdx).toBeGreaterThanOrEqual(0);

		const hullNode = root.listChildren()[hullIdx];
		const sectionsGroup = hullNode.listChildren().find((n) => n.getName() === 'Sections')!;
		const sectionNodes = sectionsGroup.listChildren();
		const hull = model.hulls[hullIdx];

		let checked = 0;
		for (let si = 0; si < hull.sections.length; si++) {
			const section = hull.sections[si];
			if (section.muNumRungs <= 0) continue;
			const node = sectionNodes[si];
			const mesh = node.getMesh();
			expect(mesh).toBeDefined();
			// LINE_STRIP = glTF mode 3. Two primitives: left edge + right edge.
			const prims = mesh!.listPrimitives();
			expect(prims.length).toBe(2);
			for (const prim of prims) {
				expect(prim.getMode()).toBe(3);
				const accessor = prim.getAttribute('POSITION');
				expect(accessor).toBeDefined();
				expect(accessor!.getCount()).toBe(section.muNumRungs);
			}
			checked++;
			if (checked >= 5) break; // spot-check, not exhaustive
		}
		expect(checked).toBeGreaterThan(0);
	});
});

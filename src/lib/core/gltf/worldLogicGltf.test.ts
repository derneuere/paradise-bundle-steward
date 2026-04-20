// WorldLogic (multi-resource) glTF round-trip tests.
//
// These exercise the orchestrator's ability to put multiple resources into a
// single glTF scene and extract them back. Individual resource correctness
// lives in streetDataGltf.test.ts and trafficDataGltf.test.ts.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../bundle';
import { RESOURCE_TYPE_IDS } from '../types';
import { extractResourceSize, isCompressed, decompressData } from '../resourceManager';
import { parseStreetDataData, writeStreetDataData } from '../streetData';
import { parseTrafficDataData, writeTrafficDataData } from '../trafficData';
import {
	buildWorldLogicDocument,
	exportWorldLogicToGltf,
	exportWorldLogicToGltfJson,
	importWorldLogicFromDocument,
	importWorldLogicFromGltf,
} from './worldLogicGltf';

const STREET_FIXTURE = path.resolve(__dirname, '../../../../example/BTTSTREETDATA.DAT');
const TRAFFIC_FIXTURE = path.resolve(__dirname, '../../../../example/B5TRAFFIC.BNDL');

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function extractByType(fixturePath: string, typeId: number): Uint8Array {
	const raw = fs.readFileSync(fixturePath);
	const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === typeId);
	if (!resource) throw new Error(`fixture ${fixturePath} has no resource of type 0x${typeId.toString(16)}`);
	for (let bi = 0; bi < 3; bi++) {
		const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[bi]);
		if (size <= 0) continue;
		const base = bundle.header.resourceDataOffsets[bi] >>> 0;
		const rel = resource.diskOffsets[bi] >>> 0;
		const start = (base + rel) >>> 0;
		let slice: Uint8Array = new Uint8Array(buffer.slice(start, start + size));
		if (isCompressed(slice)) slice = decompressData(slice) as Uint8Array;
		return slice;
	}
	throw new Error(`fixture ${fixturePath} has no populated block`);
}

function loadCombined() {
	const streetRaw = extractByType(STREET_FIXTURE, RESOURCE_TYPE_IDS.STREET_DATA);
	const trafficRaw = extractByType(TRAFFIC_FIXTURE, RESOURCE_TYPE_IDS.TRAFFIC_DATA);
	const streetData = parseStreetDataData(streetRaw);
	const trafficData = parseTrafficDataData(trafficRaw, true);
	return { streetData, trafficData };
}

describe('worldLogic multi-resource round-trip', () => {
	it('streetData-only payload round-trips byte-exact through glb', async () => {
		const { streetData } = loadCombined();
		const baseline = writeStreetDataData(streetData);
		const gltfBytes = await exportWorldLogicToGltf({ streetData });
		const payloadAfter = await importWorldLogicFromGltf(gltfBytes);
		expect(payloadAfter.streetData).toBeDefined();
		expect(payloadAfter.trafficData).toBeUndefined();
		const post = writeStreetDataData(payloadAfter.streetData!);
		expect(sha1(post)).toBe(sha1(baseline));
	});

	it('trafficData-only payload round-trips byte-exact through glb', async () => {
		const { trafficData } = loadCombined();
		const baseline = writeTrafficDataData(trafficData, true);
		const gltfBytes = await exportWorldLogicToGltf({ trafficData });
		const payloadAfter = await importWorldLogicFromGltf(gltfBytes);
		expect(payloadAfter.trafficData).toBeDefined();
		expect(payloadAfter.streetData).toBeUndefined();
		const post = writeTrafficDataData(payloadAfter.trafficData!, true);
		expect(sha1(post)).toBe(sha1(baseline));
	});

	it('combined payload round-trips both resources byte-exact', async () => {
		const { streetData, trafficData } = loadCombined();
		const streetBaseline = writeStreetDataData(streetData);
		const trafficBaseline = writeTrafficDataData(trafficData, true);

		const gltfBytes = await exportWorldLogicToGltf({ streetData, trafficData });
		const payloadAfter = await importWorldLogicFromGltf(gltfBytes);

		expect(payloadAfter.streetData).toBeDefined();
		expect(payloadAfter.trafficData).toBeDefined();
		const streetPost = writeStreetDataData(payloadAfter.streetData!);
		const trafficPost = writeTrafficDataData(payloadAfter.trafficData!, true);
		expect(sha1(streetPost)).toBe(sha1(streetBaseline));
		expect(sha1(trafficPost)).toBe(sha1(trafficBaseline));
	});

	it('combined payload scene has both resource subtrees', () => {
		const { streetData, trafficData } = loadCombined();
		const doc = buildWorldLogicDocument({ streetData, trafficData });
		const scene = doc.getRoot().listScenes()[0];
		const rootNames = scene.listChildren().map((n) => n.getName()).sort();
		expect(rootNames).toEqual(['StreetData', 'TrafficData']);
	});

	it('combined payload scene.extras has both paradiseBundle keys', () => {
		const { streetData, trafficData } = loadCombined();
		const doc = buildWorldLogicDocument({ streetData, trafficData });
		const scene = doc.getRoot().listScenes()[0];
		const extras = scene.getExtras() as Record<string, unknown>;
		const pb = extras.paradiseBundle as Record<string, unknown>;
		expect(pb).toBeDefined();
		expect(pb.streetData).toBeDefined();
		expect(pb.trafficData).toBeDefined();
	});

	it('combined export is deterministic across passes', async () => {
		const { streetData, trafficData } = loadCombined();
		const a = await exportWorldLogicToGltf({ streetData, trafficData });
		const b = await exportWorldLogicToGltf({ streetData, trafficData });
		expect(sha1(a)).toBe(sha1(b));
	});

	it('combined json .gltf export is deterministic across passes', async () => {
		const { streetData, trafficData } = loadCombined();
		const a = await exportWorldLogicToGltfJson({ streetData, trafficData });
		const b = await exportWorldLogicToGltfJson({ streetData, trafficData });
		expect(sha1(a)).toBe(sha1(b));
	});

	it('empty payload produces a well-formed document with no subtrees', () => {
		const doc = buildWorldLogicDocument({});
		const scene = doc.getRoot().listScenes()[0];
		expect(scene.listChildren()).toEqual([]);
		const payloadAfter = importWorldLogicFromDocument(doc);
		expect(payloadAfter).toEqual({});
	});
});

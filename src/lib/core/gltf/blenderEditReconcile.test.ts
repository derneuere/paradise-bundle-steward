// Phase 5 reconciliation tests.
//
// These prove that editing a node translation at the glTF layer (the
// Blender-user path) actually lands in the reconstructed Paradise model.
// Each resource has its own reconciler walking its known group/index
// convention; this file exercises them end-to-end.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NodeIO } from '@gltf-transform/core';

import { parseBundle } from '../bundle';
import { RESOURCE_TYPE_IDS } from '../types';
import { extractResourceSize, isCompressed, decompressData } from '../resourceManager';
import {
	parseStreetDataData,
	type ParsedStreetData,
} from '../streetData';
import {
	parseTrafficDataData,
	type ParsedTrafficData,
} from '../trafficData';
import {
	parseAISectionsData,
	type ParsedAISectionsV12,
} from '../aiSections';
import {
	parseTriggerDataData,
	type ParsedTriggerData,
} from '../triggerData';
import {
	buildStreetDataDocument,
	importStreetDataFromGltf,
} from './streetDataGltf';
import {
	buildTrafficDataDocument,
	importTrafficDataFromGltf,
} from './trafficDataGltf';
import {
	buildAISectionsDocument,
	importAISectionsFromGltf,
} from './aiSectionsGltf';
import {
	buildTriggerDataDocument,
	importTriggerDataFromGltf,
} from './triggerDataGltf';
import { paradiseToGltf } from './coords';

// ---------------------------------------------------------------------------
// Fixture loaders
// ---------------------------------------------------------------------------

function extractTypedResource(fixturePath: string, typeId: number): Uint8Array {
	const raw = fs.readFileSync(fixturePath);
	const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === typeId);
	if (!resource) throw new Error(`${fixturePath}: no resource of type 0x${typeId.toString(16)}`);
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
	throw new Error(`${fixturePath}: no populated block`);
}

function loadStreet(): ParsedStreetData {
	return parseStreetDataData(
		extractTypedResource(
			path.resolve(__dirname, '../../../../example/BTTSTREETDATA.DAT'),
			RESOURCE_TYPE_IDS.STREET_DATA,
		),
	);
}
function loadTraffic(): ParsedTrafficData {
	return parseTrafficDataData(
		extractTypedResource(
			path.resolve(__dirname, '../../../../example/B5TRAFFIC.BNDL'),
			RESOURCE_TYPE_IDS.TRAFFIC_DATA,
		),
		true,
	);
}
function loadAI(): ParsedAISectionsV12 {
	const parsed = parseAISectionsData(
		extractTypedResource(
			path.resolve(__dirname, '../../../../example/AI.DAT'),
			RESOURCE_TYPE_IDS.AI_SECTIONS,
		),
		true,
	);
	if (parsed.kind !== 'v12') throw new Error(`Expected v12 fixture, got ${parsed.kind}`);
	return parsed;
}
function loadTrigger(): ParsedTriggerData {
	return parseTriggerDataData(
		extractTypedResource(
			path.resolve(__dirname, '../../../../example/TRIGGERS.DAT'),
			RESOURCE_TYPE_IDS.TRIGGER_DATA,
		),
		true,
	);
}

// Serialize a Document to .glb via NodeIO so the test exercises the real
// binary path that Blender would exercise.
async function writeGlb(
	doc: import('@gltf-transform/core').Document,
): Promise<Uint8Array> {
	const io = new NodeIO();
	return io.writeBinary(doc);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Produce a nudge the f32 round-trip can preserve cleanly. Math.fround pins
 * the target to the nearest representable f32 value.
 */
function nudge(base: number, delta = 100): number {
	return Math.fround(base + delta);
}

// ---------------------------------------------------------------------------
// StreetData
// ---------------------------------------------------------------------------

describe('StreetData: edit road translation in glTF → model reflects it', () => {
	it('dragging roads[0] by +100 on x lands on mReferencePosition.x', async () => {
		const model = loadStreet();
		const doc = buildStreetDataDocument(model);

		// Find the Roads group's first node and bump its translation +100 on
		// Paradise X (which is glTF X — no axis swap on +X).
		const scene = doc.getRoot().listScenes()[0];
		const root = scene.listChildren().find((n) => n.getName() === 'StreetData')!;
		const roadsGroup = root.listChildren().find((n) => n.getName() === 'Roads')!;
		const roadNode = roadsGroup.listChildren()[0];
		const t = roadNode.getTranslation();
		const newX = nudge(t[0]);
		roadNode.setTranslation([newX, t[1], t[2]]);

		const bytes = await writeGlb(doc);
		const modelAfter = await importStreetDataFromGltf(bytes);

		expect(modelAfter.roads[0].mReferencePosition.x).toBe(newX);
		// y / z (after Paradise→glTF→Paradise) should match the original f32s.
		expect(modelAfter.roads[0].mReferencePosition.y).toBe(model.roads[0].mReferencePosition.y);
		expect(modelAfter.roads[0].mReferencePosition.z).toBe(model.roads[0].mReferencePosition.z);
	});
});

// ---------------------------------------------------------------------------
// TrafficData
// ---------------------------------------------------------------------------

describe('TrafficData: edit node translations → model positions update', () => {
	it('dragging a junction logic box lands on mPosition.{x,y,z}', async () => {
		const model = loadTraffic();
		// Find a hull with at least one junction logic box.
		const hullIdx = model.hulls.findIndex((h) => h.junctions.length > 0);
		expect(hullIdx).toBeGreaterThanOrEqual(0);
		const jIdx = 0;
		const before = model.hulls[hullIdx].junctions[jIdx].mPosition;

		const doc = buildTrafficDataDocument(model);
		const scene = doc.getRoot().listScenes()[0];
		const root = scene.listChildren().find((n) => n.getName() === 'TrafficData')!;
		const hullNode = root.listChildren()[hullIdx];
		const junctionsGroup = hullNode.listChildren().find((n) => n.getName() === 'JunctionLogicBoxes')!;
		const jNode = junctionsGroup.listChildren()[jIdx];

		const t = jNode.getTranslation();
		const newX = nudge(t[0], 50);
		jNode.setTranslation([newX, t[1], t[2]]);

		const bytes = await writeGlb(doc);
		const modelAfter = await importTrafficDataFromGltf(bytes);

		// Paradise x = glTF x; y unchanged; z flipped through swapYZ pair.
		expect(modelAfter.hulls[hullIdx].junctions[jIdx].mPosition.x).toBe(newX);
		expect(modelAfter.hulls[hullIdx].junctions[jIdx].mPosition.y).toBe(before.y);
		expect(modelAfter.hulls[hullIdx].junctions[jIdx].mPosition.z).toBe(before.z);
		// `w` field (padding / rotation depending on struct) is preserved.
		expect(modelAfter.hulls[hullIdx].junctions[jIdx].mPosition.w).toBe(before.w);
	});

	it('dragging a light trigger keeps w (Y-rotation) intact', async () => {
		const model = loadTraffic();
		const hullIdx = model.hulls.findIndex((h) => h.lightTriggers.length > 0);
		if (hullIdx < 0) return; // fixture may have none
		const before = model.hulls[hullIdx].lightTriggers[0].mPosPlusYRot;

		const doc = buildTrafficDataDocument(model);
		const scene = doc.getRoot().listScenes()[0];
		const root = scene.listChildren().find((n) => n.getName() === 'TrafficData')!;
		const hullNode = root.listChildren()[hullIdx];
		const lightGroup = hullNode.listChildren().find((n) => n.getName() === 'LightTriggers')!;
		const node = lightGroup.listChildren()[0];

		const t = node.getTranslation();
		const newY = nudge(t[1], 25);
		node.setTranslation([t[0], newY, t[2]]);

		const bytes = await writeGlb(doc);
		const modelAfter = await importTrafficDataFromGltf(bytes);

		expect(modelAfter.hulls[hullIdx].lightTriggers[0].mPosPlusYRot.y).toBe(newY);
		// w (Y-rotation) is preserved.
		expect(modelAfter.hulls[hullIdx].lightTriggers[0].mPosPlusYRot.w).toBe(before.w);
	});

	it('dragging a static vehicle updates mTransform[12..14] only', async () => {
		const model = loadTraffic();
		const hullIdx = model.hulls.findIndex((h) => h.staticTrafficVehicles.length > 0);
		if (hullIdx < 0) return;
		const beforeTransform = model.hulls[hullIdx].staticTrafficVehicles[0].mTransform;

		const doc = buildTrafficDataDocument(model);
		const scene = doc.getRoot().listScenes()[0];
		const root = scene.listChildren().find((n) => n.getName() === 'TrafficData')!;
		const hullNode = root.listChildren()[hullIdx];
		const group = hullNode.listChildren().find((n) => n.getName() === 'StaticVehicles')!;
		const node = group.listChildren()[0];

		const t = node.getTranslation();
		const newX = nudge(t[0], 75);
		node.setTranslation([newX, t[1], t[2]]);

		const bytes = await writeGlb(doc);
		const modelAfter = await importTrafficDataFromGltf(bytes);

		const afterTransform = modelAfter.hulls[hullIdx].staticTrafficVehicles[0].mTransform;
		expect(afterTransform[12]).toBe(newX);
		// Everything else in the 4×4 (rotation / scale columns) is preserved.
		for (let i = 0; i < 16; i++) {
			if (i === 12) continue;
			const a = afterTransform[i];
			const b = beforeTransform[i];
			// NaN-safe compare for any non-finite components.
			if (Number.isNaN(b)) {
				expect(Number.isNaN(a)).toBe(true);
			} else {
				expect(a).toBe(b);
			}
		}
	});

	it('no-op export→import stays byte-exact (reconciler does not drift positions)', async () => {
		const model = loadTraffic();
		const doc = buildTrafficDataDocument(model);
		const bytes = await writeGlb(doc);
		const modelAfter = await importTrafficDataFromGltf(bytes);
		// Spot-check the same three groups that the reconciler touches —
		// every position should be bit-for-bit the same.
		const hullIdx = model.hulls.findIndex(
			(h) => h.junctions.length > 0 && h.lightTriggers.length > 0 && h.staticTrafficVehicles.length > 0,
		);
		if (hullIdx < 0) return;
		expect(modelAfter.hulls[hullIdx].junctions[0].mPosition).toEqual(
			model.hulls[hullIdx].junctions[0].mPosition,
		);
		expect(modelAfter.hulls[hullIdx].lightTriggers[0].mPosPlusYRot).toEqual(
			model.hulls[hullIdx].lightTriggers[0].mPosPlusYRot,
		);
		expect(modelAfter.hulls[hullIdx].staticTrafficVehicles[0].mTransform).toEqual(
			model.hulls[hullIdx].staticTrafficVehicles[0].mTransform,
		);
	});
});

// ---------------------------------------------------------------------------
// AISections
// ---------------------------------------------------------------------------

describe('AISections: edit portal node translation → model portal updates', () => {
	it('dragging portal 0 of sections[0] lands on portal.position', async () => {
		const model = loadAI();
		const sectionIdx = model.sections.findIndex((s) => s.portals.length > 0);
		if (sectionIdx < 0) return;
		const before = model.sections[sectionIdx].portals[0].position;

		const doc = buildAISectionsDocument(model);
		const scene = doc.getRoot().listScenes()[0];
		const root = scene.listChildren().find((n) => n.getName() === 'AISections')!;
		const sectionsGroup = root.listChildren().find((n) => n.getName() === 'Sections')!;
		const sectionNode = sectionsGroup.listChildren()[sectionIdx];
		const portalNode = sectionNode.listChildren()[0];

		const t = portalNode.getTranslation();
		const newX = nudge(t[0], 42);
		portalNode.setTranslation([newX, t[1], t[2]]);

		const bytes = await writeGlb(doc);
		const modelAfter = await importAISectionsFromGltf(bytes);

		expect(modelAfter.sections[sectionIdx].portals[0].position.x).toBe(newX);
		expect(modelAfter.sections[sectionIdx].portals[0].position.y).toBe(before.y);
		expect(modelAfter.sections[sectionIdx].portals[0].position.z).toBe(before.z);
	});
});

// ---------------------------------------------------------------------------
// TriggerData
// ---------------------------------------------------------------------------

describe('TriggerData: edit node translations → model box / point positions update', () => {
	it('dragging a landmark updates box.position', async () => {
		const model = loadTrigger();
		if (model.landmarks.length === 0) return;
		const before = model.landmarks[0].box.position;

		const doc = buildTriggerDataDocument(model);
		const scene = doc.getRoot().listScenes()[0];
		const root = scene.listChildren().find((n) => n.getName() === 'TriggerData')!;
		const group = root.listChildren().find((n) => n.getName() === 'Landmarks')!;
		const node = group.listChildren()[0];

		const t = node.getTranslation();
		const newZ = nudge(t[2], -33);
		node.setTranslation([t[0], t[1], newZ]);

		const bytes = await writeGlb(doc);
		const modelAfter = await importTriggerDataFromGltf(bytes);

		// Paradise z = -glTF z (coords swap); verify the round-trip is consistent.
		expect(modelAfter.landmarks[0].box.position.z).toBe(Math.fround(-newZ));
		expect(modelAfter.landmarks[0].box.position.x).toBe(before.x);
		expect(modelAfter.landmarks[0].box.position.y).toBe(before.y);
	});

	it('dragging a spawn location updates position.{x,y,z} and preserves w', async () => {
		const model = loadTrigger();
		if (model.spawnLocations.length === 0) return;
		const before = model.spawnLocations[0].position;

		const doc = buildTriggerDataDocument(model);
		const scene = doc.getRoot().listScenes()[0];
		const root = scene.listChildren().find((n) => n.getName() === 'TriggerData')!;
		const group = root.listChildren().find((n) => n.getName() === 'SpawnLocations')!;
		const node = group.listChildren()[0];

		const t = node.getTranslation();
		const newX = nudge(t[0], 11);
		node.setTranslation([newX, t[1], t[2]]);

		const bytes = await writeGlb(doc);
		const modelAfter = await importTriggerDataFromGltf(bytes);

		expect(modelAfter.spawnLocations[0].position.x).toBe(newX);
		expect(modelAfter.spawnLocations[0].position.w).toBe(before.w);
	});

	it('no-op round-trip: every box position is bit-preserved by the reconciler', async () => {
		const model = loadTrigger();
		const doc = buildTriggerDataDocument(model);
		const bytes = await writeGlb(doc);
		const modelAfter = await importTriggerDataFromGltf(bytes);
		// Random access spot-check across four groups.
		if (model.landmarks.length > 0) {
			expect(modelAfter.landmarks[0].box.position).toEqual(model.landmarks[0].box.position);
		}
		if (model.genericRegions.length > 0) {
			expect(modelAfter.genericRegions[0].box.position).toEqual(
				model.genericRegions[0].box.position,
			);
		}
		if (model.roamingLocations.length > 0) {
			expect(modelAfter.roamingLocations[0].position).toEqual(
				model.roamingLocations[0].position,
			);
		}
		if (model.spawnLocations.length > 0) {
			expect(modelAfter.spawnLocations[0].position).toEqual(
				model.spawnLocations[0].position,
			);
		}
	});
});

// Silence unused-import lint.
void paradiseToGltf;

// Phase 5b tests — add/delete entries in Blender, re-import lands the change.
//
// The four resources split into two architectural shapes:
//   - StreetData: nodes are authoritative; duplicating/deleting a node
//     directly changes the model array length. No reconciler work needed.
//   - TrafficData / AISections / TriggerData: scene.extras is authoritative;
//     the reconciler overlays per-group node count onto the extras arrays
//     (duplicate-last on extend, truncate on shrink).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NodeIO } from '@gltf-transform/core';

import { parseBundle } from '../bundle';
import { RESOURCE_TYPE_IDS } from '../types';
import { extractResourceSize, isCompressed, decompressData } from '../resourceManager';
import { parseStreetDataData, type ParsedStreetData } from '../streetData';
import { parseTrafficDataData, type ParsedTrafficDataRetail } from '../trafficData';
import { parseAISectionsData, type ParsedAISectionsV12 } from '../aiSections';
import { parseTriggerDataData, type ParsedTriggerData } from '../triggerData';
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
function loadTraffic(): ParsedTrafficDataRetail {
	const parsed = parseTrafficDataData(
		extractTypedResource(
			path.resolve(__dirname, '../../../../example/B5TRAFFIC.BNDL'),
			RESOURCE_TYPE_IDS.TRAFFIC_DATA,
		),
		true,
	);
	if (parsed.kind === 'v22') throw new Error(`Expected retail fixture, got ${parsed.kind}`);
	return parsed;
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

async function writeGlb(
	doc: import('@gltf-transform/core').Document,
): Promise<Uint8Array> {
	return new NodeIO().writeBinary(doc);
}

// ---------------------------------------------------------------------------
// StreetData — node-authoritative, so duplicating a node already creates a
// new entry. Tests lock in that invariant.
// ---------------------------------------------------------------------------

describe('StreetData: add/delete via Blender nodes', () => {
	it('deleting a Junction node drops the junction on re-import', async () => {
		const model = loadStreet();
		const doc = buildStreetDataDocument(model);
		const root = doc
			.getRoot()
			.listScenes()[0]
			.listChildren()
			.find((n) => n.getName() === 'StreetData')!;
		const junctionsGroup = root.listChildren().find((n) => n.getName() === 'Junctions')!;

		// Delete the last junction node.
		const last = junctionsGroup.listChildren()[junctionsGroup.listChildren().length - 1];
		junctionsGroup.removeChild(last);
		last.dispose();

		const bytes = await writeGlb(doc);
		const modelAfter = await importStreetDataFromGltf(bytes);
		expect(modelAfter.junctions.length).toBe(model.junctions.length - 1);
		// Roads unchanged.
		expect(modelAfter.roads.length).toBe(model.roads.length);
	});

	it('deleting one Road + matching Challenge drops both', async () => {
		const model = loadStreet();
		const doc = buildStreetDataDocument(model);
		const root = doc
			.getRoot()
			.listScenes()[0]
			.listChildren()
			.find((n) => n.getName() === 'StreetData')!;
		const roadsGroup = root.listChildren().find((n) => n.getName() === 'Roads')!;
		const challengesGroup = root.listChildren().find((n) => n.getName() === 'ChallengeParScores')!;

		const lastRoad = roadsGroup.listChildren()[roadsGroup.listChildren().length - 1];
		const lastChallenge = challengesGroup.listChildren()[challengesGroup.listChildren().length - 1];
		roadsGroup.removeChild(lastRoad);
		lastRoad.dispose();
		challengesGroup.removeChild(lastChallenge);
		lastChallenge.dispose();

		const bytes = await writeGlb(doc);
		const modelAfter = await importStreetDataFromGltf(bytes);
		expect(modelAfter.roads.length).toBe(model.roads.length - 1);
		expect(modelAfter.challenges.length).toBe(model.challenges.length - 1);
	});
});

// ---------------------------------------------------------------------------
// TrafficData
// ---------------------------------------------------------------------------

describe('TrafficData: add/delete via Blender nodes', () => {
	it('deleting a JunctionLogicBox node truncates the extras array', async () => {
		const model = loadTraffic();
		const hullIdx = model.hulls.findIndex((h) => h.junctions.length > 0);
		if (hullIdx < 0) return;
		const beforeCount = model.hulls[hullIdx].junctions.length;

		const doc = buildTrafficDataDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];
		const hullNode = root.listChildren()[hullIdx];
		const group = hullNode.listChildren().find((n) => n.getName() === 'JunctionLogicBoxes')!;
		const last = group.listChildren()[group.listChildren().length - 1];
		group.removeChild(last);
		last.dispose();

		const bytes = await writeGlb(doc);
		const modelAfter = await importTrafficDataFromGltf(bytes);
		expect(modelAfter.hulls[hullIdx].junctions.length).toBe(beforeCount - 1);
	});

	it('duplicating a LightTrigger node extends the extras array with a clone', async () => {
		const model = loadTraffic();
		const hullIdx = model.hulls.findIndex((h) => h.lightTriggers.length > 0);
		if (hullIdx < 0) return;
		const beforeCount = model.hulls[hullIdx].lightTriggers.length;
		const lastBefore = model.hulls[hullIdx].lightTriggers[beforeCount - 1];

		const doc = buildTrafficDataDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];
		const hullNode = root.listChildren()[hullIdx];
		const group = hullNode.listChildren().find((n) => n.getName() === 'LightTriggers')!;
		// "Duplicate" = add a new placeholder node at the end.
		const copy = doc.createNode(`LightTrigger ${beforeCount}`);
		copy.setTranslation(group.listChildren()[beforeCount - 1].getTranslation());
		group.addChild(copy);

		const bytes = await writeGlb(doc);
		const modelAfter = await importTrafficDataFromGltf(bytes);
		expect(modelAfter.hulls[hullIdx].lightTriggers.length).toBe(beforeCount + 1);
		// The duplicated entry inherits non-position fields from the last one.
		const last = modelAfter.hulls[hullIdx].lightTriggers[beforeCount];
		expect(last.mDimensions).toEqual(lastBefore.mDimensions);
	});

	it('duplicating a Section node extends the extras array', async () => {
		const model = loadTraffic();
		const hullIdx = model.hulls.findIndex((h) => h.sections.length > 0);
		expect(hullIdx).toBeGreaterThanOrEqual(0);
		const beforeCount = model.hulls[hullIdx].sections.length;

		const doc = buildTrafficDataDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];
		const hullNode = root.listChildren()[hullIdx];
		const sectionsGroup = hullNode.listChildren().find((n) => n.getName() === 'Sections')!;
		const copy = doc.createNode(`Section ${beforeCount} (span=copy)`);
		sectionsGroup.addChild(copy);

		const bytes = await writeGlb(doc);
		const modelAfter = await importTrafficDataFromGltf(bytes);
		expect(modelAfter.hulls[hullIdx].sections.length).toBe(beforeCount + 1);
	});
});

// ---------------------------------------------------------------------------
// AISections
// ---------------------------------------------------------------------------

describe('AISections: add/delete via Blender nodes', () => {
	it('deleting a Section node truncates the sections array', async () => {
		const model = loadAI();
		const beforeCount = model.sections.length;
		const doc = buildAISectionsDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];
		const sectionsGroup = root.listChildren().find((n) => n.getName() === 'Sections')!;
		const last = sectionsGroup.listChildren()[sectionsGroup.listChildren().length - 1];
		sectionsGroup.removeChild(last);
		last.dispose();

		const bytes = await writeGlb(doc);
		const modelAfter = await importAISectionsFromGltf(bytes);
		expect(modelAfter.sections.length).toBe(beforeCount - 1);
	});

	it('deleting a Portal child truncates that section portals array', async () => {
		const model = loadAI();
		const sectionIdx = model.sections.findIndex((s) => s.portals.length > 1);
		if (sectionIdx < 0) return;
		const beforePortalCount = model.sections[sectionIdx].portals.length;

		const doc = buildAISectionsDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];
		const sectionsGroup = root.listChildren().find((n) => n.getName() === 'Sections')!;
		const sectionNode = sectionsGroup.listChildren()[sectionIdx];
		const lastPortal = sectionNode.listChildren()[sectionNode.listChildren().length - 1];
		sectionNode.removeChild(lastPortal);
		lastPortal.dispose();

		const bytes = await writeGlb(doc);
		const modelAfter = await importAISectionsFromGltf(bytes);
		expect(modelAfter.sections[sectionIdx].portals.length).toBe(beforePortalCount - 1);
	});
});

// ---------------------------------------------------------------------------
// TriggerData
// ---------------------------------------------------------------------------

describe('TriggerData: add/delete via Blender nodes', () => {
	it('deleting a Landmark node truncates the landmarks array', async () => {
		const model = loadTrigger();
		if (model.landmarks.length === 0) return;
		const beforeCount = model.landmarks.length;
		const doc = buildTriggerDataDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];
		const group = root.listChildren().find((n) => n.getName() === 'Landmarks')!;
		const last = group.listChildren()[group.listChildren().length - 1];
		group.removeChild(last);
		last.dispose();

		const bytes = await writeGlb(doc);
		const modelAfter = await importTriggerDataFromGltf(bytes);
		expect(modelAfter.landmarks.length).toBe(beforeCount - 1);
	});

	it('duplicating a GenericRegion node extends the array with a clone', async () => {
		const model = loadTrigger();
		if (model.genericRegions.length === 0) return;
		const beforeCount = model.genericRegions.length;
		const lastBefore = model.genericRegions[beforeCount - 1];

		const doc = buildTriggerDataDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];
		const group = root.listChildren().find((n) => n.getName() === 'GenericRegions')!;
		const sourceNode = group.listChildren()[beforeCount - 1];
		const copy = doc.createNode(`GenericRegion ${beforeCount} (copy)`);
		copy.setTranslation(sourceNode.getTranslation());
		group.addChild(copy);

		const bytes = await writeGlb(doc);
		const modelAfter = await importTriggerDataFromGltf(bytes);
		expect(modelAfter.genericRegions.length).toBe(beforeCount + 1);
		const clone = modelAfter.genericRegions[beforeCount];
		// Non-position fields (groupId, genericType, etc.) inherited from the last.
		expect(clone.groupId).toBe(lastBefore.groupId);
		expect(clone.genericType).toBe(lastBefore.genericType);
	});

	it('duplicating a SpawnLocation extends the spawnLocations array', async () => {
		const model = loadTrigger();
		if (model.spawnLocations.length === 0) return;
		const beforeCount = model.spawnLocations.length;
		const lastBefore = model.spawnLocations[beforeCount - 1];

		const doc = buildTriggerDataDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];
		const group = root.listChildren().find((n) => n.getName() === 'SpawnLocations')!;
		const sourceNode = group.listChildren()[beforeCount - 1];
		const copy = doc.createNode(`SpawnLocation ${beforeCount} (copy)`);
		copy.setTranslation(sourceNode.getTranslation());
		group.addChild(copy);

		const bytes = await writeGlb(doc);
		const modelAfter = await importTriggerDataFromGltf(bytes);
		expect(modelAfter.spawnLocations.length).toBe(beforeCount + 1);
		const clone = modelAfter.spawnLocations[beforeCount];
		// Clone preserves junkyardId (bigint) and type.
		expect(clone.junkyardId).toBe(lastBefore.junkyardId);
		expect(clone.type).toBe(lastBefore.type);
	});
});

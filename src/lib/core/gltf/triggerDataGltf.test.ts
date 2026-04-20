// TriggerData ↔ glTF round-trip tests.
//
// Contract: writer-idempotent. TriggerData's writer is stable after the first
// pass but not byte-exact with the raw bundle; the glTF round-trip must match
// writeTriggerDataData's baseline output.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../bundle';
import { RESOURCE_TYPE_IDS } from '../types';
import { extractResourceSize, isCompressed, decompressData } from '../resourceManager';
import {
	parseTriggerDataData,
	writeTriggerDataData,
	type ParsedTriggerData,
} from '../triggerData';
import {
	buildTriggerDataDocument,
	exportTriggerDataToGltf,
	exportTriggerDataToGltfJson,
	importTriggerDataFromGltf,
	readTriggerDataFromDocument,
} from './triggerDataGltf';

const FIXTURE = path.resolve(__dirname, '../../../../example/TRIGGERS.DAT');

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadFixtureModel() {
	const raw = fs.readFileSync(FIXTURE);
	const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find(
		(r) => r.resourceTypeId === RESOURCE_TYPE_IDS.TRIGGER_DATA,
	);
	if (!resource) throw new Error('fixture missing TriggerData resource');
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
	if (!extracted) throw new Error('TriggerData resource had no populated block');
	const model = parseTriggerDataData(extracted, true);
	const baselineWrite = writeTriggerDataData(model, true);
	return { model, raw: extracted, baselineWrite };
}

describe('triggerData glTF round-trip', () => {
	it('glb export → import → write matches direct-write baseline', async () => {
		const { model, baselineWrite } = loadFixtureModel();
		const gltfBytes = await exportTriggerDataToGltf(model);
		const modelAfter = await importTriggerDataFromGltf(gltfBytes);
		const postWrite = writeTriggerDataData(modelAfter, true);
		expect(sha1(postWrite)).toBe(sha1(baselineWrite));
	});

	it('json .gltf export → import → write matches baseline', async () => {
		const { model, baselineWrite } = loadFixtureModel();
		const gltfJson = await exportTriggerDataToGltfJson(model);
		const modelAfter = await importTriggerDataFromGltf(gltfJson);
		const postWrite = writeTriggerDataData(modelAfter, true);
		expect(sha1(postWrite)).toBe(sha1(baselineWrite));
	});

	it('glb export is deterministic across passes', async () => {
		const { model } = loadFixtureModel();
		const a = await exportTriggerDataToGltf(model);
		const b = await exportTriggerDataToGltf(model);
		expect(sha1(a)).toBe(sha1(b));
	});

	it('scene has the 8 standard trigger group names under TriggerData', () => {
		const { model } = loadFixtureModel();
		const doc = buildTriggerDataDocument(model);
		const scene = doc.getRoot().listScenes()[0];
		const root = scene.listChildren()[0];
		expect(root.getName()).toBe('TriggerData');
		const groupNames = root.listChildren().map((n) => n.getName()).sort();
		expect(groupNames).toEqual(
			[
				'Blackspots',
				'GenericRegions',
				'Killzones',
				'Landmarks',
				'RoamingLocations',
				'SignatureStunts',
				'SpawnLocations',
				'VFXBoxRegions',
			].sort(),
		);
	});

	it('landmark counts in visualization match model', () => {
		const { model } = loadFixtureModel();
		const doc = buildTriggerDataDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];
		const groups = new Map(
			root.listChildren().map((n) => [n.getName(), n.listChildren().length]),
		);
		expect(groups.get('Landmarks')).toBe(model.landmarks.length);
		expect(groups.get('GenericRegions')).toBe(model.genericRegions.length);
		expect(groups.get('Blackspots')).toBe(model.blackspots.length);
		expect(groups.get('VFXBoxRegions')).toBe(model.vfxBoxRegions.length);
		expect(groups.get('Killzones')).toBe(model.killzones.length);
		expect(groups.get('SignatureStunts')).toBe(model.signatureStunts.length);
		expect(groups.get('RoamingLocations')).toBe(model.roamingLocations.length);
		expect(groups.get('SpawnLocations')).toBe(model.spawnLocations.length);
	});

	it('bigint signatureStunt IDs and killzone regionIds survive round-trip', async () => {
		const { model } = loadFixtureModel();
		const gltfBytes = await exportTriggerDataToGltf(model);
		const modelAfter = await importTriggerDataFromGltf(gltfBytes);
		for (let i = 0; i < model.signatureStunts.length; i++) {
			expect(modelAfter.signatureStunts[i].id).toBe(model.signatureStunts[i].id);
			expect(modelAfter.signatureStunts[i].camera).toBe(model.signatureStunts[i].camera);
		}
		for (let i = 0; i < model.killzones.length; i++) {
			for (let j = 0; j < model.killzones[i].regionIds.length; j++) {
				expect(modelAfter.killzones[i].regionIds[j]).toBe(
					model.killzones[i].regionIds[j],
				);
			}
		}
	});

	it('editing a landmark ID round-trips through glTF', async () => {
		const { model } = loadFixtureModel();
		const landmarks = model.landmarks.slice();
		if (landmarks.length === 0) return;
		landmarks[0] = { ...landmarks[0], id: 0x13371337 };
		const edited: ParsedTriggerData = { ...model, landmarks };

		const gltfBytes = await exportTriggerDataToGltf(edited);
		const modelAfter = await importTriggerDataFromGltf(gltfBytes);
		expect(modelAfter.landmarks[0].id).toBe(0x13371337);
	});

	it('rejects a glTF without paradiseBundle.triggerData extras', async () => {
		const { model } = loadFixtureModel();
		const doc = buildTriggerDataDocument(model);
		doc.getRoot().listScenes()[0].setExtras({});
		expect(() => readTriggerDataFromDocument(doc)).toThrow(/paradiseBundle/);
	});
});

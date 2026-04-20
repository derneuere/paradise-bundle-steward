// StreetData ↔ glTF round-trip tests.
//
// Contract (from docs/worldlogic-gltf-roundtrip.md):
//   - Byte-exact writer-idempotent round-trip: writeStreetDataData applied
//     after a glTF export/import must produce the same bytes as writing the
//     original model directly.
//   - glTF export is deterministic: the same model → the same bytes.
//   - All per-entry fields survive the round-trip (bigints, padding bytes,
//     ascii names, BitArray bytes) so mutations made in Blender are real.
//   - Add/delete/edit at the glTF layer round-trip cleanly.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../bundle';
import { RESOURCE_TYPE_IDS } from '../types';
import { extractResourceSize, isCompressed, decompressData } from '../resourceManager';
import {
	parseStreetDataData,
	writeStreetDataData,
	type ParsedStreetData,
} from '../streetData';
import {
	buildStreetDataDocument,
	exportStreetDataToGltf,
	exportStreetDataToGltfJson,
	importStreetDataFromDocument,
	importStreetDataFromGltf,
} from './streetDataGltf';

const FIXTURE = path.resolve(__dirname, '../../../../example/BTTSTREETDATA.DAT');

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

function loadFixtureModel(): { model: ParsedStreetData; baselineWrite: Uint8Array } {
	const raw = fs.readFileSync(FIXTURE);
	const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find(
		(r) => r.resourceTypeId === RESOURCE_TYPE_IDS.STREET_DATA,
	);
	if (!resource) throw new Error('fixture missing StreetData resource');
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
	if (!extracted) throw new Error('StreetData resource had no populated block');
	const model = parseStreetDataData(extracted);
	const baselineWrite = writeStreetDataData(model);
	return { model, baselineWrite };
}

describe('streetData glTF round-trip', () => {
	it('glb export → import → write matches direct-write baseline byte-for-byte', async () => {
		const { model, baselineWrite } = loadFixtureModel();
		const gltfBytes = await exportStreetDataToGltf(model);
		const modelAfter = await importStreetDataFromGltf(gltfBytes);
		const postWrite = writeStreetDataData(modelAfter);

		expect(postWrite.byteLength).toBe(baselineWrite.byteLength);
		expect(sha1(postWrite)).toBe(sha1(baselineWrite));
		expect(bytesEqual(postWrite, baselineWrite)).toBe(true);
	});

	it('json .gltf export → import → write matches direct-write baseline', async () => {
		const { model, baselineWrite } = loadFixtureModel();
		const gltfJson = await exportStreetDataToGltfJson(model);
		const modelAfter = await importStreetDataFromGltf(gltfJson);
		const postWrite = writeStreetDataData(modelAfter);

		expect(sha1(postWrite)).toBe(sha1(baselineWrite));
	});

	it('glb export is deterministic across passes', async () => {
		const { model } = loadFixtureModel();
		const a = await exportStreetDataToGltf(model);
		const b = await exportStreetDataToGltf(model);
		expect(a.byteLength).toBe(b.byteLength);
		expect(sha1(a)).toBe(sha1(b));
	});

	it('json .gltf export is deterministic across passes', async () => {
		const { model } = loadFixtureModel();
		const a = await exportStreetDataToGltfJson(model);
		const b = await exportStreetDataToGltfJson(model);
		expect(a.byteLength).toBe(b.byteLength);
		expect(sha1(a)).toBe(sha1(b));
	});

	it('scene has a StreetData root group with four child collections', () => {
		const { model } = loadFixtureModel();
		const doc = buildStreetDataDocument(model);
		const scene = doc.getRoot().listScenes()[0];
		const roots = scene.listChildren();
		expect(roots).toHaveLength(1);
		expect(roots[0].getName()).toBe('StreetData');
		const groupNames = roots[0].listChildren().map((n) => n.getName()).sort();
		expect(groupNames).toEqual(
			['ChallengeParScores', 'Junctions', 'Roads', 'Streets'].sort(),
		);
	});

	it('encodes scene.extras.paradiseBundle.streetData.version', () => {
		const { model } = loadFixtureModel();
		const doc = buildStreetDataDocument(model);
		const scene = doc.getRoot().listScenes()[0];
		const extras = scene.getExtras() as Record<string, unknown>;
		const pb = extras.paradiseBundle as Record<string, unknown>;
		const sd = pb.streetData as Record<string, unknown>;
		expect(sd.version).toBe(model.miVersion);
	});

	it('node counts in each group match model array lengths', () => {
		const { model } = loadFixtureModel();
		const doc = buildStreetDataDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];
		const groups = new Map(
			root.listChildren().map((n) => [n.getName(), n.listChildren().length]),
		);
		expect(groups.get('Junctions')).toBe(model.junctions.length);
		expect(groups.get('Roads')).toBe(model.roads.length);
		expect(groups.get('Streets')).toBe(model.streets.length);
		expect(groups.get('ChallengeParScores')).toBe(model.challenges.length);
	});

	it('road translation reproduces mReferencePosition on import', async () => {
		const { model } = loadFixtureModel();
		const gltfBytes = await exportStreetDataToGltf(model);
		const modelAfter = await importStreetDataFromGltf(gltfBytes);
		for (let i = 0; i < model.roads.length; i++) {
			const before = model.roads[i].mReferencePosition;
			const after = modelAfter.roads[i].mReferencePosition;
			expect(after.x).toBeCloseTo(before.x, 3);
			expect(after.y).toBeCloseTo(before.y, 3);
			expect(after.z).toBeCloseTo(before.z, 3);
		}
	});

	it('bigint road IDs survive round-trip exactly', async () => {
		const { model } = loadFixtureModel();
		const gltfBytes = await exportStreetDataToGltf(model);
		const modelAfter = await importStreetDataFromGltf(gltfBytes);
		for (let i = 0; i < model.roads.length; i++) {
			expect(modelAfter.roads[i].mId).toBe(model.roads[i].mId);
			expect(modelAfter.roads[i].miRoadLimitId0).toBe(model.roads[i].miRoadLimitId0);
			expect(modelAfter.roads[i].miRoadLimitId1).toBe(model.roads[i].miRoadLimitId1);
		}
	});

	it('junction macName and padding bytes survive round-trip', async () => {
		const { model } = loadFixtureModel();
		const gltfBytes = await exportStreetDataToGltf(model);
		const modelAfter = await importStreetDataFromGltf(gltfBytes);
		for (let i = 0; i < model.junctions.length; i++) {
			expect(modelAfter.junctions[i].macName).toBe(model.junctions[i].macName);
			expect(modelAfter.junctions[i].superSpanBase.padding).toEqual(
				model.junctions[i].superSpanBase.padding,
			);
		}
	});

	it('challenge BitArrays and rival CgsIDs survive round-trip', async () => {
		const { model } = loadFixtureModel();
		const gltfBytes = await exportStreetDataToGltf(model);
		const modelAfter = await importStreetDataFromGltf(gltfBytes);
		for (let i = 0; i < model.challenges.length; i++) {
			const b = model.challenges[i];
			const a = modelAfter.challenges[i];
			expect(a.challengeData.mDirty).toEqual(b.challengeData.mDirty);
			expect(a.challengeData.mValidScore).toEqual(b.challengeData.mValidScore);
			expect(a.challengeData.mScoreList.maScores).toEqual(
				b.challengeData.mScoreList.maScores,
			);
			expect(a.mRivals[0]).toBe(b.mRivals[0]);
			expect(a.mRivals[1]).toBe(b.mRivals[1]);
		}
	});

	it('editing a road debug name in the model and round-tripping surfaces it', async () => {
		const { model } = loadFixtureModel();
		const edited = {
			...model,
			roads: model.roads.map((r, i) =>
				i === 0 ? { ...r, macDebugName: 'EDITED_VIA_GLTF' } : r,
			),
		};
		const gltfBytes = await exportStreetDataToGltf(edited);
		const modelAfter = await importStreetDataFromGltf(gltfBytes);
		expect(modelAfter.roads[0].macDebugName).toBe('EDITED_VIA_GLTF');
	});

	it('deleting a road+challenge pair via model edit round-trips correctly', async () => {
		const { model } = loadFixtureModel();
		const edited: ParsedStreetData = {
			...model,
			roads: model.roads.slice(0, -1),
			challenges: model.challenges.slice(0, -1),
		};
		const gltfBytes = await exportStreetDataToGltf(edited);
		const modelAfter = await importStreetDataFromGltf(gltfBytes);
		expect(modelAfter.roads.length).toBe(model.roads.length - 1);
		expect(modelAfter.challenges.length).toBe(model.challenges.length - 1);
		// Writer must still accept the edited model.
		const out = writeStreetDataData(modelAfter);
		expect(out.byteLength).toBeGreaterThan(0);
	});

	it('adding a street via model edit round-trips correctly', async () => {
		const { model } = loadFixtureModel();
		const extraStreet = {
			superSpanBase: {
				miRoadIndex: 0,
				miSpanIndex: 999,
				padding: [0x12, 0x34],
				meSpanType: 0,
			},
			mAiInfo: { muMaxSpeedMPS: 42, muMinSpeedMPS: 7 },
			padding: [0x56, 0x78],
		};
		const edited = { ...model, streets: [...model.streets, extraStreet] };
		const gltfBytes = await exportStreetDataToGltf(edited);
		const modelAfter = await importStreetDataFromGltf(gltfBytes);
		expect(modelAfter.streets.length).toBe(model.streets.length + 1);
		const last = modelAfter.streets[modelAfter.streets.length - 1];
		expect(last.mAiInfo.muMaxSpeedMPS).toBe(42);
		expect(last.mAiInfo.muMinSpeedMPS).toBe(7);
		expect(last.superSpanBase.miSpanIndex).toBe(999);
		expect(last.superSpanBase.padding).toEqual([0x12, 0x34]);
		expect(last.padding).toEqual([0x56, 0x78]);
	});

	it('rejects a glTF without the paradiseBundle.streetData scene extras', async () => {
		// Import a .glb produced from a valid model, but strip extras first.
		const { model } = loadFixtureModel();
		const doc = buildStreetDataDocument(model);
		doc.getRoot().listScenes()[0].setExtras({});
		expect(() => importStreetDataFromDocument(doc)).toThrow(/paradiseBundle/);
	});
});

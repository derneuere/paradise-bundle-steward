// AISections ↔ glTF round-trip tests.
//
// Contract: byte-exact. AISections has a byte-exact writer, so the glTF
// round-trip must preserve every field including BoundaryLine f32s, 4-corner
// polygons, portal boundary-line arrays, and reset-pair indices.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../bundle';
import { RESOURCE_TYPE_IDS } from '../types';
import { extractResourceSize, isCompressed, decompressData } from '../resourceManager';
import {
	parseAISectionsData,
	writeAISectionsData,
	SectionSpeed,
	AISectionFlag,
	type ParsedAISectionsV12,
} from '../aiSections';
import {
	buildAISectionsDocument,
	exportAISectionsToGltf,
	exportAISectionsToGltfJson,
	importAISectionsFromGltf,
	readAISectionsFromDocument,
} from './aiSectionsGltf';

const FIXTURE = path.resolve(__dirname, '../../../../example/AI.DAT');

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadFixtureModel() {
	const raw = fs.readFileSync(FIXTURE);
	const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find(
		(r) => r.resourceTypeId === RESOURCE_TYPE_IDS.AI_SECTIONS,
	);
	if (!resource) throw new Error('fixture missing AISections resource');
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
	if (!extracted) throw new Error('AISections resource had no populated block');
	const parsed = parseAISectionsData(extracted, true);
	if (parsed.kind !== 'v12') throw new Error(`Expected v12 fixture, got ${parsed.kind}`);
	const model: ParsedAISectionsV12 = parsed;
	const baselineWrite = writeAISectionsData(model, true);
	return { model, raw: extracted, baselineWrite };
}

describe('aiSections glTF round-trip', () => {
	it('glb export → import → write is byte-identical to direct-write baseline', async () => {
		const { model, baselineWrite } = loadFixtureModel();
		const gltfBytes = await exportAISectionsToGltf(model);
		const modelAfter = await importAISectionsFromGltf(gltfBytes);
		const postWrite = writeAISectionsData(modelAfter, true);

		expect(postWrite.byteLength).toBe(baselineWrite.byteLength);
		expect(sha1(postWrite)).toBe(sha1(baselineWrite));
	});

	it('json .gltf export → import → write is byte-identical to baseline', async () => {
		const { model, baselineWrite } = loadFixtureModel();
		const gltfJson = await exportAISectionsToGltfJson(model);
		const modelAfter = await importAISectionsFromGltf(gltfJson);
		const postWrite = writeAISectionsData(modelAfter, true);
		expect(sha1(postWrite)).toBe(sha1(baselineWrite));
	});

	it('glb export is deterministic across passes', async () => {
		const { model } = loadFixtureModel();
		const a = await exportAISectionsToGltf(model);
		const b = await exportAISectionsToGltf(model);
		expect(sha1(a)).toBe(sha1(b));
	});

	it('scene has an AISections root group with Sections and SectionResetPairs', () => {
		const { model } = loadFixtureModel();
		const doc = buildAISectionsDocument(model);
		const scene = doc.getRoot().listScenes()[0];
		const roots = scene.listChildren();
		expect(roots).toHaveLength(1);
		expect(roots[0].getName()).toBe('AISections');
		const groupNames = roots[0].listChildren().map((n) => n.getName()).sort();
		expect(groupNames).toEqual(['SectionResetPairs', 'Sections']);
	});

	it('section counts in visualization match model', () => {
		const { model } = loadFixtureModel();
		const doc = buildAISectionsDocument(model);
		const root = doc.getRoot().listScenes()[0].listChildren()[0];
		const sectionsGroup = root.listChildren().find((n) => n.getName() === 'Sections');
		expect(sectionsGroup).toBeDefined();
		expect(sectionsGroup!.listChildren().length).toBe(model.sections.length);
	});

	it('every section corners and portals survive round-trip', async () => {
		const { model } = loadFixtureModel();
		const gltfBytes = await exportAISectionsToGltf(model);
		const modelAfter = await importAISectionsFromGltf(gltfBytes);
		expect(modelAfter.sections.length).toBe(model.sections.length);
		for (let i = 0; i < model.sections.length; i++) {
			const a = model.sections[i];
			const b = modelAfter.sections[i];
			expect(b.corners).toEqual(a.corners);
			expect(b.portals.length).toBe(a.portals.length);
			for (let pi = 0; pi < a.portals.length; pi++) {
				expect(b.portals[pi].position).toEqual(a.portals[pi].position);
				expect(b.portals[pi].linkSection).toBe(a.portals[pi].linkSection);
				expect(b.portals[pi].boundaryLines).toEqual(a.portals[pi].boundaryLines);
			}
		}
	});

	it('editing a section speed at the model layer round-trips to byte-exact bundle', async () => {
		const { model } = loadFixtureModel();
		const sections = model.sections.slice();
		sections[0] = { ...sections[0], speed: SectionSpeed.E_SECTION_SPEED_VERY_FAST };
		const edited: ParsedAISectionsV12 = { ...model, sections };

		const baselineEdited = writeAISectionsData(edited, true);
		const gltfBytes = await exportAISectionsToGltf(edited);
		const modelAfter = await importAISectionsFromGltf(gltfBytes);
		const postWrite = writeAISectionsData(modelAfter, true);
		expect(sha1(postWrite)).toBe(sha1(baselineEdited));
		expect(modelAfter.sections[0].speed).toBe(SectionSpeed.E_SECTION_SPEED_VERY_FAST);
	});

	it('toggling a flag bit survives round-trip', async () => {
		const { model } = loadFixtureModel();
		const sections = model.sections.slice();
		const before = sections[0].flags;
		const after = (before ^ AISectionFlag.SHORTCUT) & 0xFF;
		sections[0] = { ...sections[0], flags: after };
		const edited: ParsedAISectionsV12 = { ...model, sections };

		const gltfBytes = await exportAISectionsToGltf(edited);
		const modelAfter = await importAISectionsFromGltf(gltfBytes);
		expect(modelAfter.sections[0].flags).toBe(after);
	});

	it('rejects a glTF without paradiseBundle.aiSections extras', async () => {
		const { model } = loadFixtureModel();
		const doc = buildAISectionsDocument(model);
		doc.getRoot().listScenes()[0].setExtras({});
		expect(() => readAISectionsFromDocument(doc)).toThrow(/paradiseBundle/);
	});
});

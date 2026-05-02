// Cross-platform self-consistency tests for the AI Sections parser+writer.
//
// The byte-roundtrip per-platform tests live in registry.test.ts (auto-
// generated from the handler's fixture list). This file pins the stronger
// invariant: re-encoding a real PC payload as PS3 (BE), reparsing it, and
// re-encoding back to PC must produce bytes identical to the source. Same
// loop in reverse for the PS3 fixture. Together those prove the writer is
// endianness-clean — no LE/BE-only branches, no values silently lost.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle, writeBundleFresh } from './bundle';
import { PLATFORMS, RESOURCE_TYPE_IDS } from './types';
import { extractResourceSize, isCompressed, decompressData } from './resourceManager';
import { parseAISectionsData, writeAISectionsData, type ParsedAISectionsV12 } from './aiSections';

const PC_FIXTURE  = path.resolve(__dirname, '../../../example/AI.DAT');
const PS3_FIXTURE = path.resolve(__dirname, '../../../example/ps3/AI.DAT');

function loadResourceBytes(fixturePath: string): Uint8Array {
	const raw = fs.readFileSync(fixturePath);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	const buffer = bytes.buffer;
	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === RESOURCE_TYPE_IDS.AI_SECTIONS);
	if (!resource) throw new Error(`Fixture ${fixturePath} missing AI Sections resource`);
	for (let bi = 0; bi < 3; bi++) {
		const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[bi]);
		if (size <= 0) continue;
		const base = bundle.header.resourceDataOffsets[bi] >>> 0;
		const rel = resource.diskOffsets[bi] >>> 0;
		const start = (base + rel) >>> 0;
		let slice: Uint8Array = new Uint8Array(buffer.slice(start, start + size));
		if (isCompressed(slice)) slice = decompressData(slice);
		return slice;
	}
	throw new Error('No populated data block in AI Sections resource');
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

function expectModelsEqual(a: ParsedAISectionsV12, b: ParsedAISectionsV12) {
	expect(a.version).toBe(b.version);
	expect(a.sectionMinSpeeds).toEqual(b.sectionMinSpeeds);
	expect(a.sectionMaxSpeeds).toEqual(b.sectionMaxSpeeds);
	expect(a.sections.length).toBe(b.sections.length);
	expect(a.sectionResetPairs.length).toBe(b.sectionResetPairs.length);
	// Spot-check a few section fields to catch endian-flipped scalars.
	for (let i = 0; i < a.sections.length; i++) {
		expect(a.sections[i].id).toBe(b.sections[i].id);
		expect(a.sections[i].spanIndex).toBe(b.sections[i].spanIndex);
		expect(a.sections[i].speed).toBe(b.sections[i].speed);
		expect(a.sections[i].flags).toBe(b.sections[i].flags);
		expect(a.sections[i].portals.length).toBe(b.sections[i].portals.length);
		expect(a.sections[i].noGoLines.length).toBe(b.sections[i].noGoLines.length);
	}
}

function loadFullBundle(fixturePath: string): { buffer: ArrayBuffer } {
	const raw = fs.readFileSync(fixturePath);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return { buffer: bytes.buffer };
}

function readAISectionsFromBundle(buffer: ArrayBuffer): ParsedAISectionsV12 {
	const bundle = parseBundle(buffer);
	const ctxLittleEndian = bundle.header.platform !== PLATFORMS.PS3;
	const resource = bundle.resources.find((r) => r.resourceTypeId === RESOURCE_TYPE_IDS.AI_SECTIONS)!;
	const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[0]);
	const base = bundle.header.resourceDataOffsets[0] >>> 0;
	const rel = resource.diskOffsets[0] >>> 0;
	const start = (base + rel) >>> 0;
	let slice: Uint8Array = new Uint8Array(buffer.slice(start, start + size));
	if (isCompressed(slice)) slice = decompressData(slice);
	const parsed = parseAISectionsData(slice, ctxLittleEndian);
	if (parsed.kind !== 'v12') throw new Error(`Expected v12 AI Sections, got ${parsed.kind}`);
	return parsed;
}

describe('AI Sections cross-platform bundle export', () => {
	it('PS3 bundle → writeBundleFresh({ platform: PC }) → parses as a valid PC bundle with matching AI Sections model', () => {
		const { buffer } = loadFullBundle(PS3_FIXTURE);
		const sourceBundle = parseBundle(buffer);
		expect(sourceBundle.header.platform).toBe(PLATFORMS.PS3);
		const sourceModel = readAISectionsFromBundle(buffer);

		const converted = writeBundleFresh(sourceBundle, buffer, { platform: PLATFORMS.PC });

		// The converted bundle's wrapper must be readable as PC (LE).
		const convertedBundle = parseBundle(converted);
		expect(convertedBundle.header.platform).toBe(PLATFORMS.PC);
		expect(convertedBundle.header.version).toBe(2);

		// And the AI Sections payload must round-trip to the same logical model
		// when read as LE — proving the resource bytes were re-encoded, not just
		// copied through. Without the cross-platform re-encode in writeBundleFresh,
		// this would either parse as garbage or yield a model that mismatches.
		const convertedModel = readAISectionsFromBundle(converted);
		expectModelsEqual(convertedModel, sourceModel);
	});

	it('PC bundle → writeBundleFresh({ platform: PS3 }) → parses as a valid PS3 bundle with matching AI Sections model', () => {
		const { buffer } = loadFullBundle(PC_FIXTURE);
		const sourceBundle = parseBundle(buffer);
		expect(sourceBundle.header.platform).toBe(PLATFORMS.PC);
		const sourceModel = readAISectionsFromBundle(buffer);

		const converted = writeBundleFresh(sourceBundle, buffer, { platform: PLATFORMS.PS3 });

		const convertedBundle = parseBundle(converted);
		expect(convertedBundle.header.platform).toBe(PLATFORMS.PS3);
		expect(convertedBundle.header.version).toBe(2);

		const convertedModel = readAISectionsFromBundle(converted);
		expectModelsEqual(convertedModel, sourceModel);
	});
});

describe('AI Sections cross-platform self-consistency', () => {
	it('PC payload → write as PS3 (BE) → reparse → write as PC === source', () => {
		const sourcePC = loadResourceBytes(PC_FIXTURE);
		const modelFromPC = parseAISectionsData(sourcePC, /* littleEndian */ true);
		if (modelFromPC.kind !== 'v12') throw new Error(`Expected v12 fixture, got ${modelFromPC.kind}`);

		// Convert to PS3 (BE) layout.
		const asBE = writeAISectionsData(modelFromPC, /* littleEndian */ false);
		const modelFromBE = parseAISectionsData(asBE, /* littleEndian */ false);
		if (modelFromBE.kind !== 'v12') throw new Error(`Expected v12 round-trip, got ${modelFromBE.kind}`);
		expectModelsEqual(modelFromBE, modelFromPC);

		// Convert back to PC (LE). Must equal the original byte-for-byte.
		const backToLE = writeAISectionsData(modelFromBE, /* littleEndian */ true);
		expect(backToLE.byteLength).toBe(sourcePC.byteLength);
		if (!bytesEqual(backToLE, sourcePC)) {
			// Find the first divergence to make debugging easier.
			let firstDiff = -1;
			for (let i = 0; i < sourcePC.byteLength; i++) {
				if (sourcePC[i] !== backToLE[i]) { firstDiff = i; break; }
			}
			throw new Error(`PC→PS3→PC drift; first byte diff at 0x${firstDiff.toString(16)}`);
		}
	});

	it('PS3 payload → write as PC (LE) → reparse → write as PS3 === source', () => {
		const sourcePS3 = loadResourceBytes(PS3_FIXTURE);
		const modelFromPS3 = parseAISectionsData(sourcePS3, /* littleEndian */ false);
		if (modelFromPS3.kind !== 'v12') throw new Error(`Expected v12 fixture, got ${modelFromPS3.kind}`);

		const asLE = writeAISectionsData(modelFromPS3, /* littleEndian */ true);
		const modelFromLE = parseAISectionsData(asLE, /* littleEndian */ true);
		if (modelFromLE.kind !== 'v12') throw new Error(`Expected v12 round-trip, got ${modelFromLE.kind}`);
		expectModelsEqual(modelFromLE, modelFromPS3);

		const backToBE = writeAISectionsData(modelFromLE, /* littleEndian */ false);
		expect(backToBE.byteLength).toBe(sourcePS3.byteLength);
		if (!bytesEqual(backToBE, sourcePS3)) {
			let firstDiff = -1;
			for (let i = 0; i < sourcePS3.byteLength; i++) {
				if (sourcePS3[i] !== backToBE[i]) { firstDiff = i; break; }
			}
			throw new Error(`PS3→PC→PS3 drift; first byte diff at 0x${firstDiff.toString(16)}`);
		}
	});

});

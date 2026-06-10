// Gold coverage for parseParticleDescriptionCollection /
// writeParticleDescriptionCollection against example/PARTICLES.BUNDLE.
//
// Pins the hand-verified layout (slot table of one-based ordinals at 0x8,
// 16-byte zero pad, import table at 0xC0) and the cross-resource facts the
// auto registry suite can't see: the import set equals the bundle's 42
// ParticleDescription resources, import order is NOT bundle order, and every
// import id is the FNV-1a (lowercased) of that description's gamedb URI.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseParticleDescriptionCollection,
	writeParticleDescriptionCollection,
} from '../particleDescriptionCollection';
import { lionFnv1a } from '../textureNameMap';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { extractResourceRaw } from '../registry';
import type { ParsedBundle } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FIXTURE = path.resolve(REPO_ROOT, 'example/PARTICLES.BUNDLE');
const COLLECTION_TYPE_ID = 0x10008;
const PARTICLE_DESCRIPTION_TYPE_ID = 0x1001d;

function loadBundle(): { buffer: ArrayBuffer; bundle: ParsedBundle } {
	const buf = fs.readFileSync(FIXTURE);
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	return { buffer, bundle: parseBundle(buffer) };
}

const { buffer, bundle } = loadBundle();
const collectionEntries = bundle.resources.filter((r) => r.resourceTypeId === COLLECTION_TYPE_ID);
const raw = extractResourceRaw(buffer, bundle, collectionEntries[0]);
const debugResources = typeof bundle.debugData === 'string' ? parseDebugDataFromXml(bundle.debugData) : [];

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

describe('ParticleDescriptionCollection gold values (example/PARTICLES.BUNDLE)', () => {
	it('the bundle carries exactly one collection', () => {
		expect(collectionEntries.length).toBe(1);
		expect(raw.byteLength).toBe(0x360);
	});

	it('decodes 42 descriptions with the hand-verified first/last ids', () => {
		const m = parseParticleDescriptionCollection(raw);
		expect(m.descriptions.length).toBe(42);
		expect(m.descriptions[0].mDescriptionId).toBe(0xeafed743n);
		expect(m.descriptions[1].mDescriptionId).toBe(0xe8b1e430n);
		expect(m.descriptions[41].mDescriptionId).toBe(0x5d18d891n);
	});

	it('the pad between the slot table and the import table is 16 zero bytes', () => {
		const m = parseParticleDescriptionCollection(raw);
		expect(m._padAfterTable.byteLength).toBe(16);
		expect(m._padAfterTable.every((b) => b === 0)).toBe(true);
	});

	it('wiki divergence: slots hold one-based ordinals 1..42, not zero-based import indices', () => {
		// The parser asserts this shape (it throws otherwise); read the raw
		// words here so the documented divergence survives a parser rewrite.
		const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
		for (let i = 0; i < 42; i++) {
			expect(dv.getUint32(0x8 + 4 * i, true)).toBe(i + 1);
		}
	});

	it('imports exactly cover the bundle\'s ParticleDescription resources — in authoring order, not bundle order', () => {
		const m = parseParticleDescriptionCollection(raw);
		const pdIds = bundle.resources
			.filter((r) => r.resourceTypeId === PARTICLE_DESCRIPTION_TYPE_ID)
			.map((r) => (BigInt(r.resourceId.high) << 32n) | BigInt(r.resourceId.low >>> 0));
		expect(pdIds.length).toBe(42);
		const importIds = m.descriptions.map((d) => d.mDescriptionId);
		expect(new Set(importIds).size).toBe(42);
		expect(new Set(importIds.map((v) => v.toString(16)))).toEqual(new Set(pdIds.map((v) => v.toString(16))));
		// The envelope sorts resources by id; the collection keeps the authoring
		// order, so the two sequences differ even though the sets match.
		expect(importIds).not.toEqual(pdIds);
	});

	it('every import id is the FNV-1a (lowercased) of that description\'s gamedb URI', () => {
		const m = parseParticleDescriptionCollection(raw);
		expect(debugResources.length).toBeGreaterThan(0);
		for (const { mDescriptionId } of m.descriptions) {
			const name = findDebugResourceById(debugResources, mDescriptionId.toString(16))?.name;
			expect(name, `debug name for 0x${mDescriptionId.toString(16)}`).toBeTruthy();
			expect(BigInt(lionFnv1a(name!)), name).toBe(mDescriptionId);
		}
	});
});

describe('ParticleDescriptionCollection round-trip', () => {
	it('round-trips byte-for-byte and the writer is idempotent', () => {
		const once = writeParticleDescriptionCollection(parseParticleDescriptionCollection(raw));
		expect(once.byteLength).toBe(raw.byteLength);
		expect(bytesEqual(once, raw)).toBe(true);
		const twice = writeParticleDescriptionCollection(parseParticleDescriptionCollection(once));
		expect(bytesEqual(twice, once)).toBe(true);
	});

	it('append + remove keep the slot table, pad, and import table consistent', () => {
		const m = parseParticleDescriptionCollection(raw);
		const appended = writeParticleDescriptionCollection({
			...m,
			descriptions: [...m.descriptions, { mDescriptionId: 0x12345678n }],
		});
		// +4 slot bytes, +16 import bytes.
		expect(appended.byteLength).toBe(raw.byteLength + 20);
		const reparsed = parseParticleDescriptionCollection(appended);
		expect(reparsed.descriptions.length).toBe(43);
		expect(reparsed.descriptions[42].mDescriptionId).toBe(0x12345678n);

		const removed = writeParticleDescriptionCollection({ ...m, descriptions: m.descriptions.slice(0, -1) });
		expect(parseParticleDescriptionCollection(removed).descriptions.length).toBe(41);
	});

	it('parser rejects a corrupted mpTable pointer', () => {
		const bad = new Uint8Array(raw);
		bad[0] = 0x0c;
		expect(() => parseParticleDescriptionCollection(bad)).toThrow(/mpTable/);
	});

	it('parser rejects a slot that is not the one-based ordinal', () => {
		const bad = new Uint8Array(raw);
		bad[0x8] = 0x07; // slot 0: 1 → 7
		expect(() => parseParticleDescriptionCollection(bad)).toThrow(/one-based ordinal/);
	});

	it('parser rejects an import entry whose patch offset does not target its slot', () => {
		const bad = new Uint8Array(raw);
		bad[0xc0 + 8] = 0x0c; // import 0: patch 0x8 → 0xc
		expect(() => parseParticleDescriptionCollection(bad)).toThrow(/patches/);
	});
});

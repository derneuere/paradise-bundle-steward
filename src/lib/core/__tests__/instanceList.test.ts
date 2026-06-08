// Gold-file coverage for parseInstanceList / writeInstanceList.
//
// example/TRK_UNIT9_GR.BNDL is a BND2 bundle containing one InstanceList
// (0x23) resource — we parse the bundle, extract the resource payload, then
// decode it. The header / instance assertions pin the values verified by hand
// against the wiki (TRK9 gold: 196 entries, 23 complete, v1); the round-trip
// assertions guard the rigid layout.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../registry';
import { parseInstanceList, writeInstanceList } from '../instanceList';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const GOLD_PATH = path.resolve(REPO_ROOT, 'example/TRK_UNIT9_GR.BNDL');
const INSTANCE_LIST_TYPE_ID = 0x23;

function loadGoldRaw(): Uint8Array {
	const buf = fs.readFileSync(GOLD_PATH);
	const bytes = new Uint8Array(buf.byteLength);
	bytes.set(buf);
	const buffer = bytes.buffer as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === INSTANCE_LIST_TYPE_ID);
	if (!resource) throw new Error('TRK_UNIT9_GR.BNDL has no InstanceList (0x23) resource');
	return extractResourceRaw(buffer, bundle, resource);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

describe('InstanceList gold file (example/TRK_UNIT9_GR.BNDL)', () => {
	const raw = loadGoldRaw();
	const model = parseInstanceList(raw);

	it('decodes the header', () => {
		// muArraySize is instances.length; muNumInstances is the complete count.
		expect(model.instances.length).toBe(196);
		expect(model.muNumInstances).toBe(23);
		expect(model.muVersionNumber).toBe(1);
	});

	it('decodes instance[0] (transform translation + backdrop zone)', () => {
		const inst = model.instances[0];
		// Translation lives in transform indices 12,13,14 (world X,Y,Z).
		expect(inst.mWorldTransform[12]).toBeCloseTo(-567.1, 1);
		expect(inst.mWorldTransform[13]).toBeCloseTo(370.8, 1);
		expect(inst.mWorldTransform[14]).toBeCloseTo(-2779.4, 1);
		expect(inst.mi16BackdropZoneID).toBe(-1);
	});

	it('round-trips byte-for-byte', () => {
		const rewritten = writeInstanceList(model);
		expect(rewritten.byteLength).toBe(raw.byteLength);
		expect(bytesEqual(rewritten, raw)).toBe(true);
	});

	it('writer is idempotent', () => {
		const write1 = writeInstanceList(parseInstanceList(raw));
		const write2 = writeInstanceList(parseInstanceList(write1));
		expect(bytesEqual(write1, write2)).toBe(true);
	});
});

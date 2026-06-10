// Gold coverage for parsePropPhysics / writePropPhysics against the single
// retail fixture (example/PROPPHYSICS.BUNDLE — the only PropPhysics resource
// in the game). Pins hand-verified decoded values, the PROP_TYPES index
// alignment, the volume-type census that contradicts the wiki's "always box
// volumes" note, and byte-exact round-trip + writer idempotence.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parsePropPhysics, writePropPhysics, VOLUME_TYPE } from '../propPhysics';
import { PROP_TYPES } from '../propTypes';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function loadRaw(): Uint8Array {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, 'example/PROPPHYSICS.BUNDLE'));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const res = bundle.resources.find((r) => r.resourceTypeId === 0x1000f);
	if (!res) throw new Error('fixture missing PropPhysics resource');
	return extractResourceRaw(buffer, bundle, res);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const raw = loadRaw();
const model = parsePropPhysics(raw);

describe('PropPhysics gold values (example/PROPPHYSICS.BUNDLE)', () => {
	it('decodes the catalogue counts', () => {
		expect(model.propTypes.length).toBe(247);
		expect(model.propTypes.reduce((n, t) => n + t.parts.length, 0)).toBe(183);
		const vols = model.propTypes.reduce(
			(n, t) => n + t.volumes.length + t.parts.reduce((m, p) => m + p.volumes.length, 0),
			0,
		);
		expect(vols).toBe(480);
		// Remastered nulls the build timestamp.
		expect(model.muTimeStamp).toBe(0);
	});

	it('every entry aligns with the PROP_TYPES table by index', () => {
		// PropInstanceData.typeId indexes PROP_TYPES; this proves the same index
		// addresses this catalogue, which is what makes cross-resource prop
		// editing coherent.
		expect(model.propTypes.length).toBe(PROP_TYPES.length);
		for (let i = 0; i < PROP_TYPES.length; i++) {
			// Compare as values — the wiki table strips leading zeros from ids.
			expect(model.propTypes[i].mResourceId, `propTypes[${i}] resource id`).toBe(BigInt('0x' + PROP_TYPES[i].resourceId));
			expect(model.propTypes[i].muSceneUriId, `propTypes[${i}] gamedb id`).toBe(PROP_TYPES[i].gameDbId);
		}
	});

	it('decodes propTypes[6] (STU_gate01 — tilting gate with 2 breakable parts)', () => {
		const t = model.propTypes[6];
		expect(t.mfMass).toBe(150);
		expect(t.mfSmashThreshold).toBe(30);
		expect(t.mu8JointType).toBe(2); // Tilt
		expect(t.parts.length).toBe(2);
		expect(t.volumes.length).toBe(1);
		expect(t.parts[0].volumes.length).toBe(1);
		expect(t.parts[0].mfMass).toBe(1);
	});

	it('decodes propTypes[8] (billboard_overdrive_YELLOW — 19 parts)', () => {
		const t = model.propTypes[8];
		expect(t.mfMass).toBe(400);
		expect(t.parts.length).toBe(19);
	});

	it('decodes a box volume with sensible half extents', () => {
		const v = model.propTypes[0].volumes[0];
		expect(v.vType).toBe(VOLUME_TYPE.BOX);
		expect(v.mUnion[0]).toBeCloseTo(0.03, 2);
		expect(v.mUnion[1]).toBeCloseTo(0.59, 2);
		expect(v.mUnion[2]).toBeCloseTo(0.38, 2);
		expect(v.muFlags).toBe(0x1); // VOLUMEFLAG_ISENABLED
	});

	it('volume-type census: the wiki\'s "always box volumes" note is wrong', () => {
		const histo = new Map<number, number>();
		for (const t of model.propTypes) {
			for (const v of [...t.volumes, ...t.parts.flatMap((p) => p.volumes)]) {
				histo.set(v.vType, (histo.get(v.vType) ?? 0) + 1);
			}
		}
		expect(histo.get(VOLUME_TYPE.BOX)).toBe(442);
		expect(histo.get(VOLUME_TYPE.CAPSULE)).toBe(37);
		expect(histo.get(VOLUME_TYPE.SPHERE)).toBe(1);
		expect(histo.size).toBe(3);
	});

	it('preserves the uninitialised pointers empty arrays store', () => {
		// Prop types with no parts keep garbage (not null) in maParts — the
		// writer must replay it verbatim for byte-exact output.
		const noParts = model.propTypes.find((t) => t.parts.length === 0);
		expect(noParts).toBeDefined();
		expect(noParts!._rawPartsPtr).not.toBe(0);
	});

	it('round-trips byte-for-byte', () => {
		const rewritten = writePropPhysics(model);
		expect(rewritten.byteLength).toBe(raw.byteLength);
		expect(bytesEqual(rewritten, raw)).toBe(true);
	});

	it('writer is idempotent', () => {
		const write1 = writePropPhysics(parsePropPhysics(raw));
		const write2 = writePropPhysics(parsePropPhysics(write1));
		expect(bytesEqual(write1, write2)).toBe(true);
	});
});

describe('PropPhysics writer guards', () => {
	it('rejects a model that overflows the fixed volume table', () => {
		const volume = model.propTypes[0].volumes[0];
		const fat = {
			...model,
			propTypes: model.propTypes.map((t) => ({
				...t,
				// 247 types x 9 volumes > 2048 slots
				volumes: Array.from({ length: 9 }, () => ({ ...volume, mTransform: volume.mTransform.slice(), mUnion: [...volume.mUnion] as [number, number, number] })),
			})),
		};
		expect(() => writePropPhysics(fat)).toThrow(/overflow/);
	});
});

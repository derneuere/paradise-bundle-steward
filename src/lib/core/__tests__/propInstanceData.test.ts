// Gold-file coverage for parsePropInstanceData / writePropInstanceData.
//
// The fixture example/BE_9F_C7_93.dat is a RAW extracted PropInstanceData
// resource (TRK 206, 27680 bytes), not a bundle — its bytes are read directly.
// The header / cell / instance assertions pin the decoded values the user
// verified by hand; the round-trip assertions guard the rigid layout.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parsePropInstanceData,
	writePropInstanceData,
	PROP_INSTANCE_FLAGS,
} from '../propInstanceData';
import { PROP_ALT_TYPE_NONE, propTypeLabel } from '../propTypes';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const GOLD_PATH = path.resolve(REPO_ROOT, 'example/BE_9F_C7_93.dat');

function loadGold(): Uint8Array {
	const buf = fs.readFileSync(GOLD_PATH);
	const bytes = new Uint8Array(buf.byteLength);
	bytes.set(buf);
	return bytes;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

describe('PropInstanceData gold file (example/BE_9F_C7_93.dat)', () => {
	const bytes = loadGold();
	const model = parsePropInstanceData(bytes);

	it('decodes the header', () => {
		expect(model.muZoneId).toBe(206);
		expect(model.muNumberOfInstances).toBe(361);
		expect(model.muSizeInBytes).toBe(27648);
		expect(model.instances.length).toBe(172); // muNumberOfProps
		expect(model.cells.length).toBe(8);
	});

	it('decodes cell[2]', () => {
		const c = model.cells[2];
		expect(c.muX).toBe(70);
		expect(c.muZ).toBe(37);
		expect(c.muStartIndex).toBe(10);
		expect(c.muCount).toBe(51);
		expect(c.muNumberOfRespawnDifferent).toBe(1);
		expect(c.muNumberOfDontRespawn).toBe(4);
	});

	it('decodes instance[10] (billboard_overdrive_YELLOW)', () => {
		const inst = model.instances[10];
		expect(inst.typeId).toBe(8);
		expect(propTypeLabel(inst.typeId)).toBe('billboard_overdrive_YELLOW');
		expect(inst.muInstanceID).toBe(473825);
		expect(inst.muAlternativeType).toBe(245);
		expect(inst.flags).toBe(0);
		// Translation lives in transform indices 12,13,14 (world X,Y,Z).
		expect(inst.mWorldTransform[12]).toBeCloseTo(2025.59, 1);
		expect(inst.mWorldTransform[13]).toBeCloseTo(11.67, 1);
		expect(inst.mWorldTransform[14]).toBeCloseTo(-1292.24, 1);
	});

	it('decodes instance[11] (STU_gate01, no alternative type)', () => {
		const inst = model.instances[11];
		expect(inst.typeId).toBe(6);
		expect(propTypeLabel(inst.typeId)).toBe('STU_gate01');
		expect(inst.muAlternativeType).toBe(PROP_ALT_TYPE_NONE);
		expect(inst.muAlternativeType).toBe(0xffff);
	});

	it('decodes the remaining pinned instance type ids', () => {
		expect(model.instances[15].typeId).toBe(154);
		expect(model.instances[16].typeId).toBe(207);
	});

	it('exposes the disable-physics flag mask', () => {
		expect(PROP_INSTANCE_FLAGS.DISABLE_PHYSICS).toBe(0x1);
	});

	it('round-trips byte-for-byte', () => {
		const rewritten = writePropInstanceData(model);
		expect(rewritten.byteLength).toBe(bytes.byteLength);
		expect(bytesEqual(rewritten, bytes)).toBe(true);
	});

	it('writer is idempotent', () => {
		const write1 = writePropInstanceData(parsePropInstanceData(bytes));
		const write2 = writePropInstanceData(parsePropInstanceData(write1));
		expect(bytesEqual(write1, write2)).toBe(true);
	});
});

// ~40% of track units (172/427 in example/) ship an *empty* prop zone: no
// props, no cells, with maInstances and maCells stored as null (0) rather than
// the populated-layout 0x20. The parser must accept this all-zero shape instead
// of throwing — a throw leaves a null model in the workspace, and clicking it
// used to tear down the whole editor (and the WebGL context). Synthesised here
// (rather than relying on an untracked example/ binary) so the regression is
// pinned on every machine.
describe('PropInstanceData empty prop zone (null pointers)', () => {
	function emptyZoneBytes(zoneId: number): Uint8Array {
		// 32-byte header + 32 bytes trailing zero pad = 64 bytes, mirroring the
		// real empty-zone resource (e.g. example/TRK_UNIT0_GR.BNDL).
		const bytes = new Uint8Array(64);
		const dv = new DataView(bytes.buffer);
		dv.setUint32(12, 32, true); // muSizeInBytes (stored, == header size here)
		dv.setUint16(24, zoneId, true); // muZoneId
		// Everything else — maCells, maInstances, counts — stays zero.
		return bytes;
	}

	it('parses with zero instances/cells and null pointers', () => {
		const model = parsePropInstanceData(emptyZoneBytes(7));
		expect(model.instances.length).toBe(0);
		expect(model.cells.length).toBe(0);
		expect(model.muZoneId).toBe(7);
		expect(model.muSizeInBytes).toBe(32);
		// Trailing pad (header end → buffer end) is preserved verbatim, not the
		// whole buffer — guards against the null maCells mis-seeking to offset 0.
		expect(model._trailingPad.byteLength).toBe(32);
	});

	it('round-trips byte-for-byte (re-emits null pointers, not 0x20)', () => {
		const original = emptyZoneBytes(7);
		const rewritten = writePropInstanceData(parsePropInstanceData(original));
		expect(rewritten.byteLength).toBe(original.byteLength);
		expect(bytesEqual(rewritten, original)).toBe(true);
	});
});

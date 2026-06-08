// Track-unit geometry decode — spec test against a real _GR bundle.
//
// Verifies the InstanceList → Model → Renderable → placed grey geometry
// pipeline on TRK_UNIT9_GR.BNDL: the InstanceList declares 23 complete
// instances (muNumInstances), all of whose Models live locally, and the
// decode should yield placed meshes positioned in the same world space as the
// props (inst0 sits near x≈-567, y≈371, z≈-2779 per the fixture findings in
// docs/instance-list-spec.md).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBundle } from '@/lib/core/bundle';
import {
	decodeTrackGeometry,
	instanceTransformToMatrix4,
} from '../trackGeometryDecode';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const TRK9 = path.resolve(REPO_ROOT, 'example/TRK_UNIT9_GR.BNDL');

function loadBuffer(abs: string): ArrayBuffer {
	const raw = fs.readFileSync(abs);
	return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
}

describe('decodeTrackGeometry (TRK_UNIT9_GR)', () => {
	it('places grey meshes from the InstanceList at prop-space transforms', () => {
		const buffer = loadBuffer(TRK9);
		const bundle = parseBundle(buffer);

		const result = decodeTrackGeometry(bundle, buffer);

		// The fixture declares 23 complete instances, all locally resolvable.
		expect(result.instanceCount).toBe(23);
		expect(result.resolvedModels).toBeGreaterThan(0);
		expect(result.meshes.length).toBeGreaterThan(0);

		// Every placed mesh carries real geometry.
		for (const m of result.meshes) {
			const pos = m.geometry.getAttribute('position');
			expect(pos).toBeTruthy();
			expect(pos.count).toBeGreaterThan(0);
		}

		// At least one placed mesh sits near inst0's world position
		// (x≈-567, z≈-2779) — i.e. the track is decoded into prop coordinate
		// space, not at the origin.
		const translations = result.meshes.map((m) => {
			const t = m.matrix.elements;
			return { x: t[12], y: t[13], z: t[14] };
		});
		const nearInst0 = translations.some(
			(p) => Math.abs(p.x - -567) < 5 && Math.abs(p.z - -2779) < 5,
		);
		expect(nearInst0).toBe(true);

		// Sanity: the placed transforms span the track region, not a single
		// stacked point.
		const xs = translations.map((p) => p.x);
		expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(50);
	});

	it('patches the affine bottom row to (0,0,0,1)', () => {
		// fromArray is column-major: indices 3/7/11/15 are the bottom row.
		const transform = [
			1, 0, 0, 0.5, // last value is a stray pad slot the writer fixes up
			0, 1, 0, 0.5,
			0, 0, 1, 0.5,
			-567, 371, -2779, 7,
		];
		const m = instanceTransformToMatrix4(transform);
		const e = m.elements;
		expect(e[3]).toBe(0);
		expect(e[7]).toBe(0);
		expect(e[11]).toBe(0);
		expect(e[15]).toBe(1);
		// Translation (column-major indices 12/13/14) survives.
		expect(e[12]).toBe(-567);
		expect(e[13]).toBe(371);
		expect(e[14]).toBe(-2779);
	});
});

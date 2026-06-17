// propGeometryDecode — the PropInstanceData × PropGraphicsList × Model join
// that turns prop placements into real meshes.
//
// `placeProps` is pure and machine-independent — tested with a synthetic
// PropInstanceData + a fake type→geometry map. The catalogue resolution
// (`buildPropTypeModelMap`) and the heavy decode are exercised against the real
// TRK_UNIT9 bundle, skipped when that untracked binary is absent (same
// convention as the parser gold tests).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';

import {
	buildPropTypeModelMap,
	decodePropTypeGeometry,
	placeProps,
	disposePropTypeGeometry,
} from '../propGeometryDecode';
import { parseBundle } from '@/lib/core/bundle';
import { extractResourceRaw } from '@/lib/core/registry';
import {
	parsePropInstanceData,
	type ParsedPropInstanceData,
	type PropInstance,
} from '@/lib/core/propInstanceData';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const TRK9 = path.resolve(REPO_ROOT, 'example/TRK_UNIT9_GR.BNDL');

function makeInstance(typeId: number, x: number, y: number, z: number): PropInstance {
	const m = new Array(16).fill(0);
	m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
	return {
		mWorldTransform: m,
		typeId,
		flags: 0,
		muInstanceID: 1,
		muAlternativeType: 0xffff,
		mRotationAxis: 0,
		mn8RotSpeed: 0,
		mn8MaxAngle: 0,
		mn8MinAngle: 0,
		_pad4D: [0, 0, 0],
	};
}

function makePid(instances: PropInstance[]): ParsedPropInstanceData {
	return {
		muZoneId: 0,
		muSizeInBytes: 0,
		muNumberOfInstances: instances.length,
		instances,
		cells: [],
		_trailingPad: new Uint8Array(0),
	};
}

describe('placeProps (synthetic)', () => {
	it('places resolved instances and partitions out the unresolved', () => {
		const pid = makePid([
			makeInstance(5, 10, 0, 0),
			makeInstance(99, 20, 0, 0), // type 99 not in the catalogue → unresolved
			makeInstance(5, 30, 0, 0),
		]);
		const geomA = new THREE.BufferGeometry();
		const typeGeometry = new Map<number, THREE.BufferGeometry[]>([[5, [geomA]]]);

		const { groups, resolvedInstanceIndices } = placeProps(pid, typeGeometry);

		expect([...resolvedInstanceIndices].sort()).toEqual([0, 2]);
		expect(groups).toHaveLength(1);
		expect(groups[0].geometry).toBe(geomA);
		// Both type-5 instances share the one geometry, placed at their transforms.
		expect(groups[0].placements.map((p) => p.instanceIndex)).toEqual([0, 2]);
		expect(groups[0].placements[0].matrix.elements[12]).toBe(10);
		expect(groups[0].placements[1].matrix.elements[12]).toBe(30);
	});

	it('resolves nothing when the catalogue is empty (every prop falls back to a box)', () => {
		const pid = makePid([makeInstance(5, 0, 0, 0), makeInstance(6, 0, 0, 0)]);
		const { groups, resolvedInstanceIndices } = placeProps(pid, new Map());
		expect(groups).toHaveLength(0);
		expect(resolvedInstanceIndices.size).toBe(0);
	});

	it('shares one geometry across every placement of a multi-geometry model', () => {
		const pid = makePid([makeInstance(7, 0, 0, 0), makeInstance(7, 5, 0, 0)]);
		const g1 = new THREE.BufferGeometry();
		const g2 = new THREE.BufferGeometry();
		const { groups } = placeProps(pid, new Map([[7, [g1, g2]]]));
		// Two geometries, each placed at both instances.
		expect(groups).toHaveLength(2);
		for (const g of groups) expect(g.placements).toHaveLength(2);
	});
});

const hasTrk9 = fs.existsSync(TRK9);
const describeTrk9 = hasTrk9 ? describe : describe.skip;

describeTrk9('catalogue resolution + decode (example/TRK_UNIT9_GR.BNDL)', () => {
	function load() {
		const file = fs.readFileSync(TRK9);
		const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
		const bundle = parseBundle(buffer);
		const pidEntry = bundle.resources.find((r) => r.resourceTypeId === 0x10011)!;
		const pid = parsePropInstanceData(extractResourceRaw(buffer, bundle, pidEntry));
		return { bundle, buffer, pid };
	}

	it('maps every placed prop type to a Model id', () => {
		const { bundle, buffer, pid } = load();
		const map = buildPropTypeModelMap(bundle, buffer);
		// TRK9's catalogue has 10 prop types; type 40 (0x28) → Model 0x12f7700a.
		expect(map.size).toBe(10);
		expect(map.get(40)).toBe(0x12f7700an);
		// Every placed instance's type is in the catalogue (the join always hits).
		const placedTypes = new Set(pid.instances.map((i) => i.typeId));
		for (const t of placedTypes) expect(map.has(t)).toBe(true);
	});

	it('decodes locally-present prop Models to geometry without throwing', () => {
		const { bundle, buffer, pid } = load();
		// No companion bundles loaded — only props whose Model is local resolve;
		// the rest fall back to boxes. The decode must be robust either way.
		const typeGeometry = decodePropTypeGeometry(bundle, buffer, []);
		for (const geoms of typeGeometry.values()) {
			for (const g of geoms) expect(g).toBeInstanceOf(THREE.BufferGeometry);
		}
		const { resolvedInstanceIndices } = placeProps(pid, typeGeometry);
		// Resolved is a subset of all instances (≥0; depends on which Models are local).
		expect(resolvedInstanceIndices.size).toBeLessThanOrEqual(pid.instances.length);
		expect(() => disposePropTypeGeometry(typeGeometry)).not.toThrow();
	});
});

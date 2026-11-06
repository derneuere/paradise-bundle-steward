// Test cars. `loadCar` reads a retail car's _AT bundle (untracked, under
// .claude/sim-fixtures; tests skip without it). `syntheticParams` is a
// hand-built car with the retail coupe's numbers, so the physics tests run
// anywhere.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseAttribSys, type ParsedAttribSys } from '../../attribSys';
import { parseBundle } from '../../bundle';
import type { ParsedDeformationSpec, Vec3 } from '../../deformationSpec';
import { DEFORMATION_SPEC_TYPE_ID, parseDeformationSpecData } from '../../deformationSpec';
import { extractResourceRaw } from '../../registry/extract';
import { resourceCtxFromBundle } from '../../registry/handler';
import { defaultHandling } from '../defaultHandling';
import { buildVehicleParams, paramsFromClasses, type AttribClasses, type VehicleParams } from '../params';

export const fixturePath = (car: string) => path.resolve(`.claude/sim-fixtures/VEH_${car}_AT.BIN`);
export const hasFixture = (car: string) => fs.existsSync(fixturePath(car));

const ATTRIB_SYS_TYPE_ID = 0x1c;

export function loadCar(car: string): { params: VehicleParams; spec: ParsedDeformationSpec; vault: ParsedAttribSys } {
	const buf = fs.readFileSync(fixturePath(car));
	const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(ab);
	const res = (id: number) => {
		const r = bundle.resources.find((x) => x.resourceTypeId === id);
		if (!r) throw new Error(`${car}: no resource type 0x${id.toString(16)}`);
		return extractResourceRaw(ab, bundle, r);
	};
	const spec = parseDeformationSpecData(res(DEFORMATION_SPEC_TYPE_ID));
	const vault = parseAttribSys(res(ATTRIB_SYS_TYPE_ID), resourceCtxFromBundle(bundle).littleEndian);
	return { params: buildVehicleParams(vault, spec), spec, vault };
}

// A coupe-sized spec: four wheels of radius 0.325 around a centre of mass at
// the origin, the handling box, and one sensor sphere per corner.
export function syntheticSpec(): ParsedDeformationSpec {
	const wheel = (x: number, z: number) => ({ position: [x, -0.31, z, 0] as [number, number, number, number], direction: [0, 0.65, 0, 0] as [number, number, number, number], iValue: 0 });
	const sensor = (p: Vec3) => ({
		initialOffset: p, directionParams: [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number], radius: 0.5,
		nextSensor: [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number], sceneIndex: 0, absorbtionLevel: 0, nextBoundarySensor: [0, 0] as [number, number],
	});
	const sensors = [sensor([0.6, 0, 1.8]), sensor([-0.6, 0, 1.8]), sensor([0.6, 0, -1.8]), sensor([-0.6, 0, -1.8])];
	// TODO(types): the physics reads only the fields filled here; the rest of the spec is irrelevant to it.
	return {
		handlingBodyDimensions: [1.06627, 0.47784, 2.08861, 0],
		wheels: [wheel(-0.765, 1.237), wheel(0.765, 1.237), wheel(-0.875, -1.237), wheel(0.875, -1.237)],
		sensors, numDeformationSensors: sensors.length,
	} as unknown as ParsedDeformationSpec;
}

// The retail coupe's handling, field for field.
export const syntheticClasses = (): AttribClasses => defaultHandling();

export const syntheticParams = (): VehicleParams => paramsFromClasses(syntheticClasses(), syntheticSpec());

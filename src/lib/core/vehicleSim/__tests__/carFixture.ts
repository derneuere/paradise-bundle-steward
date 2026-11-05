// Test cars. `loadCar` reads a retail car's _AT bundle (untracked, under
// .claude/sim-fixtures; tests skip without it). `syntheticParams` is a
// hand-built car with the retail coupe's numbers, so the physics tests run
// anywhere.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseAttribSys } from '../../attribSys';
import { parseBundle } from '../../bundle';
import type { ParsedDeformationSpec, Vec3 } from '../../deformationSpec';
import { DEFORMATION_SPEC_TYPE_ID, parseDeformationSpecData } from '../../deformationSpec';
import { extractResourceRaw } from '../../registry/extract';
import { resourceCtxFromBundle } from '../../registry/handler';
import { buildVehicleParams, paramsFromClasses, type AttribClasses, type VehicleParams } from '../params';

export const fixturePath = (car: string) => path.resolve(`.claude/sim-fixtures/VEH_${car}_AT.BIN`);
export const hasFixture = (car: string) => fs.existsSync(fixturePath(car));

const ATTRIB_SYS_TYPE_ID = 0x1c;

export function loadCar(car: string): { params: VehicleParams; spec: ParsedDeformationSpec } {
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
	return { params: buildVehicleParams(vault, spec), spec };
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

const v4 = (a: number, b: number, c: number) => [a, b, c, 0];

// The retail coupe's handling, field for field.
export function syntheticClasses(): AttribClasses {
	return {
		physicsvehiclebaseattribs: {
			DrivingMass: 1620, CoMOffset: v4(7500, 0, 0), MaxSpeed: 153, LinearDrag: 0.15, HighSpeedAngularDamping: 0.15,
			LowSpeedDrivingSpeed: 50, DownForce: 15.5, PowerToRear: 1, PowerToFront: 0, TractionLineLength: 0.2,
			TimeForFullBrake: 5, BrakeScaleToFactor: v4(4, 5, 3), MagicBrakeFactorStraightLine: 5, MagicBrakeFactorTurning: 0.5,
			RollDampingOnTakeOff: 0.004, SurfaceFrontGripFactor: 0.264, SurfaceRearGripFactor: 0.85, SurfaceDragFactor: 0.2,
			LowSpeedTyreFrictionTractionControl: 15, LowSpeedThrottleTractionControl: 10,
			FrontTireStaticFrictionCoefficient: 3, FrontTireDynamicFrictionCoefficient: 3, FrontTireLongForceBias: 0, FrontTireAdhesiveLimit: 30000,
			RearTireStaticFrictionCoefficient: 2.75, RearTireDynamicFrictionCoefficient: 2.75, RearTireLongForceBias: 0, RearTireAdhesiveLimit: 30000,
			FrontLongGripCurvePeakSlipRatio: 0.2, FrontLongGripCurvePeakCoefficient: 1.5, FrontLongGripCurveFloorSlipRatio: 1.2, FrontLongGripCurveFallCoefficient: 1,
			FrontLatGripCurvePeakSlipRatio: 0.4, FrontLatGripCurvePeakCoefficient: 2, FrontLatGripCurveFloorSlipRatio: 3, FrontLatGripCurveFallCoefficient: 1.5,
			RearLongGripCurvePeakSlipRatio: 0.2, RearLongGripCurvePeakCoefficient: 1.3, RearLongGripCurveFloorSlipRatio: 1, RearLongGripCurveFallCoefficient: 0.7,
			RearLatGripCurvePeakSlipRatio: 0.4, RearLatGripCurvePeakCoefficient: 1.8, RearLatGripCurveFloorSlipRatio: 3, RearLatGripCurveFallCoefficient: 1.1,
			CrashExtraYawVelocityFactor: 0.3, CrashExtraRollVelocityFactor: 0.3, CrashExtraPitchVelocityFactor: 0, CrashExtraLinearVelocityFactor: 0.3,
		},
		physicsvehicledriftattribs: { WheelSlip: 0.25, MinSpeedForDrift: 45 },
		physicsvehiclesuspensionattribs: {
			SpringLength: 0.085, Dampening: 5, InAirDamping: 30, UpwardMovement: 0.08, DownwardMovement: 0.1,
			FrontHeight: -0.01, RearHeight: 0, TimeToDampAfterLanding: 0.1,
			MaxPitchDampingOnLanding: 0.6, MaxRollDampingOnLanding: 1, MaxVertVelocityDampingOnLanding: 0.1,
		},
		physicsvehiclebodyrollattribs: { WheelLongForceHeightOffset: -0.4, WheelLatForceHeightOffset: -0.0675 },
		physicsvehicleengineattribs: {
			GearRatios1: v4(-1.1, 2.65, 1.66), GearRatios2: v4(1.13, 0.87, 0.73),
			GearUpRPMs1: v4(6000, 6200, 6200), GearUpRPMs2: v4(6200, 6200, 6200),
			TorqueScales1: v4(2.5, 1, 1), TorqueScales2: v4(1, 1, 1),
			MaxTorque: 390, EngineLowEndTorqueFactor: 0.5, TorqueFallOffRPM: 5000, MaxRPM: 7000, Differential: 3.9,
			TransmissionEfficiency: 0.5, FlyWheelInertia: 0.2, FlyWheelFriction: 250, GearChangeTime: 0,
		},
		physicsvehiclesteeringattribs: { TimeForLock: 0.4, StraightReactionBias: 2.75, MinAngle: 1.8, MaxAngle: 11 },
		physicsvehiclecollisionattribs: { BodyBox: v4(65, 0, 0) },
	};
}

export const syntheticParams = (): VehicleParams => paramsFromClasses(syntheticClasses(), syntheticSpec());

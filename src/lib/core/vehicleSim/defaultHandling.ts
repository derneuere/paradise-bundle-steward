// A complete set of race-car handling attribs, the retail coupe's (VEH_PUSSC01)
// field for field. A car whose AttribSys vault is missing or incomplete (a
// mod, a spec loaded without its vault) drives on these for whatever it lacks,
// so the Crash Preview can still run it.

import type { ParsedAttribSys } from '../attribSys';
import type { ParsedDeformationSpec } from '../deformationSpec';
import { attribClasses, paramsFromClasses, type AttribClasses, type VehicleParams } from './params';

const v4 = (a: number, b: number, c: number) => [a, b, c, 0];

export function defaultHandling(): AttribClasses {
	return {
		physicsvehiclebaseattribs: {
			DrivingMass: 1620, CoMOffset: v4(7500, 0, 0), MaxSpeed: 153, LinearDrag: 0.15, HighSpeedAngularDamping: 0.15,
			LowSpeedDrivingSpeed: 50, DownForce: 15.5, PowerToRear: 1, PowerToFront: 0, TractionLineLength: 0.2,
			TimeForFullBrake: 5, BrakeScaleToFactor: v4(4, 5, 3), MagicBrakeFactorStraightLine: 5, MagicBrakeFactorTurning: 0.5,
			PitchDampingOnTakeOff: 0.95, RollLimitOnTakeOff: 1,
			RollDampingOnTakeOff: 0.004, SurfaceFrontGripFactor: 0.264, SurfaceRearGripFactor: 0.85, SurfaceDragFactor: 0.2,
			LowSpeedTyreFrictionTractionControl: 15, LowSpeedThrottleTractionControl: 10,
			FrontTireStaticFrictionCoefficient: 3, FrontTireDynamicFrictionCoefficient: 3, FrontTireLongForceBias: 0, FrontTireAdhesiveLimit: 30000,
			RearTireStaticFrictionCoefficient: 2.75, RearTireDynamicFrictionCoefficient: 2.75, RearTireLongForceBias: 0, RearTireAdhesiveLimit: 30000,
			FrontLongGripCurvePeakSlipRatio: 0.2, FrontLongGripCurvePeakCoefficient: 1.5, FrontLongGripCurveFloorSlipRatio: 1.2, FrontLongGripCurveFallCoefficient: 1,
			FrontLatGripCurvePeakSlipRatio: 0.4, FrontLatGripCurvePeakCoefficient: 2, FrontLatGripCurveFloorSlipRatio: 3, FrontLatGripCurveFallCoefficient: 1.5,
			RearLongGripCurvePeakSlipRatio: 0.2, RearLongGripCurvePeakCoefficient: 1.3, RearLongGripCurveFloorSlipRatio: 1, RearLongGripCurveFallCoefficient: 0.7,
			RearLatGripCurvePeakSlipRatio: 0.4, RearLatGripCurvePeakCoefficient: 1.8, RearLatGripCurveFloorSlipRatio: 3, RearLatGripCurveFallCoefficient: 1.1,
			CrashExtraYawVelocityFactor: 0.3, CrashExtraRollVelocityFactor: 0.3, CrashExtraPitchVelocityFactor: 0, CrashExtraLinearVelocityFactor: 0.3,
			DriveTimeDeformLimitX: 0.05, DriveTimeDeformLimitNegY: 0.2, DriveTimeDeformLimitPosZ: 0.2, DriveTimeDeformLimitNegZ: 0.25,
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

// Later layers win, field by field; a field a layer leaves undefined keeps
// the earlier value.
export function mergeHandling(...layers: AttribClasses[]): AttribClasses {
	const out: AttribClasses = {};
	for (const layer of layers) {
		for (const [cls, fields] of Object.entries(layer)) {
			const into = (out[cls] = { ...(out[cls] ?? {}) });
			for (const [k, v] of Object.entries(fields)) if (v !== undefined) into[k] = v;
		}
	}
	return out;
}

// The car's vault over the defaults, then `overrides` over both. A car
// without a usable mass keeps the default one.
export function vehicleParamsFor(spec: ParsedDeformationSpec, vault?: ParsedAttribSys, overrides: AttribClasses = {}): VehicleParams {
	const classes = mergeHandling(defaultHandling(), attribClasses(vault), overrides);
	const base = classes.physicsvehiclebaseattribs;
	if (!(typeof base.DrivingMass === 'number' && base.DrivingMass > 0)) base.DrivingMass = defaultHandling().physicsvehiclebaseattribs.DrivingMass;
	return paramsFromClasses(classes, spec);
}

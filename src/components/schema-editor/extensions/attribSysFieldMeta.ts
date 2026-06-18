// Per-field UI metadata for AttribSys vault attributes (pure, no React).
//
// Derived from a sweep over every VEH_*_AT.BIN in example/ (see
// scripts/analyze-attribsys-ranges.ts). Three shapes:
//   values:   field is categorical → render a dropdown of retail values
//   min/max:  free-form numeric, clamped to ~2× the retail spread
//   constant: same value on every retail car → hidden behind "Show advanced"
//
// All entries are advisory: editing still produces a valid write; these just
// steer the UI away from values the engine has never seen.

export type FieldMeta = {
	values?: number[];
	min?: number;
	max?: number;
	constant?: boolean;
};

export const FIELD_META: Record<string, Record<string, FieldMeta>> = {
	physicsvehiclebaseattribs: {
		MaxSpeed: { min: 60, max: 300 },
		DrivingMass: { min: 200, max: 10000 },
		DownForce: { min: 0, max: 60 },
		RearTireAdhesiveLimit: { min: 5000, max: 100000 },
		FrontTireAdhesiveLimit: { min: 5000, max: 100000 },
		RearTireStaticFrictionCoefficient: { min: 0.5, max: 6 },
		RearTireDynamicFrictionCoefficient: { min: 0.5, max: 6 },
		FrontTireStaticFrictionCoefficient: { min: 0.5, max: 6 },
		FrontTireDynamicFrictionCoefficient: { min: 0.5, max: 6 },
		PowerToRear: { min: 0, max: 1 },
		PowerToFront: { min: 0, max: 1 },
		SurfaceRearGripFactor: { min: 0, max: 2 },
		SurfaceFrontGripFactor: { min: 0, max: 2 },
		SurfaceRoughnessFactor: { min: 0, max: 2 },
		SurfaceDragFactor: { min: 0, max: 2 },
		LinearDrag: { min: 0, max: 2 },
		MagicBrakeFactorTurning: { min: 0, max: 5 },
		MagicBrakeFactorStraightLine: { min: 0, max: 15 },
		LowSpeedTyreFrictionTractionControl: { min: 0, max: 50 },
		TimeForFullBrake: { values: [3, 4, 5] },
		RearWheelMass: { values: [20, 30, 45, 50, 120] },
		FrontWheelMass: { values: [20, 30, 45, 120] },
		LowSpeedDrivingSpeed: { values: [50, 70] },
		TractionLineLength: { constant: true },
		CrashExtraYawVelocityFactor: { constant: true },
		CrashExtraRollVelocityFactor: { constant: true },
		CrashExtraPitchVelocityFactor: { constant: true },
		CrashExtraLinearVelocityFactor: { constant: true },
	},
	physicsvehicleengineattribs: {
		MaxRPM: { min: 1000, max: 15000 },
		MaxTorque: { min: 50, max: 2000 },
		TorqueFallOffRPM: { min: 0, max: 10000 },
		Differential: { min: 1, max: 10 },
		TransmissionEfficiency: { min: 0, max: 1 },
		EngineLowEndTorqueFactor: { min: 0, max: 5 },
		LSDMGearUpSpeed: { values: [20, 30] },
		EngineBraking: { values: [125, 500] },
		GearChangeTime: { constant: true },
		FlyWheelInertia: { constant: true },
		FlyWheelFriction: { constant: true },
		EngineResistance: { constant: true },
	},
	physicsvehicleboostattribs: {
		MaxBoostSpeed: { min: 80, max: 350 },
		BlueMaxBoostSpeed: { values: [170, 175, 180] },
		BoostBase: { min: 0, max: 3 },
		BoostAcceleration: { min: 0, max: 30 },
		BoostKick: { values: [0, 5] },
		BoostKickMaxStartSpeed: { values: [100, 180] },
		BoostKickAcceleration: { min: 0, max: 60 },
		BlueBoostKick: { min: 0, max: 15 },
		BoostRule: { constant: true },
		BoostKickTime: { constant: true },
		BoostKickMaxTime: { constant: true },
		BoostHeightOffset: { constant: true },
		BlueBoostKickTime: { constant: true },
		BlueBoostBase: { constant: true },
	},
	physicsvehicledriftattribs: {
		DriftMaxAngle: { values: [45, 50, 60, 65, 75, 80, 85, 90] },
		MinSpeedForDrift: { values: [40, 45, 60] },
		SideForceDriftSpeedCutOff: { values: [1, 100] },
		SideForceDriftAngleCutOff: { values: [30, 35, 40, 45, 50, 55, 60] },
		SideForcePeakDriftAngle: { min: 0, max: 80 },
		SideForceMagnitude: { min: 0, max: 70 },
		NaturalYawTorque: { min: 0, max: 30000 },
		NaturalYawTorqueCutOffAngle: { min: 0, max: 45 },
		TimeForNaturalDrift: { constant: true },
		NeutralTimeToReduceDrift: { constant: true },
		NaturalDriftTimeToReachBaseSlip: { constant: true },
		NaturalDriftStartSlip: { constant: true },
		InitialDriftPushBaseInc: { constant: true },
		GripFromSteering: { constant: true },
		GripFromGasLetOff: { constant: true },
		GripFromBrake: { constant: true },
		ForcedDriftTimeToReachBaseSlip: { constant: true },
		DriftSidewaysDamping: { constant: true },
	},
	physicsvehiclesteeringattribs: {
		MaxAngle: { values: [10, 11, 12, 15, 17] },
		SpeedForMinAngle: { values: [90, 120, 150, 180] },
		AiPidCoefficientDriftD: { values: [1, 3] },
		AiMinLookAheadDistanceForDrift: { values: [0, 20] },
		SpeedForMaxAngle: { constant: true },
		AiPidCoefficientP: { constant: true },
		AiLookAheadTimeForDrift: { constant: true },
	},
	physicsvehiclesuspensionattribs: {
		UpwardMovement: { min: 0, max: 0.5 },
		DownwardMovement: { min: 0, max: 0.5 },
		SpringLength: { min: 0, max: 0.5 },
		Strength: { constant: true },
		InAirDamping: { constant: true },
	},
	physicsvehiclebodyrollattribs: {
		RollSpringStiffness: { constant: true },
		RollSpringDampening: { constant: true },
		PitchSpringStiffness: { constant: true },
		PitchSpringDampening: { constant: true },
	},
	camerabumperbehaviour: {
		YawSpring: { constant: true },
		RollSpring: { constant: true },
		PitchSpring: { constant: true },
		FieldOfView: { constant: true },
		BoostFieldOfView: { constant: true },
		BodyRollScale: { constant: true },
		BodyPitchScale: { constant: true },
		AccelerationResponse: { constant: true },
		AccelerationDampening: { constant: true },
	},
	cameraexternalbehaviour: {
		FieldOfView: { values: [60, 70, 80] },
		DownAngle: { values: [0, 5] },
		BoostFieldOfView: { values: [80, 90, 95] },
		ZDistanceScale: { constant: true },
		ZAndTiltCutoffSpeedMPH: { constant: true },
		TiltCameraScale: { constant: true },
		TiltAroundCar: { constant: true },
		SlideZOffsetMax: { constant: true },
		SlideYScale: { constant: true },
		SlideXScale: { constant: true },
		BoostFieldOfViewZoom: { constant: true },
	},
	burnoutcargraphicsasset: {
		PlayerPalletteIndex: { values: [0, 1, 2, 3] },
		Alloc: { constant: true },
		Num_RandomTrafficColours: { constant: true },
		Size: { constant: true },
		EncodedTypePad: { constant: true },
		Alloc_Offences: { constant: true },
		Num_Offences: { constant: true },
		Size_Offences: { constant: true },
		EncodedTypePad_Offences: { constant: true },
	},
};

export function getFieldMeta(className: string, fieldName: string): FieldMeta {
	return FIELD_META[className]?.[fieldName] ?? {};
}

// Schema-driven vehicle attribute parser/writer.
//
// Each attribute class is defined as an ordered list of field specs.
// A generic reader/writer processes any schema, keeping this compact
// vs. 13 separate parser classes.

import { BinReader, BinWriter } from './binTools';

// ---- Field spec types ----

type FieldSpec =
	| { name: string; type: 'f32' }
	| { name: string; type: 'i32' }
	| { name: string; type: 'u16' }
	| { name: string; type: 'u8' }
	| { name: string; type: 'bool' }
	| { name: string; type: 'u64' }
	| { name: string; type: 'i64' }
	| { name: string; type: 'vec4' }
	| { name: string; type: 'refspec' }
	| { name: string; type: 'bytes8' }
	| { name: string; type: 'pad'; size: number }
	| { name: string; type: 'align16' }
	| { name: string; type: 'refspec_array'; count: number }
	| { name: string; type: 'i32_array'; countField: string };

export type AttribSchema = {
	classHash: bigint;
	name: string;
	fields: FieldSpec[];
};

export type RefSpecValue = {
	classKey: bigint;
	collectionKey: bigint;
	collectionPtr: number;
};

export type ParsedAttribute = {
	className: string;
	classHash: bigint;
	fields: Record<string, unknown>;
};

// ---- Generic reader/writer ----

function readRefSpec(r: BinReader): RefSpecValue {
	const classKey = r.readU64();
	const collectionKey = r.readU64();
	const collectionPtr = r.readU32();
	r.readU32(); // 4-byte padding
	return { classKey, collectionKey, collectionPtr };
}

function writeRefSpec(w: BinWriter, v: RefSpecValue): void {
	w.writeU64(v.classKey);
	w.writeU64(v.collectionKey);
	w.writeU32(v.collectionPtr);
	w.writeU32(0); // 4-byte padding
}

export function readAttribute(r: BinReader, schema: AttribSchema): ParsedAttribute {
	const fields: Record<string, unknown> = {};
	for (const f of schema.fields) {
		switch (f.type) {
			case 'f32': fields[f.name] = r.readF32(); break;
			case 'i32': fields[f.name] = r.readI32(); break;
			case 'u16': fields[f.name] = r.readU16(); break;
			case 'u8': fields[f.name] = r.readU8(); break;
			case 'bool': fields[f.name] = r.readU8() !== 0; break;
			case 'u64': fields[f.name] = r.readU64(); break;
			case 'i64': {
				const v = r.readU64();
				fields[f.name] = BigInt.asIntN(64, v);
				break;
			}
			case 'vec4':
				fields[f.name] = [r.readF32(), r.readF32(), r.readF32(), r.readF32()];
				break;
			case 'refspec':
				fields[f.name] = readRefSpec(r);
				break;
			case 'bytes8': {
				const b: number[] = [];
				for (let i = 0; i < 8; i++) b.push(r.readU8());
				fields[f.name] = b;
				break;
			}
			case 'pad': {
				// Read and discard padding bytes, but store them for roundtrip
				const b: number[] = [];
				for (let i = 0; i < f.size; i++) b.push(r.readU8());
				fields[f.name] = b;
				break;
			}
			case 'align16': {
				const mod = r.position % 16;
				const skip = mod === 0 ? 0 : 16 - mod;
				for (let i = 0; i < skip; i++) r.readU8();
				fields[f.name] = skip; // store amount for roundtrip
				break;
			}
			case 'refspec_array': {
				const arr: RefSpecValue[] = [];
				for (let i = 0; i < f.count; i++) arr.push(readRefSpec(r));
				fields[f.name] = arr;
				break;
			}
			case 'i32_array': {
				const alloc = fields[f.countField] as number;
				const arr: number[] = [];
				for (let i = 0; i < alloc; i++) arr.push(r.readI32());
				fields[f.name] = arr;
				break;
			}
		}
	}
	return { className: schema.name, classHash: schema.classHash, fields };
}

export function writeAttribute(w: BinWriter, schema: AttribSchema, data: Record<string, unknown>): void {
	for (const f of schema.fields) {
		switch (f.type) {
			case 'f32': w.writeF32(data[f.name] as number); break;
			case 'i32': w.writeI32(data[f.name] as number); break;
			case 'u16': w.writeU16(data[f.name] as number); break;
			case 'u8': w.writeU8(data[f.name] as number); break;
			case 'bool': w.writeU8((data[f.name] as boolean) ? 1 : 0); break;
			case 'u64': w.writeU64(data[f.name] as bigint); break;
			case 'i64': w.writeU64(BigInt.asUintN(64, data[f.name] as bigint)); break;
			case 'vec4': {
				const v = data[f.name] as number[];
				w.writeF32(v[0]); w.writeF32(v[1]); w.writeF32(v[2]); w.writeF32(v[3]);
				break;
			}
			case 'refspec':
				writeRefSpec(w, data[f.name] as RefSpecValue);
				break;
			case 'bytes8': {
				const b = data[f.name] as number[];
				for (let i = 0; i < 8; i++) w.writeU8(b[i] ?? 0);
				break;
			}
			case 'pad': {
				const b = data[f.name] as number[] | undefined;
				if (b) for (let i = 0; i < f.size; i++) w.writeU8(b[i] ?? 0);
				else w.writeZeroes(f.size);
				break;
			}
			case 'align16': w.align16(); break;
			case 'refspec_array': {
				const arr = data[f.name] as RefSpecValue[];
				for (const rs of arr) writeRefSpec(w, rs);
				break;
			}
			case 'i32_array': {
				const alloc = data[f.countField] as number;
				const arr = data[f.name] as number[];
				for (let i = 0; i < alloc; i++) w.writeI32(arr[i] ?? 0);
				break;
			}
		}
	}
}

// ---- Attribute schemas ----

const physicsvehicleengineattribs: AttribSchema = {
	classHash: 0xF850281CA54C9B92n, name: 'physicsvehicleengineattribs',
	fields: [
		{ name: 'TorqueScales2', type: 'vec4' },
		{ name: 'TorqueScales1', type: 'vec4' },
		{ name: 'GearUpRPMs2', type: 'vec4' },
		{ name: 'GearUpRPMs1', type: 'vec4' },
		{ name: 'GearRatios2', type: 'vec4' },
		{ name: 'GearRatios1', type: 'vec4' },
		{ name: 'TransmissionEfficiency', type: 'f32' },
		{ name: 'TorqueFallOffRPM', type: 'f32' },
		{ name: 'MaxTorque', type: 'f32' },
		{ name: 'MaxRPM', type: 'f32' },
		{ name: 'LSDMGearUpSpeed', type: 'f32' },
		{ name: 'GearChangeTime', type: 'f32' },
		{ name: 'FlyWheelInertia', type: 'f32' },
		{ name: 'FlyWheelFriction', type: 'f32' },
		{ name: 'EngineResistance', type: 'f32' },
		{ name: 'EngineLowEndTorqueFactor', type: 'f32' },
		{ name: 'EngineBraking', type: 'f32' },
		{ name: 'Differential', type: 'f32' },
	],
};

const physicsvehicledriftattribs: AttribSchema = {
	classHash: 0x3F9370FCF8D767ACn, name: 'physicsvehicledriftattribs',
	fields: [
		{ name: 'DriftScaleToYawTorque', type: 'vec4' },
		{ name: 'WheelSlip', type: 'f32' },
		{ name: 'TimeToCapScale', type: 'f32' },
		{ name: 'TimeForNaturalDrift', type: 'f32' },
		{ name: 'SteeringDriftScaleFactor', type: 'f32' },
		{ name: 'SideForcePeakDriftAngle', type: 'f32' },
		{ name: 'SideForceMagnitude', type: 'f32' },
		{ name: 'SideForceDriftSpeedCutOff', type: 'f32' },
		{ name: 'SideForceDriftAngleCutOff', type: 'f32' },
		{ name: 'SideForceDirftScaleCutOff', type: 'f32' },
		{ name: 'NeutralTimeToReduceDrift', type: 'f32' },
		{ name: 'NaturalYawTorqueCutOffAngle', type: 'f32' },
		{ name: 'NaturalYawTorque', type: 'f32' },
		{ name: 'NaturalDriftTimeToReachBaseSlip', type: 'f32' },
		{ name: 'NaturalDriftStartSlip', type: 'f32' },
		{ name: 'NaturalDriftScaleDecay', type: 'f32' },
		{ name: 'MinSpeedForDrift', type: 'f32' },
		{ name: 'InitialDriftPushTime', type: 'f32' },
		{ name: 'InitialDriftPushScaleLimit', type: 'f32' },
		{ name: 'InitialDriftPushDynamicInc', type: 'f32' },
		{ name: 'InitialDriftPushBaseInc', type: 'f32' },
		{ name: 'GripFromSteering', type: 'f32' },
		{ name: 'GripFromGasLetOff', type: 'f32' },
		{ name: 'GripFromBrake', type: 'f32' },
		{ name: 'GasDriftScaleFactor', type: 'f32' },
		{ name: 'ForcedDriftTimeToReachBaseSlip', type: 'f32' },
		{ name: 'ForcedDriftStartSlip', type: 'f32' },
		{ name: 'DriftTorqueFallOff', type: 'f32' },
		{ name: 'DriftSidewaysDamping', type: 'f32' },
		{ name: 'DriftMaxAngle', type: 'f32' },
		{ name: 'DriftAngularDamping', type: 'f32' },
		{ name: 'CounterSteeringDriftScaleFactor', type: 'f32' },
		{ name: 'CappedScale', type: 'f32' },
		{ name: 'BrakingDriftScaleFactor', type: 'f32' },
		{ name: 'BaseCounterSteeringDriftScaleFactor', type: 'f32' },
		{ name: '_driftPad', type: 'pad', size: 8 },
	],
};

const physicsvehiclecollisionattribs: AttribSchema = {
	classHash: 0xDF956BC0568F138Cn, name: 'physicsvehiclecollisionattribs',
	fields: [
		{ name: 'BodyBox', type: 'vec4' },
	],
};

const physicsvehiclesuspensionattribs: AttribSchema = {
	classHash: 0x4297B5841F5231CFn, name: 'physicsvehiclesuspensionattribs',
	fields: [
		{ name: 'UpwardMovement', type: 'f32' },
		{ name: 'TimeToDampAfterLanding', type: 'f32' },
		{ name: 'Strength', type: 'f32' },
		{ name: 'SpringLength', type: 'f32' },
		{ name: 'RearHeight', type: 'f32' },
		{ name: 'MaxYawDampingOnLanding', type: 'f32' },
		{ name: 'MaxVertVelocityDampingOnLanding', type: 'f32' },
		{ name: 'MaxRollDampingOnLanding', type: 'f32' },
		{ name: 'MaxPitchDampingOnLanding', type: 'f32' },
		{ name: 'InAirDamping', type: 'f32' },
		{ name: 'FrontHeight', type: 'f32' },
		{ name: 'DownwardMovement', type: 'f32' },
		{ name: 'Dampening', type: 'f32' },
	],
};

const physicsvehiclesteeringattribs: AttribSchema = {
	classHash: 0x43462C59212A23CCn, name: 'physicsvehiclesteeringattribs',
	fields: [
		{ name: 'TimeForLock', type: 'f32' },
		{ name: 'StraightReactionBias', type: 'f32' },
		{ name: 'SpeedForMinAngle', type: 'f32' },
		{ name: 'SpeedForMaxAngle', type: 'f32' },
		{ name: 'MinAngle', type: 'f32' },
		{ name: 'MaxAngle', type: 'f32' },
		{ name: 'AiPidCoefficientP', type: 'f32' },
		{ name: 'AiPidCoefficientI', type: 'f32' },
		{ name: 'AiPidCoefficientDriftP', type: 'f32' },
		{ name: 'AiPidCoefficientDriftI', type: 'f32' },
		{ name: 'AiPidCoefficientDriftD', type: 'f32' },
		{ name: 'AiPidCoefficientD', type: 'f32' },
		{ name: 'AiMinLookAheadDistanceForDrift', type: 'f32' },
		{ name: 'AiLookAheadTimeForDrift', type: 'f32' },
		{ name: '_steeringPad', type: 'pad', size: 4 },
	],
};

const physicsvehiclehandling: AttribSchema = {
	classHash: 0x966121397B502EEDn, name: 'physicsvehiclehandling',
	fields: [
		{ name: 'PhysicsVehicleSuspensionAttribs', type: 'refspec' },
		{ name: 'PhysicsVehicleSteeringAttribs', type: 'refspec' },
		{ name: 'PhysicsVehicleEngineAttribs', type: 'refspec' },
		{ name: 'PhysicsVehicleDriftAttribs', type: 'refspec' },
		{ name: 'PhysicsVehicleCollisionAttribs', type: 'refspec' },
		{ name: 'PhysicsVehicleBoostAttribs', type: 'refspec' },
		{ name: 'PhysicsVehicleBodyRollAttribs', type: 'refspec' },
		{ name: 'PhysicsVehicleBaseAttribs', type: 'refspec' },
	],
};

const physicsvehicleboostattribs: AttribSchema = {
	classHash: 0xEADE7049AF7AB31En, name: 'physicsvehicleboostattribs',
	fields: [
		{ name: 'MaxBoostSpeed', type: 'f32' },
		{ name: 'BoostRule', type: 'i32' },
		{ name: 'BoostKickTime', type: 'f32' },
		{ name: 'BoostKickMinTime', type: 'f32' },
		{ name: 'BoostKickMaxTime', type: 'f32' },
		{ name: 'BoostKickMaxStartSpeed', type: 'f32' },
		{ name: 'BoostKickHeightOffset', type: 'f32' },
		{ name: 'BoostKickAcceleration', type: 'f32' },
		{ name: 'BoostKick', type: 'f32' },
		{ name: 'BoostHeightOffset', type: 'f32' },
		{ name: 'BoostBase', type: 'f32' },
		{ name: 'BoostAcceleration', type: 'f32' },
		{ name: 'BlueMaxBoostSpeed', type: 'f32' },
		{ name: 'BlueBoostKickTime', type: 'f32' },
		{ name: 'BlueBoostKick', type: 'f32' },
		{ name: 'BlueBoostBase', type: 'f32' },
	],
};

const camerabumperbehaviour: AttribSchema = {
	classHash: 0xF3E3F8EF855F4F99n, name: 'camerabumperbehaviour',
	fields: [
		{ name: 'ZOffset', type: 'f32' },
		{ name: 'YOffset', type: 'f32' },
		{ name: 'YawSpring', type: 'f32' },
		{ name: 'RollSpring', type: 'f32' },
		{ name: 'PitchSpring', type: 'f32' },
		{ name: 'FieldOfView', type: 'f32' },
		{ name: 'BoostFieldOfView', type: 'f32' },
		{ name: 'BodyRollScale', type: 'f32' },
		{ name: 'BodyPitchScale', type: 'f32' },
		{ name: 'AccelerationResponse', type: 'f32' },
		{ name: 'AccelerationDampening', type: 'f32' },
	],
};

const burnoutcargraphicsasset: AttribSchema = {
	classHash: 0xF0FF4DFD660F5A54n, name: 'burnoutcargraphicsasset',
	fields: [
		{ name: 'PlayerPalletteIndex', type: 'i32' },
		{ name: 'PlayerColourIndex', type: 'i32' },
		{ name: 'Alloc', type: 'u16' },
		{ name: 'Num_RandomTrafficColours', type: 'u16' },
		{ name: 'Size', type: 'u16' },
		{ name: 'EncodedTypePad', type: 'u16' },
		{ name: 'RandomTrafficColours', type: 'i32_array', countField: 'Alloc' },
		{ name: 'Alloc_Offences', type: 'u16' },
		{ name: 'Num_Offences', type: 'u16' },
		{ name: 'Size_Offences', type: 'u16' },
		{ name: 'EncodedTypePad_Offences', type: 'u16' },
	],
};

const burnoutcarasset: AttribSchema = {
	classHash: 0x52B81656F3ADF675n, name: 'burnoutcarasset',
	fields: [
		{ name: 'Offences', type: 'refspec_array', count: 12 },
		{ name: 'SoundExhaustAsset', type: 'refspec' },
		{ name: 'SoundEngineAsset', type: 'refspec' },
		{ name: 'PhysicsVehicleHandlingAsset', type: 'refspec' },
		{ name: 'GraphicsAsset', type: 'refspec' },
		{ name: 'CarUnlockShot', type: 'refspec' },
		{ name: 'CameraExternalBehaviourAsset', type: 'refspec' },
		{ name: 'CameraBumperBehaviourAsset', type: 'refspec' },
		{ name: 'VehicleID', type: 'bytes8' },
		{ name: 'PhysicsAsset', type: 'i64' },
		{ name: 'MasterSceneMayaBinaryFile', type: 'i64' },
		{ name: 'InGameName', type: 'bytes8' },
		{ name: 'GameplayAsset', type: 'i64' },
		{ name: 'ExhaustName', type: 'bytes8' },
		{ name: 'ExhaustEntityKey', type: 'i64' },
		{ name: 'EngineName', type: 'bytes8' },
		{ name: 'EngineEntityKey', type: 'i64' },
		{ name: 'DefaultWheel', type: 'i64' },
		{ name: 'BuildThisVehicle', type: 'bool' },
		{ name: '_carAssetPad', type: 'pad', size: 3 },
	],
};

const physicsvehiclebodyrollattribs: AttribSchema = {
	classHash: 0x2E3B1DC7D248445En, name: 'physicsvehiclebodyrollattribs',
	fields: [
		{ name: 'WheelLongForceHeightOffset', type: 'f32' },
		{ name: 'WheelLatForceHeightOffset', type: 'f32' },
		{ name: 'WeightTransferDecayZ', type: 'f32' },
		{ name: 'WeightTransferDecayX', type: 'f32' },
		{ name: 'RollSpringStiffness', type: 'f32' },
		{ name: 'RollSpringDampening', type: 'f32' },
		{ name: 'PitchSpringStiffness', type: 'f32' },
		{ name: 'PitchSpringDampening', type: 'f32' },
		{ name: 'FactorOfWeightZ', type: 'f32' },
		{ name: 'FactorOfWeightX', type: 'f32' },
		{ name: '_bodyRollPad', type: 'pad', size: 4 },
	],
};

const physicsvehiclebaseattribs: AttribSchema = {
	classHash: 0xF79C545E141DFFA6n, name: 'physicsvehiclebaseattribs',
	fields: [
		{ name: '_baseAlign', type: 'align16' },
		{ name: 'RearRightWheelPosition', type: 'vec4' },
		{ name: 'FrontRightWheelPosition', type: 'vec4' },
		{ name: 'CoMOffset', type: 'vec4' },
		{ name: 'BrakeScaleToFactor', type: 'vec4' },
		{ name: 'YawDampingOnTakeOff', type: 'f32' },
		{ name: 'TractionLineLength', type: 'f32' },
		{ name: 'TimeForFullBrake', type: 'f32' },
		{ name: 'SurfaceRoughnessFactor', type: 'f32' },
		{ name: 'SurfaceRearGripFactor', type: 'f32' },
		{ name: 'SurfaceFrontGripFactor', type: 'f32' },
		{ name: 'SurfaceDragFactor', type: 'f32' },
		{ name: 'RollLimitOnTakeOff', type: 'f32' },
		{ name: 'RollDampingOnTakeOff', type: 'f32' },
		{ name: 'RearWheelMass', type: 'f32' },
		{ name: 'RearTireStaticFrictionCoefficient', type: 'f32' },
		{ name: 'RearTireLongForceBias', type: 'f32' },
		{ name: 'RearTireDynamicFrictionCoefficient', type: 'f32' },
		{ name: 'RearTireAdhesiveLimit', type: 'f32' },
		{ name: 'RearLongGripCurvePeakSlipRatio', type: 'f32' },
		{ name: 'RearLongGripCurvePeakCoefficient', type: 'f32' },
		{ name: 'RearLongGripCurveFloorSlipRatio', type: 'f32' },
		{ name: 'RearLongGripCurveFallCoefficient', type: 'f32' },
		{ name: 'RearLatGripCurvePeakSlipRatio', type: 'f32' },
		{ name: 'RearLatGripCurvePeakCoefficient', type: 'f32' },
		{ name: 'RearLatGripCurveFloorSlipRatio', type: 'f32' },
		{ name: 'RearLatGripCurveFallCoefficient', type: 'f32' },
		{ name: 'RearLatGripCurveDriftPeakSlipRatio', type: 'f32' },
		{ name: 'PowerToRear', type: 'f32' },
		{ name: 'PowerToFront', type: 'f32' },
		{ name: 'PitchDampingOnTakeOff', type: 'f32' },
		{ name: 'MaxSpeed', type: 'f32' },
		{ name: 'MagicBrakeFactorTurning', type: 'f32' },
		{ name: 'MagicBrakeFactorStraightLine', type: 'f32' },
		{ name: 'LowSpeedTyreFrictionTractionControl', type: 'f32' },
		{ name: 'LowSpeedThrottleTractionControl', type: 'f32' },
		{ name: 'LowSpeedDrivingSpeed', type: 'f32' },
		{ name: 'LockBrakeScale', type: 'f32' },
		{ name: 'LinearDrag', type: 'f32' },
		{ name: 'HighSpeedAngularDamping', type: 'f32' },
		{ name: 'FrontWheelMass', type: 'f32' },
		{ name: 'FrontTireStaticFrictionCoefficient', type: 'f32' },
		{ name: 'FrontTireLongForceBias', type: 'f32' },
		{ name: 'FrontTireDynamicFrictionCoefficient', type: 'f32' },
		{ name: 'FrontTireAdhesiveLimit', type: 'f32' },
		{ name: 'FrontLongGripCurvePeakSlipRatio', type: 'f32' },
		{ name: 'FrontLongGripCurvePeakCoefficient', type: 'f32' },
		{ name: 'FrontLongGripCurveFloorSlipRatio', type: 'f32' },
		{ name: 'FrontLongGripCurveFallCoefficient', type: 'f32' },
		{ name: 'FrontLatGripCurvePeakSlipRatio', type: 'f32' },
		{ name: 'FrontLatGripCurvePeakCoefficient', type: 'f32' },
		{ name: 'FrontLatGripCurveFloorSlipRatio', type: 'f32' },
		{ name: 'FrontLatGripCurveFallCoefficient', type: 'f32' },
		{ name: 'FrontLatGripCurveDriftPeakSlipRatio', type: 'f32' },
		{ name: 'DrivingMass', type: 'f32' },
		{ name: 'DriveTimeDeformLimitX', type: 'f32' },
		{ name: 'DriveTimeDeformLimitPosZ', type: 'f32' },
		{ name: 'DriveTimeDeformLimitNegZ', type: 'f32' },
		{ name: 'DriveTimeDeformLimitNegY', type: 'f32' },
		{ name: 'DownForceZOffset', type: 'f32' },
		{ name: 'DownForce', type: 'f32' },
		{ name: 'CrashExtraYawVelocityFactor', type: 'f32' },
		{ name: 'CrashExtraRollVelocityFactor', type: 'f32' },
		{ name: 'CrashExtraPitchVelocityFactor', type: 'f32' },
		{ name: 'CrashExtraLinearVelocityFactor', type: 'f32' },
		{ name: 'AngularDrag', type: 'f32' },
	],
};

const cameraexternalbehaviour: AttribSchema = {
	classHash: 0xE9EDA3B8C4EA3C84n, name: 'cameraexternalbehaviour',
	fields: [
		{ name: 'ZDistanceScale', type: 'f32' },
		{ name: 'ZAndTiltCutoffSpeedMPH', type: 'f32' },
		{ name: 'YawSpring', type: 'f32' },
		{ name: 'TiltCameraScale', type: 'f32' },
		{ name: 'TiltAroundCar', type: 'f32' },
		{ name: 'SlideZOffsetMax', type: 'f32' },
		{ name: 'SlideYScale', type: 'f32' },
		{ name: 'SlideXScale', type: 'f32' },
		{ name: 'PivotZOffset', type: 'f32' },
		{ name: 'PivotLength', type: 'f32' },
		{ name: 'PivotHeight', type: 'f32' },
		{ name: 'PitchSpring', type: 'f32' },
		{ name: 'FieldOfView', type: 'f32' },
		{ name: 'DriftYawSpring', type: 'f32' },
		{ name: 'DownAngle', type: 'f32' },
		{ name: 'BoostFieldOfViewZoom', type: 'f32' },
		{ name: 'BoostFieldOfView', type: 'f32' },
	],
};

// ---- Schema registry ----

const ALL_SCHEMAS: AttribSchema[] = [
	physicsvehicleengineattribs,
	physicsvehicledriftattribs,
	physicsvehiclecollisionattribs,
	physicsvehiclesuspensionattribs,
	physicsvehiclesteeringattribs,
	physicsvehiclehandling,
	physicsvehicleboostattribs,
	camerabumperbehaviour,
	burnoutcargraphicsasset,
	burnoutcarasset,
	physicsvehiclebodyrollattribs,
	physicsvehiclebaseattribs,
	cameraexternalbehaviour,
];

const SCHEMA_BY_HASH = new Map<bigint, AttribSchema>();
for (const s of ALL_SCHEMAS) SCHEMA_BY_HASH.set(s.classHash, s);

export function getSchemaByClassHash(hash: bigint): AttribSchema | undefined {
	return SCHEMA_BY_HASH.get(hash);
}

// ---- High-level bin parse/write ----

export function parseVehicleBinData(
	binRaw: number[],
	le: boolean,
	classHashes: bigint[],
): { strERaw: number[]; attributes: ParsedAttribute[] } | null {
	// Check all classHashes are known
	for (const h of classHashes) {
		if (!SCHEMA_BY_HASH.has(h)) return null; // unknown class → fall back to raw
	}

	const buf = new Uint8Array(binRaw);
	const view = new DataView(buf.buffer);

	// Read StrE chunk size
	const streSize = view.getUint32(4, le);
	const strERaw = Array.from(buf.slice(0, streSize));

	// Parse attributes from bin data after StrE
	const r = new BinReader(buf.buffer.slice(streSize), le);
	const attributes: ParsedAttribute[] = [];
	for (const h of classHashes) {
		const schema = SCHEMA_BY_HASH.get(h)!;
		attributes.push(readAttribute(r, schema));
	}

	return { strERaw, attributes };
}

export function writeVehicleBinData(
	strERaw: number[],
	attributes: ParsedAttribute[],
	le: boolean,
): number[] {
	const w = new BinWriter(4096, le);

	// Write StrE chunk (raw copy)
	w.writeBytes(new Uint8Array(strERaw));

	// Write attributes
	for (const attr of attributes) {
		const schema = SCHEMA_BY_HASH.get(attr.classHash);
		if (!schema) throw new Error(`Unknown classHash: 0x${attr.classHash.toString(16)}`);
		writeAttribute(w, schema, attr.fields);
	}

	return Array.from(w.bytes);
}

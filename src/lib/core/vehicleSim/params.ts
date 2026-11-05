// The race car's driving parameters, gathered once from the car's AttribSys
// vault (the _AT bundle) and its DeformationSpec. Every number the vehicle
// step reads lives here, in SI units except where a field says mph.
//
// Field names follow what the game does with the value, not always the vault
// name. The game streams a few attribs into other roles:
//   - base.CoMOffset.x is not part of the centre of mass (the game forces it
//     to 0; the word really belongs to the drift code), only .y and .z count;
//   - drift.WheelSlip is the aerodynamic lift coefficient (`downForceLiftCo`);
//   - collision.BodyBox is [crash speed mph, car angular impulse scale, -, -];
//   - the handbrake's yaw damping reads base.RollDampingOnTakeOff;
//   - TimeForFullBrake and TimeForLock are used as reciprocals.
// The front/rear wheel masses and the bodyroll weight-transfer attribs exist
// in the vault but the game never reads them (wheels weigh 30 kg).

import type { ParsedAttribSys } from '../attribSys';
import type { ParsedDeformationSpec, Vec3 } from '../deformationSpec';
import { sub } from '../deformationSim/state';
import { boxInvInertia } from './body';

export type GripCurve = { peakSlip: number; floorSlip: number; peakCo: number; fallCo: number };
export type TyreParams = {
	staticFriction: number; dynamicFriction: number; longForceBias: number; adhesiveLimit: number;
	long: GripCurve; lat: GripCurve;
};
export type Box = { min: Vec3; max: Vec3 };

export type WheelParams = {
	front: boolean;
	radius: number;
	streamed: Vec3;   // rest hub position, body frame (centre of mass origin)
	yMin: number;     // lowest hub y (full droop)
	yMax: number;     // highest hub y (full bump)
	scaler: number;   // share of the body's weight this corner carries at rest
};

export type VehicleParams = {
	mass: number;
	halfExtent: Vec3;
	invILocal: Vec3;
	comSpec: Vec3;         // centre of mass in the deformation spec frame
	aabb: Box;             // sensor-sphere box, body frame; the crash arm's front-face test
	wheels: [WheelParams, WheelParams, WheelParams, WheelParams];
	base: {
		maxSpeedMph: number; linearDrag: number; highSpeedAngularDamping: number; lowSpeedDrivingMph: number;
		downForce: number; downForceLiftCo: number; powerToRear: number; powerToFront: number;
		tractionLineLength: number; invTimeForFullBrake: number; brakeCurve: Vec3;
		magicBrakeStraight: number; magicBrakeTurning: number; handbrakeYawDamping: number;
		surfaceFrontGrip: number; surfaceRearGrip: number; surfaceDrag: number;
		lowSpeedTyreTractionControl: number; lowSpeedThrottleTractionControl: number;
		// Crash entry multipliers on w (world x, y, z components) and horizontal v.
		crashExtraAngular: Vec3; crashExtraLinear: number;
		minSpeedForDriftMph: number;
		// How far a knock (a hit outside a crash) may crush the sensors:
		// side, -Y, +Z, -Z.
		driveTimeLimits: [number, number, number, number];
	};
	front: TyreParams;
	rear: TyreParams;
	susp: {
		restDisp: number; dampening: number; inAirDamping: number; upward: number; downward: number;
		frontHeight: number; rearHeight: number; timeToDampAfterLanding: number;
		maxPitchDampingOnLanding: number; maxRollDampingOnLanding: number; maxVertVelocityDampingOnLanding: number;
	};
	wheelLongForceHeight: number;
	wheelLatForceHeight: number;
	engine: {
		ratios: number[]; upRpm: number[]; torqueScale: number[];   // index = gear, 0 = reverse
		torqueCurve: Vec3; torqueFallOffRpm: number; maxRpm: number; differential: number; transmissionEfficiency: number;
		flyWheelInertia: number; flyWheelFriction: number; gearChangeTime: number;
	};
	steering: { maxAngleDeg: number; minAngleDeg: number; reactionPerSec: number; straightReactionBias: number };
	carAngularImpulseScale: number;
};

// className -> field -> value, one record per attribute class in the vault.
export type AttribClasses = Record<string, Record<string, unknown>>;

export function attribClasses(vault: ParsedAttribSys | undefined): AttribClasses {
	const out: AttribClasses = {};
	for (const a of vault?.attributes ?? []) out[a.className] = { ...(out[a.className] ?? {}), ...a.fields };
	return out;
}

const MIN_DOWN_TRAVEL = 0.025;

export function buildVehicleParams(vault: ParsedAttribSys | undefined, spec: ParsedDeformationSpec): VehicleParams {
	return paramsFromClasses(attribClasses(vault), spec);
}

export function paramsFromClasses(classes: AttribClasses, spec: ParsedDeformationSpec): VehicleParams {
	const missing: string[] = [];
	const read = (cls: string) => {
		const rec = classes[`physicsvehicle${cls}`] ?? {};
		const num = (k: string): number => {
			const v = rec[k];
			if (typeof v === 'number') return v;
			missing.push(`${cls}.${k}`);
			return 0;
		};
		const vec = (k: string): number[] => {
			const v = rec[k];
			if (Array.isArray(v) && v.every((x) => typeof x === 'number')) return v as number[];
			missing.push(`${cls}.${k}`);
			return [0, 0, 0, 0];
		};
		return { num, vec };
	};
	const base = read('baseattribs'), drift = read('driftattribs'), susp = read('suspensionattribs');
	const roll = read('bodyrollattribs'), eng = read('engineattribs'), steer = read('steeringattribs');
	const coll = read('collisionattribs');

	const mass = base.num('DrivingMass');
	const com = base.vec('CoMOffset');
	const hd = spec.handlingBodyDimensions;
	const halfExtent: Vec3 = [hd[0], hd[1], hd[2]];
	const mean = spec.wheels.reduce<Vec3>((m, w) => [m[0] + w.position[0] / 4, m[1] + w.position[1] / 4, m[2] + w.position[2] / 4], [0, 0, 0]);
	const comSpec: Vec3 = [mean[0], mean[1] + com[1], mean[2] + com[2]];

	const up = susp.num('UpwardMovement'), down = Math.max(susp.num('DownwardMovement'), MIN_DOWN_TRAVEL);
	const frontHeight = susp.num('FrontHeight'), rearHeight = susp.num('RearHeight');
	const streamed = spec.wheels.map((w, i) =>
		sub([w.position[0], w.position[1] + (i < 2 ? frontHeight : rearHeight), w.position[2]], comSpec));
	// Static load split: each corner's share from its distance to the other
	// axle and the other side (exactly 1/4 for a centred car).
	const SIDE = [1, 0, 3, 2], AXLE = [2, 3, 0, 1];
	const wheels = streamed.map((s, i) => {
		const rx = Math.abs(s[0] / (streamed[SIDE[i]][0] - s[0]));
		const rz = Math.abs(s[2] / (streamed[AXLE[i]][2] - s[2]));
		return {
			front: i < 2, radius: 0.5 * spec.wheels[i].direction[1], streamed: s,
			yMin: s[1] - down, yMax: s[1] + up, scaler: (1 - rx) * (1 - rz),
		};
	}) as VehicleParams['wheels'];

	const tyre = (end: 'Front' | 'Rear'): TyreParams => {
		const curve = (kind: 'Long' | 'Lat'): GripCurve => ({
			peakSlip: base.num(`${end}${kind}GripCurvePeakSlipRatio`), floorSlip: base.num(`${end}${kind}GripCurveFloorSlipRatio`),
			peakCo: base.num(`${end}${kind}GripCurvePeakCoefficient`), fallCo: base.num(`${end}${kind}GripCurveFallCoefficient`),
		});
		return {
			staticFriction: base.num(`${end}TireStaticFrictionCoefficient`), dynamicFriction: base.num(`${end}TireDynamicFrictionCoefficient`),
			longForceBias: base.num(`${end}TireLongForceBias`), adhesiveLimit: base.num(`${end}TireAdhesiveLimit`),
			long: curve('Long'), lat: curve('Lat'),
		};
	};

	const r1 = eng.vec('GearRatios1'), r2 = eng.vec('GearRatios2');
	const u1 = eng.vec('GearUpRPMs1'), u2 = eng.vec('GearUpRPMs2');
	const t1 = eng.vec('TorqueScales1'), t2 = eng.vec('TorqueScales2');
	const maxTorque = eng.num('MaxTorque'), lowEnd = eng.num('EngineLowEndTorqueFactor');
	const brake = base.vec('BrakeScaleToFactor');
	const angScale = coll.vec('BodyBox')[1];

	const p: VehicleParams = {
		mass, halfExtent, invILocal: boxInvInertia(halfExtent, mass), comSpec,
		aabb: sensorBox(spec, comSpec), wheels,
		base: {
			maxSpeedMph: base.num('MaxSpeed'), linearDrag: base.num('LinearDrag'),
			highSpeedAngularDamping: base.num('HighSpeedAngularDamping'), lowSpeedDrivingMph: base.num('LowSpeedDrivingSpeed'),
			downForce: base.num('DownForce'), downForceLiftCo: drift.num('WheelSlip'),
			powerToRear: base.num('PowerToRear'), powerToFront: base.num('PowerToFront'),
			tractionLineLength: Math.max(base.num('TractionLineLength'), 0), invTimeForFullBrake: 1 / base.num('TimeForFullBrake'),
			brakeCurve: [brake[0], brake[1], brake[2]],
			magicBrakeStraight: base.num('MagicBrakeFactorStraightLine'), magicBrakeTurning: base.num('MagicBrakeFactorTurning'),
			handbrakeYawDamping: base.num('RollDampingOnTakeOff'),
			surfaceFrontGrip: base.num('SurfaceFrontGripFactor'), surfaceRearGrip: base.num('SurfaceRearGripFactor'),
			surfaceDrag: base.num('SurfaceDragFactor'),
			lowSpeedTyreTractionControl: base.num('LowSpeedTyreFrictionTractionControl'),
			lowSpeedThrottleTractionControl: base.num('LowSpeedThrottleTractionControl'),
			// The pitch factor is forced to 0 when the attribs stream in.
			crashExtraAngular: [0, base.num('CrashExtraYawVelocityFactor'), base.num('CrashExtraRollVelocityFactor')],
			crashExtraLinear: base.num('CrashExtraLinearVelocityFactor'),
			minSpeedForDriftMph: drift.num('MinSpeedForDrift'),
			driveTimeLimits: [
				base.num('DriveTimeDeformLimitX'), base.num('DriveTimeDeformLimitNegY'),
				base.num('DriveTimeDeformLimitPosZ'), base.num('DriveTimeDeformLimitNegZ'),
			],
		},
		front: tyre('Front'), rear: tyre('Rear'),
		susp: {
			restDisp: susp.num('SpringLength'), dampening: susp.num('Dampening'), inAirDamping: susp.num('InAirDamping'),
			upward: up, downward: down, frontHeight, rearHeight, timeToDampAfterLanding: susp.num('TimeToDampAfterLanding'),
			maxPitchDampingOnLanding: susp.num('MaxPitchDampingOnLanding'), maxRollDampingOnLanding: susp.num('MaxRollDampingOnLanding'),
			maxVertVelocityDampingOnLanding: susp.num('MaxVertVelocityDampingOnLanding'),
		},
		wheelLongForceHeight: roll.num('WheelLongForceHeightOffset'),
		wheelLatForceHeight: roll.num('WheelLatForceHeightOffset'),
		engine: {
			ratios: [r1[0], r1[1], r1[2], r2[0], r2[1], r2[2]],
			upRpm: [u1[0], u1[1], u1[2], u2[0], u2[1], u2[2]],
			torqueScale: [t1[0], t1[1], t1[2], t2[0], t2[1], t2[2]],
			// The torque curve's control points as the game builds them.
			torqueCurve: [maxTorque * lowEnd, maxTorque * 2 - lowEnd * 0.5, 0],
			torqueFallOffRpm: eng.num('TorqueFallOffRPM'), maxRpm: eng.num('MaxRPM'), differential: eng.num('Differential'),
			transmissionEfficiency: eng.num('TransmissionEfficiency'),
			flyWheelInertia: eng.num('FlyWheelInertia'), flyWheelFriction: eng.num('FlyWheelFriction'),
			gearChangeTime: eng.num('GearChangeTime'),
		},
		steering: {
			maxAngleDeg: steer.num('MaxAngle'), minAngleDeg: steer.num('MinAngle'),
			reactionPerSec: 1 / steer.num('TimeForLock'), straightReactionBias: steer.num('StraightReactionBias'),
		},
		carAngularImpulseScale: angScale <= 0.01 ? 1 : Math.min(Math.max(angScale, 0), 1),
	};
	if (missing.length) throw new Error(`vehicle attribs missing: ${missing.join(', ')}`);
	return p;
}

// The box over the deformation sensor spheres, in the body frame. The game
// grows it from zero, so it always contains the centre of mass.
export function sensorBox(spec: ParsedDeformationSpec, comSpec: Vec3): Box {
	const min: Vec3 = [0, 0, 0], max: Vec3 = [0, 0, 0];
	for (let i = 0; i < spec.numDeformationSensors; i++) {
		const s = spec.sensors[i];
		const c = sub(s.initialOffset, comSpec);
		for (let k = 0; k < 3; k++) {
			min[k] = Math.min(min[k], c[k] - s.radius);
			max[k] = Math.max(max[k], c[k] + s.radius);
		}
	}
	return { min, max };
}

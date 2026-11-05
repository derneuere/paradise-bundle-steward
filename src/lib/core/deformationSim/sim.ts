// Crash simulator for one vehicle DeformationSpec: the race car's own driving
// and crashing physics (vehicleSim), stepped at the game's fixed 60 Hz, with
// the deformation model as its contact side:
//
//   A  contacts generated from the start pose (sensor and wheel hub spheres
//      against the ground and the obstacle); a car that is not crashing
//      re-points or drops its road contacts (validate.ts)
//   E  the crash test on up to five of them, earliest first (crashArm.ts)
//   G  the vehicle update: wheels, suspension, tyres, engine, crash rules
//   H  the contact impulses, sized one after another from the car's live
//      velocity; the sensors crush and pass what they do not absorb to the
//      body at the contact point (contacts.ts). Then, if anything dented:
//      detachment, IK, skin rows, glass and the deformable box
//   J  gravity and the pose
//   K  the wheels' post-step
//   L  penetration, by position alone (penetration.ts)
//
// then the hinges swing, the knocked-off parts fly, and the step's latches are
// cleared. Before a hit starts a run (scenario.ts) the car stands still.

import type { ParsedAttribSys } from '../attribSys';
import type { ParsedDeformationSpec, Vec3 } from '../deformationSpec';
import { vehicleParamsFor } from '../vehicleSim/defaultHandling';
import type { AttribClasses } from '../vehicleSim/params';
import type { StepHooks } from '../vehicleSim/step';
import { createVehicle } from '../vehicleSim/vehicleState';
import { allArmContacts, crashArmContacts } from './crashArm';
import { clearContacts, generateContacts, nearestSensors, updateContacts } from './contacts';
import { clearEvents, emptyEvents, type CrashEvents } from './events';
import { freshPanes, updateGlass } from './glass';
import { drivenNormal, updateIK, updateSkinRows } from './ik';
import { checkForDetachment, hingePoint, initialPartState, jointRotation, poseMatrix, updateFreeParts, updateHinges } from './parts';
import { solvePenetration } from './penetration';
import { carMatrix, meshShift, mulAffine, specToWorld } from './pose';
import { placeAtRest, startRun, stepRun, type Impact } from './scenario';
import { driveTimeBox, updateDeformedBox } from './sensors';
import { sub, type SimState } from './state';
import { AbsorptionSet, STEP } from './tables';
import { validateWorldContacts } from './validate';
import { initialLooseState, updateSpinningDetachment } from './parts';
import { updateWheelTags } from './wheelDetach';

export { AbsorptionSet } from './tables';
export { GlassState } from './events';
export type { ContactEvent, CrashEvents, GlassEvent, PartEvent } from './events';
export type { CrashRun, Impact, Launch, RunEnd } from './scenario';

// A part's whole pose: its mesh frame to the world (column-major 4x4).
// Hinged parts swing in the car's frame; detached ones fly on their own.
export type PartPose = { world: number[]; state: 'hinged' | 'detached' };

export type CrashSim = {
	readonly state: SimState;
	readonly options: CrashSimOptions;
	readonly rows: Float32Array;
	readonly partPoses: Map<number, PartPose>;   // keyed by GraphicsSpec part index
	readonly sensorCount: number;
	readonly tagCount: number;
	// What the last step produced (see events.ts).
	readonly events: CrashEvents;
	// The car's mesh frame to the world (column-major 4x4).
	carMatrix(): number[];
	sensorPositionsWorld(): Vec3[];
	tagPositionsWorld(): Vec3[];
};

export type CrashSimOptions = {
	vault?: ParsedAttribSys;
	// Handling attribs over the vault's (and over the defaults, which fill
	// whatever neither has).
	handling?: AttribClasses;
	absorptionSet?: AbsorptionSet;
};

export { meshShift };

function freshState(spec: ParsedDeformationSpec, opts: CrashSimOptions): SimState {
	const params = vehicleParamsFor(spec, opts.vault, opts.handling);
	const vehicle = createVehicle(params);
	const s = {
		spec, absorptionSet: opts.absorptionSet ?? AbsorptionSet.Normal,
		vehicle, body: vehicle.body, com: params.comSpec,
		sensors: spec.sensors.map((x) => [...x.initialOffset] as Vec3),
		latch: spec.sensors.map(() => 0),
		scratch: spec.sensors.map(() => 0),
		tags: spec.tagPoints.map((t) => [...t.initialPosition] as Vec3),
		driven: spec.drivenPoints.map((d) => [...d.initialPos] as Vec3),
		drivenNormal: [],
		driveBox: { min: [0, 0, 0], max: [0, 0, 0] },
		partState: [], hinges: new Map(), free: new Map(), physicalParts: 0,
		attachedExhausts: spec.ikParts.filter((p) => p.partType === 84 || p.partType === 85).length,
		...initialLooseState(),
		wheelToSensor: [],
		potential: [], records: [], stored: [], disp: [],
		obstacle: null, run: null, deformedThisStep: false, rows: new Float32Array(512), time: 0,
		glass: [], events: emptyEvents(),
	} as SimState;
	s.wheelToSensor = nearestSensors(s);
	clearContacts(s);
	s.glass = freshPanes(s);
	s.drivenNormal = spec.drivenPoints.map((_, i) => drivenNormal(s, i));
	s.partState = spec.ikParts.map((_, p) => initialPartState(s, p));
	s.driveBox = driveTimeBox(s);
	placeAtRest(s);
	return s;
}

export function createCrashSim(spec: ParsedDeformationSpec, opts: CrashSimOptions = {}): CrashSim {
	return {
		options: opts,
		state: freshState(spec, opts),
		partPoses: new Map<number, PartPose>(),
		sensorCount: spec.numDeformationSensors,
		tagCount: spec.tagPoints.length,
		get events() { return this.state.events; },
		get rows() { return this.state.rows; },
		carMatrix() { return carMatrix(this.state); },
		sensorPositionsWorld() { return this.state.sensors.slice(0, spec.numDeformationSensors).map((p) => specToWorld(this.state, p)); },
		tagPositionsWorld() { return this.state.tags.map((p) => specToWorld(this.state, p)); },
	};
}

export function resetCrashSim(sim: CrashSim): void {
	const s = sim.state;
	Object.assign(s, freshState(s.spec, { ...sim.options, absorptionSet: s.absorptionSet }));
	sim.partPoses.clear();
}

export function setAbsorptionSet(sim: CrashSim, set: AbsorptionSet): void { sim.state.absorptionSet = set; }

// Starts a new run into an obstacle placed against the hit (see scenario.ts).
export function applyImpact(sim: CrashSim, impact: Impact): void {
	startRun(sim.state, impact);
	refreshPoses(sim);
}

// The contact side of the vehicle's frame.
export function contactHooks(s: SimState): StepHooks {
	return {
		generateContacts: (_v, _world, dt) => {
			generateContacts(s);
			validateWorldContacts(s, dt);
		},
		crashArmContacts: () => crashArmContacts(s),
		worldContacts: () => allArmContacts(s),
		updateContacts: (_v, dt) => {
			updateContacts(s, dt);
			updateSpinningDetachment(s, dt);
			if (!s.deformedThisStep) return;
			checkForDetachment(s);
			updateIK(s);
			updateSkinRows(s);
			updateWheelTags(s);
			updateGlass(s);
			updateDeformedBox(s);
		},
		penetration: () => solvePenetration(s),
	};
}

export function stepCrashSim(sim: CrashSim, dt = STEP): void {
	const s = sim.state;
	clearEvents(s.events, s.body.pos, s.body.v);
	if (s.run && !s.run.end) stepRun(s, s.run, contactHooks(s), dt);
	updateHinges(s, dt);
	updateFreeParts(s, dt);
	s.latch.fill(0);
	s.deformedThisStep = false;
	s.time += dt;
	refreshPoses(sim);
}

function refreshPoses(sim: CrashSim): void {
	const s = sim.state;
	const shift = meshShift(s.spec), car = carMatrix(s);
	sim.partPoses.clear();
	for (const [p, h] of s.hinges) {
		const part = s.spec.ikParts[p], js = part.jointSpecs[h.joint], J = hingePoint(s, p);
		if (!js || !J) continue;
		const delta = poseMatrix(jointRotation([js.axis[0], js.axis[1], js.axis[2]], h.rot), sub(J, shift));
		sim.partPoses.set(part.partGraphics, { state: 'hinged', world: mulAffine(car, delta) });
	}
	for (const [p, f] of s.free) {
		sim.partPoses.set(s.spec.ikParts[p].partGraphics, {
			state: 'detached', world: poseMatrix(f.rotation, f.origin, sub(f.pos, f.origin)),
		});
	}
}

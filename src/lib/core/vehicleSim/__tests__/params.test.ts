import { beforeAll, describe, expect, it } from 'vitest';
import type { ParsedDeformationSpec, Vec3 } from '../../deformationSpec';
import { createCrashSim } from '../../deformationSim/sim';
import { add, sub } from '../../deformationSim/state';
import { makeSpec } from '../../deformationSim/__tests__/fixture';
import { paramsFromClasses, type VehicleParams } from '../params';
import { hasFixture, loadCar, syntheticClasses, syntheticParams, syntheticSpec } from './carFixture';

const close = (a: readonly number[], b: readonly number[], d = 4) => b.forEach((x, i) => expect(a[i]).toBeCloseTo(x, d));

describe('vehicle params from synthetic attribs', () => {
	it('puts the centre of mass at the wheel mean, ignoring CoMOffset.x', () => {
		const p = syntheticParams();
		close(p.comSpec, [0, -0.31, 0]);
		// Rest hubs: spec position + suspension height offset - COM.
		close(p.wheels[0].streamed, [-0.765, -0.01, 1.237]);
		close(p.wheels[3].streamed, [0.875, 0, -1.237]);
		expect(p.wheels.map((w) => w.radius)).toEqual([0.325, 0.325, 0.325, 0.325]);
	});

	it('splits the static load evenly over a centred car and bounds the travel', () => {
		const p = syntheticParams();
		p.wheels.forEach((w) => expect(w.scaler).toBeCloseTo(0.25, 9));
		expect(p.wheels[0].yMin).toBeCloseTo(-0.11, 9);
		expect(p.wheels[0].yMax).toBeCloseTo(0.07, 9);
	});

	it('reads the streamed-under-another-name attribs the way the game does', () => {
		const p = syntheticParams();
		expect(p.base.downForceLiftCo).toBe(0.25);             // drift.WheelSlip
		expect(p.base.handbrakeYawDamping).toBe(0.004);        // base.RollDampingOnTakeOff
		expect(p.base.invTimeForFullBrake).toBeCloseTo(0.2, 9);
		expect(p.steering.reactionPerSec).toBeCloseTo(2.5, 9);
		close(p.base.crashExtraAngular, [0, 0.3, 0.3]);
		expect(p.carAngularImpulseScale).toBe(1);              // 0 in BodyBox.y means "unscaled"
	});

	it('lays the gears out reverse, 1..5 and builds the torque curve', () => {
		const p = syntheticParams();
		expect(p.engine.ratios).toEqual([-1.1, 2.65, 1.66, 1.13, 0.87, 0.73]);
		expect(p.engine.upRpm).toEqual([6000, 6200, 6200, 6200, 6200, 6200]);
		close(p.engine.torqueCurve, [195, 779.75, 0]);
	});

	it('floors the downward travel at 2.5 cm', () => {
		const c = syntheticClasses();
		c.physicsvehiclesuspensionattribs.DownwardMovement = 0.01;
		expect(paramsFromClasses(c, syntheticSpec()).wheels[0].yMin).toBeCloseTo(-0.01 - 0.025, 9);
	});

	it('names every missing attrib instead of simulating with zeros', () => {
		const c = syntheticClasses();
		delete c.physicsvehicleengineattribs.MaxRPM;
		delete c.physicsvehiclebaseattribs.LinearDrag;
		expect(() => paramsFromClasses(c, syntheticSpec())).toThrow(/engineattribs\.MaxRPM.*|baseattribs\.LinearDrag/);
	});

	it('boxes the rest sensor spheres before centring them on the centre of mass', () => {
		// The sensors sit at spec y = 0 with radius 0.5; the centre of mass is
		// 0.31 m below them, but the rest box is taken in the spec frame.
		const p = syntheticParams();
		close(p.aabb.min, [-1.1, -0.5, -2.3]);
		close(p.aabb.max, [1.1, 0.5, 2.3]);
	});

	it('reads the take-off attribs', () => {
		const p = syntheticParams();
		expect(p.base.pitchDampingOnTakeOff).toBe(0.95);
		expect(p.base.rollLimitOnTakeOff).toBe(1);
	});
});

describe('spec frames with an authored centre-of-mass offset', () => {
	const withOffset = (com: number[], stored?: number[]) => {
		const c = syntheticClasses();
		c.physicsvehiclebaseattribs.CoMOffset = com;
		const spec = syntheticSpec();
		// A sensor sitting exactly on the front-left hub.
		spec.sensors.push({ ...spec.sensors[0], initialOffset: [...spec.wheels[0].position.slice(0, 3)] as Vec3 });
		spec.numDeformationSensors = spec.sensors.length;
		if (stored) spec.currentCOMOffset = stored as never;
		return { p: paramsFromClasses(c, spec), spec };
	};
	const hubSensorBody = (p: VehicleParams, spec: ParsedDeformationSpec) =>
		sub(spec.sensors[spec.numDeformationSensors - 1].initialOffset, p.comSpec);

	it('moves the centre of mass by the authored y and z, sensors and wheels alike', () => {
		const { p, spec } = withOffset([7500, 0.1, -0.2, 0]);
		close(p.comSpec, [0, -0.21, -0.2]);
		// The hub's rest position is the spec wheel plus FrontHeight (-0.01).
		close(p.wheels[0].streamed, [-0.765, -0.11, 1.437]);
		close(hubSensorBody(p, spec), [-0.765, -0.1, 1.437]);
	});

	it('boxes the rest sensors where the authored offset alone put them', () => {
		// The corner sensors move by (0, 0.1, -0.2); the hub sensor reaches lowest.
		const { p } = withOffset([7500, 0.1, -0.2, 0]);
		close(p.aabb.min, [-1.265, -0.71, -2.5]);
		close(p.aabb.max, [1.1, 0.6, 2.1]);
	});

	it("keeps a spec's stored offset in its points but not in its wheels", () => {
		const { p, spec } = withOffset([7500, 0.1, -0.2, 0], [0, 0.05, 0.03, 0]);
		close(p.comSpec, [0, -0.16, -0.17]);
		close(p.wheels[0].streamed, [-0.765, -0.11, 1.437]);
		// A sensor authored 5 cm above and 3 cm ahead of the hub lands on it.
		close(sub(add(spec.wheels[0].position.slice(0, 3) as Vec3, [0, 0.05, 0.03]), p.comSpec), [-0.765, -0.1, 1.437]);
		close(hubSensorBody(p, spec), [-0.765, -0.15, 1.407]);
	});

	it('gives the crash sim the same centre of mass', () => {
		const handling = { physicsvehiclebaseattribs: { CoMOffset: [7500, 0.1, -0.2, 0] } };
		const spec = makeSpec();
		const sim = createCrashSim(spec, { handling });
		const P = sim.state.vehicle.params;
		const hubSpec = spec.wheels[0].position.slice(0, 3) as Vec3;
		close(sim.state.com, P.comSpec);
		// The sensor-side frame puts the spec hub where the wheel side does.
		close(sub(hubSpec, sim.state.com), sub(P.wheels[0].streamed, [0, P.susp.frontHeight, 0]));
	});
});

describe.skipIf(!hasFixture('PUSSC01') || !hasFixture('PUSMC01'))('vehicle params from the retail cars', () => {
	let coupe: VehicleParams, muscle: VehicleParams;
	beforeAll(() => {
		coupe = loadCar('PUSSC01').params;
		muscle = loadCar('PUSMC01').params;
	});

	it('finds the centre of mass at the wheel mean', () => {
		close(coupe.comSpec, [-0.00012, -0.31289, -0.22546]);
		close(muscle.comSpec, [0.00002, -0.40357, -0.0813]);
	});

	it('derives the box inertia from the handling dimensions', () => {
		close(muscle.invILocal, [3.0678e-4, 2.7257e-4, 1.3147e-3], 7);
		close(coupe.invILocal, [4.034e-4, 3.3675e-4, 1.3564e-3], 7);
	});

	it('sets up the wheels', () => {
		expect(coupe.wheels.map((w) => +w.radius.toFixed(4))).toEqual([0.325, 0.325, 0.325, 0.325]);
		expect(muscle.wheels.map((w) => +w.radius.toFixed(4))).toEqual([0.3313, 0.3313, 0.3425, 0.3425]);
		close(coupe.wheels[0].streamed as Vec3, [-0.7649, -0.0081, 1.2367]);
		close(coupe.wheels[2].streamed as Vec3, [-0.8749, -0.002, -1.2366]);
		close(muscle.wheels[0].streamed as Vec3, [-0.829, 0.0275, 1.4237]);
		close(muscle.wheels[2].streamed as Vec3, [-0.869, -0.0145, -1.4237]);
		[coupe, muscle].forEach((p) => p.wheels.forEach((w) => expect(w.scaler).toBeCloseTo(0.25, 2)));
	});

	it('reads the handling attribs', () => {
		expect([coupe.mass, muscle.mass]).toEqual([1620, 1589]);
		expect([coupe.base.maxSpeedMph, muscle.base.maxSpeedMph]).toEqual([153, 105]);
		expect(muscle.base.downForceLiftCo).toBeCloseTo(0.65, 6);
		close(muscle.base.brakeCurve, [3, 4, 5]);
		close(muscle.engine.ratios, [-0.8, 2.5, 1.7, 1.2, 0.9, 0.72]);
		expect(muscle.front.longForceBias).toBeCloseTo(0.15, 6);
		expect(muscle.susp.restDisp).toBeCloseTo(0.175, 6);
	});
});

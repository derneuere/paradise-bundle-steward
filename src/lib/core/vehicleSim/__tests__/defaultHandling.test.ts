// A car drives on its own vault's handling, with the retail coupe's filling
// whatever the vault lacks.

import { describe, expect, it } from 'vitest';
import type { ParsedAttribSys } from '../../attribSys';
import { defaultHandling, mergeHandling, vehicleParamsFor } from '../defaultHandling';
import { hasFixture, loadCar, syntheticSpec } from './carFixture';

// TODO(types): the params read only `attributes[].className/fields`.
const vault = (cls: string, fields: Record<string, unknown>) => ({ attributes: [{ className: cls, fields }] }) as unknown as ParsedAttribSys;

describe('handling layers', () => {
	it('lets later layers win field by field, skipping undefined fields', () => {
		const m = mergeHandling({ a: { x: 1, y: 2 } }, { a: { y: 3, z: undefined }, b: { w: 4 } });
		expect(m).toEqual({ a: { x: 1, y: 3 }, b: { w: 4 } });
	});

	it('runs a car with no vault on the coupe defaults', () => {
		const p = vehicleParamsFor(syntheticSpec());
		expect(p.mass).toBe(1620);
		expect(p.base.maxSpeedMph).toBe(153);
		expect(p.base.driveTimeLimits).toEqual([0.05, 0.2, 0.2, 0.25]);
	});

	it("takes the vault's own values over the defaults, and the overrides over both", () => {
		const v = vault('physicsvehiclebaseattribs', { DrivingMass: 1400, MaxSpeed: 120 });
		const p = vehicleParamsFor(syntheticSpec(), v, { physicsvehiclebaseattribs: { MaxSpeed: 99 } });
		expect(p.mass).toBe(1400);
		expect(p.base.maxSpeedMph).toBe(99);
		expect(p.base.linearDrag).toBe(defaultHandling().physicsvehiclebaseattribs.LinearDrag);
	});

	it('keeps the default mass for a car whose own is unusable', () => {
		expect(vehicleParamsFor(syntheticSpec(), vault('physicsvehiclebaseattribs', { DrivingMass: 0 })).mass).toBe(1620);
	});

	it.skipIf(!hasFixture('PUSMC01'))('reads a retail car whole from its vault', () => {
		const { spec, vault: real, params } = loadCar('PUSMC01');
		const p = vehicleParamsFor(spec, real);
		expect(p).toEqual(params);
		expect(p.base.driveTimeLimits.map((x) => +x.toFixed(3))).toEqual([0.05, 0.2, 0.15, 0.4]);
	});
});

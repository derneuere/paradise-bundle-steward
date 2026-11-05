// Which absorption table the sensors read. The game picks it afresh every
// step, just before the step's contacts are applied, from who drives the car
// and how it is crashing:
//
// - a car that is not crashing always uses the normal table (knocks, scrapes);
// - the player's crashing car uses the extreme-crash table when the crash
//   began within 5 mph of the car's top speed (its MaxSpeed attrib), and the
//   normal table otherwise;
// - a rival's crashing car uses the AI-crash table in an event, and the
//   shut-down table outside one (free roam).
//
// The game also holds the player's car on the invincible table for a short
// cool-down after it is reset; the preview has no such cool-down.

import type { VehicleState } from '../vehicleSim/vehicleState';
import type { SimState } from './state';
import { AbsorptionSet } from './tables';

export type Driver = 'player' | 'rival' | 'rivalFreeRoam';

export const EXTREME_CRASH_SPEED_MARGIN_MPH = 5;

export function absorptionSetFor(driver: Driver, v: VehicleState): AbsorptionSet {
	if (!v.crashing) return AbsorptionSet.Normal;
	if (driver === 'rival') return AbsorptionSet.AiCrashing;
	if (driver === 'rivalFreeRoam') return AbsorptionSet.Shutdown;
	return v.speedOnLastCrashMph > v.params.base.maxSpeedMph - EXTREME_CRASH_SPEED_MARGIN_MPH
		? AbsorptionSet.PlayerExtremeCrash
		: AbsorptionSet.Normal;
}

export function updateAbsorptionSet(s: SimState): void {
	s.absorptionSet = absorptionSetFor(s.driver, s.vehicle);
}

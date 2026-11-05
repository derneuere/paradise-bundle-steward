// The key light (sun) direction the game derives from the time of day.
//
// The engine maps seconds-of-day to a sun angle in radians with zero at 06:30
// (one full turn per 24 h), then swings that arc through a fixed "sun rig":
// tilted 20° out of the vertical plane at the horizon, 50° at midday, and the
// whole rig rotated 45° about the up axis. Before lighting, the time of day is
// clamped into 09:00–16:00 so the published sun never lights the world from a
// grazing angle (the sky dome uses the same clamped direction). The result is
// the direction the light TRAVELS (pointing down at midday): shaders light a
// surface with saturate(dot(N, -KeyLightDirection)).
//
// At the game's default 13:00 this gives (-0.4246, -0.6698, -0.6092).

import type { Vec3 } from '../environmentSettings';

/** Default time of day the game starts the environment clock at (13:00). */
export const DEFAULT_TIME_OF_DAY = 46800;

const SUN_ANGLE_ZERO_SECONDS = 23400; // 06:30
const RADIANS_PER_SECOND = (2 * Math.PI) / 86400;
const SUN_RIG_ROTATION_DEG = 45;
const SUN_TILT_AT_HORIZON_DEG = 20;
const SUN_TILT_AT_MIDDAY_DEG = 50;
const SUN_ELEVATION_TOD_MIN = 32400; // 09:00
const SUN_ELEVATION_TOD_MAX = 57600; // 16:00
const DEG = Math.PI / 180;

/** Sun direction for a raw sun angle (radians, 0 = sunrise horizon, π/2 = midday). */
export function sunRigDirection(sunAngle: number): Vec3 {
	const middayFraction = 1 - Math.abs((sunAngle - Math.PI / 2) * (2 / Math.PI));
	const tilt = SUN_TILT_AT_HORIZON_DEG * DEG + middayFraction * (SUN_TILT_AT_MIDDAY_DEG - SUN_TILT_AT_HORIZON_DEG) * DEG;
	const rig = SUN_RIG_ROTATION_DEG * DEG;
	const x = -Math.cos(sunAngle);
	const y = -Math.sin(sunAngle);
	// Row vector times RotationX(tilt), then times RotationY(rig).
	const ty = y * Math.cos(tilt);
	const tz = y * Math.sin(tilt);
	return {
		x: x * Math.cos(rig) + tz * Math.sin(rig),
		y: ty,
		z: tz * Math.cos(rig) - x * Math.sin(rig),
	};
}

/** The key light direction the engine publishes at `timeOfDay` seconds. */
export function keyLightDirection(timeOfDay: number = DEFAULT_TIME_OF_DAY): Vec3 {
	const clamped = Math.min(Math.max(timeOfDay, SUN_ELEVATION_TOD_MIN), SUN_ELEVATION_TOD_MAX);
	return sunRigDirection((clamped - SUN_ANGLE_ZERO_SECONDS) * RADIANS_PER_SECOND);
}

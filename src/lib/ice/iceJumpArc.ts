// Ballistic jump-arc model for the ICE take preview.
//
// To judge a big-jump camera you have to see the car flying its arc with the
// track falling away beneath it. ICE jump cameras are CAR-RELATIVE (their eye /
// look are expressed in the car's frame), so the preview needs a plausible car
// trajectory to mount the camera on. This module produces that trajectory: a
// simple projectile launched from a point on the track, plus the per-instant
// car frame (forward / up / right) the camera rig hangs off.
//
// Coordinate space: the whole preview scene is Y-up, right-handed, raw world
// units (the same space the track-unit geometry decodes into) — no scaling, no
// axis swap. Speeds are world-units per second, gravity is world-units per
// second squared, angles are radians. The model is deliberately a clean
// projectile (no drag, no suspension) — it is a framing aid for the camera, not
// a physics reproduction of the game's vehicle.

export type JumpArcParams = {
	/** World-space launch point (where the car leaves the ramp). */
	launch: [number, number, number];
	/** Heading on the XZ plane, radians. 0 points along +X; +Z at +90°. */
	headingRad: number;
	/** Launch speed along the heading+pitch direction, world units / second. */
	speed: number;
	/** Launch pitch above the XZ plane, radians (positive tilts the car up). */
	launchPitchRad: number;
	/** Downward acceleration magnitude, world units / second². */
	gravity: number;
	/** Total arc duration the preview plays over, seconds. */
	durationS: number;
};

/**
 * One instant of the car's flight: world position plus an orthonormal frame.
 * `forward` is the unit velocity direction, `up` is world-up re-orthogonalized
 * against forward (so the car visibly pitches with its trajectory — nose up on
 * the way up, nose down on the descent).
 */
export type CarState = {
	position: [number, number, number];
	forward: [number, number, number];
	up: [number, number, number];
};

const WORLD_UP: [number, number, number] = [0, 1, 0];

/**
 * Big-jump defaults, tuned so the arc reads as a substantial leap in raw world
 * units: ~22° launch, ~60 u/s, ~30 u/s² gravity over 2.5s gives an apex a few
 * tens of units up and a span of well over a hundred units — the track reads as
 * falling away beneath the car. Launch sits a little above the origin so the
 * descent doesn't immediately punch through a ground plane.
 */
export const DEFAULT_JUMP_ARC: JumpArcParams = {
	launch: [0, 2, 0],
	headingRad: 0,
	speed: 60,
	launchPitchRad: (22 * Math.PI) / 180,
	gravity: 30,
	durationS: 2.5,
};

// --- small vector helpers (local, to keep the module self-contained) ----------

function add(a: [number, number, number], b: [number, number, number]): [number, number, number] {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: [number, number, number], s: number): [number, number, number] {
	return [a[0] * s, a[1] * s, a[2] * s];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
}

function length(a: [number, number, number]): number {
	return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: [number, number, number]): [number, number, number] {
	const len = length(a);
	if (len === 0) return [0, 0, 0];
	return [a[0] / len, a[1] / len, a[2] / len];
}

// --- arc kinematics ------------------------------------------------------------

/** Heading direction on the XZ plane (unit, Y = 0) from a heading angle. */
function headingDir(headingRad: number): [number, number, number] {
	return [Math.cos(headingRad), 0, Math.sin(headingRad)];
}

/** Initial velocity vector: speed along (cos pitch * heading + sin pitch * up). */
function initialVelocity(params: JumpArcParams): [number, number, number] {
	const dir = headingDir(params.headingRad);
	const cp = Math.cos(params.launchPitchRad);
	const sp = Math.sin(params.launchPitchRad);
	return scale(
		[dir[0] * cp + WORLD_UP[0] * sp, dir[1] * cp + WORLD_UP[1] * sp, dir[2] * cp + WORLD_UP[2] * sp],
		params.speed,
	);
}

/** Velocity at time `tS`: v0 + g*t (gravity pulls down −Y). */
function velocityAt(params: JumpArcParams, tS: number): [number, number, number] {
	const v0 = initialVelocity(params);
	return [v0[0], v0[1] - params.gravity * tS, v0[2]];
}

/**
 * Car state at time `tS` (seconds from launch). Position is the closed-form
 * projectile `launch + v0*t + 0.5*g*t²`; the frame is built from the velocity
 * direction. `up` is world-up re-orthogonalized against forward so the basis
 * stays orthonormal while the car pitches with the arc; at the apex (forward
 * level) this is just world-up, and forward never goes fully vertical for sane
 * params, so the re-orthogonalization is always well-conditioned.
 */
export function carStateAt(params: JumpArcParams, tS: number): CarState {
	const v0 = initialVelocity(params);
	const position = add(
		add(params.launch, scale(v0, tS)),
		[0, -0.5 * params.gravity * tS * tS, 0],
	);

	const vel = velocityAt(params, tS);
	let forward = normalize(vel);
	// Degenerate guard: if velocity is zero (speed 0), fall back to heading so the
	// frame is still defined.
	if (length(forward) === 0) forward = headingDir(params.headingRad);

	// Gram-Schmidt world-up against forward. If forward is (anti)parallel to world
	// up, pick the heading plane's normal instead so `up` stays finite.
	const upDotF = dot(WORLD_UP, forward);
	let up = normalize([
		WORLD_UP[0] - forward[0] * upDotF,
		WORLD_UP[1] - forward[1] * upDotF,
		WORLD_UP[2] - forward[2] * upDotF,
	]);
	if (length(up) === 0) {
		const side = normalize(cross(forward, headingDir(params.headingRad + Math.PI / 2)));
		up = normalize(cross(side, forward));
	}

	return { position, forward, up };
}

// --- matrix helpers ------------------------------------------------------------

/**
 * Build a column-major length-16 Matrix4 (THREE.Matrix4.fromArray order) that
 * places and orients the car. The car frame is right-handed with local +X = right,
 * +Y = up, +Z = forward (direction of travel). ICE chase takes author the camera in
 * this frame — the eye sits at negative Z (behind the car) looking toward positive Z
 * (ahead) — so a car-relative eye must map +Z → world forward for the camera to land
 * behind the car. `right = up × forward` keeps right × up = forward (proper rotation,
 * det +1, no mirroring). `transformPointByMatrix` relies on this mapping.
 */
export function carWorldMatrix(state: CarState): number[] {
	const f = normalize(state.forward);
	const u0 = normalize(state.up);
	const right = normalize(cross(u0, f));
	// Re-derive up from forward×right so the basis is exactly orthonormal even if
	// the inputs drifted slightly.
	const up = cross(f, right);
	const p = state.position;
	// Column-major: each group of 4 is a column (basis vector then 0; last column
	// is translation then 1). Z column is +forward so car-space +Z = forward.
	return [
		right[0], right[1], right[2], 0,
		up[0], up[1], up[2], 0,
		f[0], f[1], f[2], 0,
		p[0], p[1], p[2], 1,
	];
}

/**
 * Apply a column-major 4x4 (length-16) matrix to a point (w = 1) and return the
 * transformed point. Mirrors THREE.Vector3.applyMatrix4 with perspective divide
 * (affine matrices keep w = 1, so the divide is a no-op for our car frame).
 */
export function transformPointByMatrix(m: number[], p: [number, number, number]): [number, number, number] {
	const [x, y, z] = p;
	const xr = m[0] * x + m[4] * y + m[8] * z + m[12];
	const yr = m[1] * x + m[5] * y + m[9] * z + m[13];
	const zr = m[2] * x + m[6] * y + m[10] * z + m[14];
	const w = m[3] * x + m[7] * y + m[11] * z + m[15];
	if (w !== 0 && w !== 1) return [xr / w, yr / w, zr / w];
	return [xr, yr, zr];
}

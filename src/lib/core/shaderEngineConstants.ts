// Engine-supplied shader constants + cb0 layout inference.
//
// Burnout's shaders read two kinds of cb0 slot: material defaults baked into
// the Shader resource (handled by seedDefaults from the parsed constants), and
// per-frame ENGINE constants the runtime supplies at draw time (camera /
// view-projection matrices, key light, fog, sky, irradiance, shadow). A
// preview/translator has to synthesise that engine state or the slots read zero
// and the shader collapses to black or fails to transform.
//
// The engine constant set + semantics are documented in
// docs/ShaderConstants_findings.md §4 (the per-frame `BrnShaderConstantsFrame`
// register). This module is the single source of truth for both the static
// defaults and the cb0 slot map; ShaderPage, the RenderableViewport and the
// differential harness all import it (previously each kept its own drifting
// copy).

import type { ParsedDxbc } from './dxbc';

// ---------------------------------------------------------------------------
// Live debug knobs for the over-bright preview.
//
// The translated vehicle shaders fold engine-RUNTIME constants (key light,
// ambient irradiance, fog/white-level) into the output colour, and those values
// aren't in the bundle — we stand in heuristic defaults. When the result blows
// out to white it's hard to know which term dominates, so the viewport exposes
// sliders that SCALE each group plus a final exposure. This object is module-
// global and mutated in place by the sliders; a translated material's
// __updateCb0 reads it every frame (R3F renders continuously), so the knobs are
// live with no material rebuild. `exposure` multiplies gl_FragColor before the
// preview tonemap; the others scale their cb0 constant group off its seeded base.
// ---------------------------------------------------------------------------
export type EngineKnobs = { exposure: number; keyLight: number; ambient: number; fog: number };
export const DEFAULT_ENGINE_KNOBS: EngineKnobs = { exposure: 1, keyLight: 1, ambient: 1, fog: 1 };
export const engineKnobs: EngineKnobs = { ...DEFAULT_ENGINE_KNOBS };

/** Which knob group (if any) scales a given engine constant by name. */
export function knobGroupForConstant(name: string): Exclude<keyof EngineKnobs, 'exposure'> | null {
	if (/^KeyLight/.test(name)) return 'keyLight';
	if (/^Irradiance/.test(name)) return 'ambient';
	if (/^FogColour/.test(name)) return 'fog';
	return null;
}

/** cb0 slot map for a shader. Slots are vec4 indices (byte offset / 16).
 *  The `Row0` matrix slots are the first of a 4-consecutive-row matrix; null
 *  means the shader doesn't declare that matrix. */
export type CbLayout = {
	/** First row of the per-object world matrix (4 rows). */
	worldRow0: number;
	/** First row of the `ViewProjectionModified` block: Burnout packs clip.xy in
	 *  rows 0/1, view-space z in `viewRow2`, depth-encode coeffs in `depthEncode`. */
	vpRow0: number;
	/** View-matrix row 2 (view-space z), part of the ViewProjectionModified block. */
	viewRow2: number;
	/** Depth-encode coefficient slot (A, B, -1, 0) for the OpenGL depth range. */
	depthEncode: number;
	/** Camera world position slot, or null when the shader doesn't use it. */
	cameraPos: number | null;
	/** First row of the combined world*view*projection matrix (4 rows), or null.
	 *  Many shaders transform with this directly instead of ViewProjectionModified. */
	worldViewProjRow0: number | null;
	/** First row of the view*projection matrix (4 rows), or null. */
	viewProjectionRow0: number | null;
};

/**
 * Static defaults for engine-supplied (runtime-bound) cb0 constants, keyed by
 * the RDEF variable name. These are values the game would fill from its
 * per-frame constant register; for a static preview we supply representative
 * stand-ins so a shader that multiplies by, say, `KeyLightColour` or adds
 * `FogColourPlusWhiteLevel` doesn't read zero and collapse to black.
 *
 * Semantics per docs/ShaderConstants_findings.md §4. Matrices (world /
 * view-projection / worldViewProj / shadow) are NOT here — they are bound
 * per-frame from the real camera in `bindEngineMatrices`.
 */
export const ENGINE_CONSTANT_DEFAULTS: Record<string, [number, number, number, number]> = {
	// --- Lighting (key/directional light) ---
	KeyLightColour: [1, 1, 1, 1],
	KeyLightClampedColour: [1, 1, 1, 1],
	KeyLightSpecularColour: [1, 1, 1, 1],
	KeyLightDirection: [0.4, -0.7, 0.6, 0],
	// --- Ambient irradiance (quadric coefficients). Exact encoding unconfirmed;
	//     a small flat grey keeps surfaces from going pure-black in ambient-only
	//     regions without overwhelming the key light. Approximate, not spec-exact. ---
	IrradianceQuadricA: [0.18, 0.19, 0.22, 1],
	IrradianceQuadricB: [0, 0, 0, 0],
	// --- Sky / fog / atmosphere ---
	FogColourPlusWhiteLevel: [0.55, 0.70, 0.85, 1],
	SkyReflectionColour: [0.55, 0.75, 0.95, 1],
	ScattCoeffs: [0.4, 0.4, 0.5, 1],
	g_PerVehicleFog: [0, 0, 0, 1],
	// --- HDR / tonemap (neutral exposure) ---
	HDRConstants: [1, 1, 1, 1],
	// --- Shadow map (neutral; preview binds a white shadow texture so the
	//     compare returns "lit", making the cascade-select moot) ---
	ShadowMap_Constants: [1, 1, 1, 1],
	ShadowMap_Constants2: [1, 1, 1, 1],
	ShadowMap_Constants3: [1, 1, 1, 1],
	ShadowMap_ObjectCsmSelect: [1, 0, 0, 0],
	// --- Texture / UV animation (identity: no animation in a static preview) ---
	AnimDuration: [1, 1, 1, 1],
	AnimNumberOfFramesU: [1, 1, 1, 1],
	AnimNumberOfFramesV: [1, 1, 1, 1],
	g_vehicleUvAnimOffset: [0, 0, 0, 0],
	// --- Misc material/runtime masks (neutral) ---
	g_selfIlluminationMask: [0, 0, 0, 0],
	g_policeLightsSelfIlluminationMask: [0, 0, 0, 0],
	g_wheelConstants: [0, 0, 0, 1],
	g_damageConstants: [0, 0, 0, 1],
	sampleCoverage: [1, 1, 1, 1],
	// --- Vehicle paint (so PaintGloss `r0 *= g_paintColour` doesn't go black) ---
	g_paintColour: [0.6, 0.1, 0.1, 1],
	g_pearlescentColour: [0.2, 0.2, 0.3, 1],
};

/**
 * Recover the cb0 slot map from a translated VS, preferring RDEF variable names
 * (authoritative per shader) and falling back to regex pattern-matching on the
 * emitted GLSL for the few cases without parsed reflection.
 */
export function inferCbLayout(vs: string, parsed?: ParsedDxbc): CbLayout {
	const slotByName = (name: string): number | null => {
		if (!parsed) return null;
		for (const cb of parsed.reflection.constantBuffers) {
			for (const v of cb.variables) {
				if (v.name === name) return Math.floor(v.startOffset / 16);
			}
		}
		return null;
	};

	// worldRow0: `pos.xxxx * cb0[N]` — N is the world row-0 slot. fxc emits rows
	// in {y,x,z,w} accumulation order; the .xxxx row is always row 0.
	const worldMatch = vs.match(/position, 0\.0\)\.xxxx \* cb0\[(\d+)\]/);
	const worldRow0 = slotByName('world') ?? (worldMatch ? Number(worldMatch[1]) : 44);

	// viewRow2: first dp4 after the world transform feeding the o0.zw depth pair.
	const viewMatch = vs.match(/r1\.x = vec4\(vec4\(dot\(r0\.xyzw, cb0\[(\d+)\]\.xyzw\)\)\)/);
	const viewRow2 = viewMatch ? Number(viewMatch[1]) : 7;

	// vpRow0: the ViewProjectionModified slot, or the first o0.x dp4.
	const vpMatch = vs.match(/o0\.x = vec4\(vec4\(dot\(r0\.xyzw, cb0\[(\d+)\]\.xyzw\)\)\)/);
	const vpRow0 = slotByName('ViewProjectionModified') ?? (vpMatch ? Number(vpMatch[1]) : 5);

	const camMatch = vs.match(/-\(r0\.xyzx\) \+ cb0\[(\d+)\]\.xyzx/);
	const cameraPos = slotByName('ViewPosition') ?? (camMatch ? Number(camMatch[1]) : null);

	return {
		worldRow0,
		vpRow0,
		viewRow2,
		depthEncode: 8,
		cameraPos,
		// Full 4-row engine matrices many shaders transform with directly.
		worldViewProjRow0: slotByName('worldViewProj'),
		viewProjectionRow0: slotByName('viewProjection'),
	};
}

// =============================================================================
// Skinning / vehicle-deformation palette
// =============================================================================
//
// Skinned vehicle meshes (those whose VertexDescriptor carries
// BoneIndexes/BoneWeights) transform each vertex by a bone-matrix palette
// (`boneMatrices`, a cb0 array of 4-row matrices) blended by the per-vertex
// weights, then add per-vertex deformation offsets (`g_verletOffsets`). Both
// are supplied by the runtime: the bone matrices are IDENTITY at rest (this is
// relative/deformation skinning — vertices are stored in rest position and the
// matrices only diverge from identity when the car is crashed) and the verlet
// offsets are zero at rest. Left unseeded they read zero, so a skinned vertex
// collapses to the origin (boneMatrix·pos·weight = 0·pos·0) and the mesh
// vanishes. Seeding the palette to identity — together with the BLENDWEIGHT=1
// stub the GLSL emitter now uses — makes skinned meshes render at rest pose.

/** cb0 array constants that are palettes of 4-row matrices whose rest value is
 *  the identity matrix. */
export const SKIN_IDENTITY_MATRIX_PALETTES = new Set(['boneMatrices']);

/**
 * Identity-fill any matrix-palette constants (e.g. `boneMatrices`) the shader
 * declares, via the supplied per-slot writer. `g_verletOffsets` rests at zero,
 * which the zero-initialised cb0 already satisfies, so it needs no seeding.
 */
export function seedSkinningPalettes(
	parsed: ParsedDxbc | undefined,
	writeVec4: (slot: number, x: number, y: number, z: number, w: number) => void,
): void {
	if (!parsed) return;
	for (const cb of parsed.reflection.constantBuffers) {
		for (const v of cb.variables) {
			if (!SKIN_IDENTITY_MATRIX_PALETTES.has(v.name)) continue;
			const slot = Math.floor(v.startOffset / 16);
			const nVec4 = Math.max(4, Math.floor(v.size / 16));
			for (let m = 0; m + 4 <= nVec4; m += 4) {
				writeVec4(slot + m + 0, 1, 0, 0, 0);
				writeVec4(slot + m + 1, 0, 1, 0, 0);
				writeVec4(slot + m + 2, 0, 0, 1, 0);
				writeVec4(slot + m + 3, 0, 0, 0, 1);
			}
		}
	}
}

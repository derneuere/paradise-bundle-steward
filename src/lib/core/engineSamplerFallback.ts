// Neutral stand-ins for engine-global shader samplers.
//
// A translated Burnout shader declares two kinds of sampler: per-material ones
// (Diffuse / Normal / Emissive…) that the Material resource binds explicitly,
// and ENGINE-GLOBAL ones (the reflection probe, the cascade shadow map, the
// glass-fracture overlay) that the runtime binds at draw time and the Material
// never mentions. When steward renders a translated shader on its own, those
// global samplers have nothing to bind to — so we supply a neutral texture that
// makes each global term contribute "nothing surprising".
//
// Why this matters (and why a bad stand-in is so visible): the vehicle shaders
// fold the sampled value straight into the output colour. The window/metal
// pixel shaders do, in effect, `colour += reflection.rgb * k` — so binding a
// magenta marker to the reflection sampler smears magenta across the entire
// car. The values below were chosen against what each sampler actually feeds:
//
//   reflection / envmap / cube → soft sky gradient (a believable environment;
//                                neutral-ish so the reflective term reads as sky)
//   shadow / depth             → white  (shadow term = fully lit, unshadowed)
//   fracture / crack           → black  (no crack/detail overlay contribution)
//   normal / bump              → flat tangent normal (no surface perturbation)
//   wavenormal                 → procedural ripple normal (water-preview shader)
//   riverfloor / diffuse       → muddy tile (water-preview shader)
//   <anything else>            → magenta, kept LOUD on purpose: an unmatched
//                                sampler with no stand-in should be obvious.
//
// Textures are generated once and memoised; callers may bind the same instance
// to many materials (they are read-only).

import * as THREE from 'three';

let _sky: THREE.DataTexture | null = null;
let _white: THREE.DataTexture | null = null;
let _black: THREE.DataTexture | null = null;
let _flatNormal: THREE.DataTexture | null = null;
let _waveNormal: THREE.DataTexture | null = null;
let _riverFloor: THREE.DataTexture | null = null;
let _magenta: THREE.DataTexture | null = null;

function makeRepeatTex(data: Uint8Array, w: number, h: number): THREE.DataTexture {
	const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.minFilter = THREE.LinearFilter;
	t.magFilter = THREE.LinearFilter;
	t.needsUpdate = true;
	return t;
}

function getSkyTex(): THREE.DataTexture {
	if (_sky) return _sky;
	const W = 8, H = 64;
	const data = new Uint8Array(W * H * 4);
	for (let y = 0; y < H; y++) {
		const t = y / (H - 1);
		// Warm horizon → blue zenith. Stands in for an environment probe so the
		// reflective term reads as sky, never the magenta "missing" marker.
		// (Vehicle shaders gate this by their baked reflect/fresnel constants, so
		// its exact brightness is minor there; the sphere preview's water shader
		// is what benefits from a believable sky.)
		const r = Math.round(180 + (90 - 180) * t);
		const g = Math.round(200 + (140 - 200) * t);
		const b = 220;
		for (let x = 0; x < W; x++) {
			const i = (y * W + x) * 4;
			data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
		}
	}
	return (_sky = makeRepeatTex(data, W, H));
}

function getWhiteTex(): THREE.DataTexture {
	if (_white) return _white;
	return (_white = makeRepeatTex(new Uint8Array([255, 255, 255, 255]), 1, 1));
}

function getBlackTex(): THREE.DataTexture {
	if (_black) return _black;
	return (_black = makeRepeatTex(new Uint8Array([0, 0, 0, 255]), 1, 1));
}

function getFlatNormalTex(): THREE.DataTexture {
	if (_flatNormal) return _flatNormal;
	// (0,0,1) tangent-space normal encodes to (128,128,255).
	return (_flatNormal = makeRepeatTex(new Uint8Array([128, 128, 255, 255]), 1, 1));
}

function getWaveNormalTex(): THREE.DataTexture {
	if (_waveNormal) return _waveNormal;
	const N = 128;
	const data = new Uint8Array(N * N * 4);
	for (let y = 0; y < N; y++) {
		for (let x = 0; x < N; x++) {
			const u = x / N, v = y / N;
			const dx = 0.30 * Math.cos(2 * Math.PI * 2 * u) + 0.15 * Math.sin(2 * Math.PI * 4 * v + 1.7);
			const dy = 0.30 * Math.sin(2 * Math.PI * 2 * v) + 0.15 * Math.cos(2 * Math.PI * 4 * u - 0.9);
			const z = Math.sqrt(Math.max(0.0, 1.0 - dx * dx - dy * dy));
			const i = (y * N + x) * 4;
			data[i] = Math.round((dx * 0.5 + 0.5) * 255);
			data[i + 1] = Math.round((dy * 0.5 + 0.5) * 255);
			data[i + 2] = Math.round((z * 0.5 + 0.5) * 255);
			data[i + 3] = 255;
		}
	}
	return (_waveNormal = makeRepeatTex(data, N, N));
}

function getRiverFloorTex(): THREE.DataTexture {
	if (_riverFloor) return _riverFloor;
	const N = 32;
	const data = new Uint8Array(N * N * 4);
	for (let y = 0; y < N; y++) {
		for (let x = 0; x < N; x++) {
			const n = 0.5 + 0.5 * Math.sin(x * 0.7) * Math.cos(y * 0.9);
			const i = (y * N + x) * 4;
			data[i] = Math.round(40 + n * 30);
			data[i + 1] = Math.round(70 + n * 40);
			data[i + 2] = Math.round(60 + n * 30);
			data[i + 3] = 255;
		}
	}
	return (_riverFloor = makeRepeatTex(data, N, N));
}

function getMagentaTex(): THREE.DataTexture {
	if (_magenta) return _magenta;
	return (_magenta = makeRepeatTex(new Uint8Array([255, 64, 200, 255]), 1, 1));
}

export type FallbackKind =
	| 'shadow' | 'fracture' | 'wavenormal' | 'normal'
	| 'reflection' | 'floor' | 'diffuse' | 'magenta';

/** Classify a sampler name into the engine-global stand-in it should receive.
 *  Order matters: more-specific roles are tested before generic ones (e.g.
 *  "wavenormal" before "normal", "fracture" before everything). */
export function classifyEngineSampler(samplerName: string): FallbackKind {
	const n = samplerName.toLowerCase();
	if (n.includes('shadow') || n.includes('depth')) return 'shadow';
	if (n.includes('fracture') || n.includes('crack')) return 'fracture';
	if (n.includes('wavenormal')) return 'wavenormal';
	if (n.includes('reflect') || n.includes('envmap') || n.includes('cubemap') || n.includes('cube_map')) return 'reflection';
	if (n.includes('normalmap') || n.includes('normaltexture') || n.includes('normal') || n.includes('bump')) return 'normal';
	if (n.includes('riverfloor')) return 'floor';
	if (n.includes('diffuse') || n.includes('albedo')) return 'diffuse';
	return 'magenta';
}

/** Human-readable description of what each fallback is, for the inspector. */
export const FALLBACK_LABELS: Record<FallbackKind, string> = {
	shadow:      'white 1×1 (no shadow — fully lit)',
	fracture:    'black 1×1 (no crack/detail overlay)',
	wavenormal:  'procedural ripple normals 128² (water preview)',
	normal:      'flat tangent normal 1×1 (no perturbation)',
	reflection:  'sky gradient 8×64 (neutral environment probe)',
	floor:       'muddy blue-green tile 32² (water preview)',
	diffuse:     'muddy blue-green tile 32² (water preview)',
	magenta:     'magenta 1×1 (no stand-in for this sampler — likely an unbound texture)',
};

/** Pick the neutral stand-in DataTexture for an engine-global sampler that the
 *  Material didn't bind. Memoised — safe to share one instance across many
 *  materials. */
export function pickEngineSamplerFallback(samplerName: string): THREE.DataTexture {
	switch (classifyEngineSampler(samplerName)) {
		case 'shadow': return getWhiteTex();
		case 'fracture': return getBlackTex();
		case 'wavenormal': return getWaveNormalTex();
		case 'normal': return getFlatNormalTex();
		case 'reflection': return getSkyTex();
		case 'floor': case 'diffuse': return getRiverFloorTex();
		case 'magenta': return getMagentaTex();
	}
}

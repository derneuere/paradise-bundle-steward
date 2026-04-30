// Shader resource viewer (type 0x32).
//
// End-to-end pipeline:
//
//   Shader (0x32) resource
//     └─ technique[t]
//           ├─ vertex ShaderProgramBuffer (0x12 import)
//           │     └─ block 1 = DXBC SM5 container (RDEF/ISGN/OSGN/SHEX/STAT)
//           │           └─ translateDxbc() → GLSL ES vertex source
//           └─ pixel ShaderProgramBuffer (0x12 import)
//                 └─ DXBC → GLSL ES fragment source
//
// We pair a technique's imports in {vertex, pixel} order and pass the two
// GLSL strings into three.js ShaderMaterial. three.js then compiles them
// as regular WebGL shaders; compilation errors bubble up to the page so
// the user can see exactly which op or uniform binding broke.
//
// Inputs driving the preview mesh:
//   - a_POSITION0 / a_NORMAL0 / a_TEXCOORD0 etc. are bound from the
//     geometry in TriangleRig below.
//   - cb0[...] uniforms are left at the default (vec4(0)); without a real
//     MaterialAssembly feeding these, the preview is a flat-lit read of
//     whatever the shader does with uninitialised constants. Good enough
//     for "does it compile and run" visual sanity checks.

import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFirstLoadedBundle, useFirstLoadedBundleId, useWorkspace, useWorkspaceCompanion } from '@/context/WorkspaceContext';
import type { ParsedShader } from '@/lib/core/shader';
import { SHADER_TYPE_ID, SHADER_PROGRAM_BUFFER_TYPE_ID } from '@/lib/core/shader';
import { getImportIds } from '@/lib/core/bundle';
import { getResourceBlocks } from '@/lib/core/resourceManager';
import { translateDxbc, type TranslatedShader, type ParsedDxbc } from '@/lib/core/dxbc';
import { u64ToBigInt } from '@/lib/core/u64';
import { buildTextureCatalog, pickTextureForSampler, type TextureCatalogEntry } from '@/lib/core/textureCatalog';
import { buildMaterialIndex, pickBestMaterial, type MaterialBinding } from '@/lib/core/materialBinding';
import { buildTranslatedShaderMaterial, type TranslatedMaterial } from '@/lib/core/translatedShaderMaterial';
import type { DecodedTexture } from '@/lib/core/texture';
import { formatResourceId } from '@/lib/core/bundle';

const HANDLER_KEY = 'shader';

// ---------------------------------------------------------------------------
// Link Shader → imported ShaderProgramBuffers
// ---------------------------------------------------------------------------

type LinkedProgram = {
	/** Import position within the shader's import list. */
	importIndex: number;
	/** bigint resource id of the linked program buffer. */
	id: bigint;
	/** Block 1 bytecode (the DXBC SM5 container). Null when the import
	 *  doesn't resolve or the resource has no block 1. */
	bytecode: Uint8Array | null;
};

type LinkedTechnique = {
	techniqueIndex: number;
	/** Best-effort pairing: first program of the pair is the vertex shader,
	 *  second is the pixel shader. Order falls out of how Burnout's shader
	 *  loader patches the ShaderTechnique struct — not a hard guarantee,
	 *  but the program type is validated after translation and we re-pair
	 *  if a mismatch is detected. */
	vertex?: LinkedProgram & { translated?: TranslatedShader; error?: string };
	pixel?: LinkedProgram & { translated?: TranslatedShader; error?: string };
};

function useLinkedShader(model: ParsedShader | null, bundleResourceIndex: number) {
	const activeBundle = useFirstLoadedBundle();
	const loadedBundle = activeBundle?.parsed ?? null;
	const originalArrayBuffer = activeBundle?.originalArrayBuffer ?? null;
	return useMemo<LinkedTechnique[]>(() => {
		if (!model || !loadedBundle || !originalArrayBuffer) return [];
		const importIds = getImportIds(
			loadedBundle.imports,
			loadedBundle.resources,
			bundleResourceIndex,
		);

		// Resolve each import ID to a resource entry + bytecode block.
		const programs: LinkedProgram[] = importIds.map((id, i) => {
			const target = loadedBundle.resources.find((r) => {
				const rid = u64ToBigInt(r.resourceId);
				return rid === id && r.resourceTypeId === SHADER_PROGRAM_BUFFER_TYPE_ID;
			});
			if (!target) return { importIndex: i, id, bytecode: null };
			const blocks = getResourceBlocks(
				originalArrayBuffer,
				loadedBundle,
				target,
			);
			return { importIndex: i, id, bytecode: blocks[1] ?? null };
		});

		// Translate each program once up-front.
		type TP = LinkedProgram & { translated?: TranslatedShader; error?: string };
		const translated: TP[] = programs.map((p) => {
			if (!p.bytecode) return { ...p };
			try {
				return { ...p, translated: translateDxbc(p.bytecode) };
			} catch (e) {
				return { ...p, error: e instanceof Error ? e.message : String(e) };
			}
		});

		// Pair per technique. Burnout ships {vs, ps} pairs — we emit the two
		// programs in that order and verify via programType from DXBC. When a
		// pair's programType doesn't line up (very rare), swap.
		const result: LinkedTechnique[] = [];
		for (let t = 0; t < model.numTechniques; t++) {
			const a = translated[2 * t];
			const b = translated[2 * t + 1];
			let vs: TP | undefined = a;
			let ps: TP | undefined = b;
			if (vs?.translated && ps?.translated) {
				if (vs.translated.parsed.programType === 'pixel' &&
					ps.translated.parsed.programType === 'vertex') {
					[vs, ps] = [ps, vs];
				}
			} else if (!vs?.translated && ps?.translated?.parsed.programType === 'vertex') {
				vs = ps; ps = a;
			}
			result.push({ techniqueIndex: t, vertex: vs, pixel: ps });
		}
		return result;
	}, [model, loadedBundle, originalArrayBuffer, bundleResourceIndex]);
}

// ---------------------------------------------------------------------------
// three.js mount for a translated {vs, ps} pair
// ---------------------------------------------------------------------------

// Tiny fallback used when the translator hands us nothing usable — keeps the
// preview visible so the user can still pick techniques / see metadata.
const FALLBACK_VS = /* glsl */ `
	void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const FALLBACK_FS = /* glsl */ `
	precision highp float;
	void main() { gl_FragColor = vec4(0.6, 0.1, 0.6, 1.0); }
`;

// Per-shader cb0 slot discovery. Burnout's fxc output is extremely regular,
// so we can recover the world / view / viewProj / depth-encode slots by
// pattern-matching the translated GLSL. Anything we can't recover falls
// back to reasonable defaults so the binding hook always has *something*
// to bind.
type CbLayout = {
	/** Slot of row 0 of the world matrix. Typically 40..48. */
	worldRow0: number;
	/** Slot of row 0 of view*projection. Typically 5. */
	vpRow0: number;
	/** Slot of view matrix row 2 (used to compute view-space z). Typically 7. */
	viewRow2: number;
	/** Slot of the depth encoder `(A, B, C, D)` — always 8 in practice. */
	depthEncode: number;
	/** Slot of the camera-position vector (SM5 typically 37..38). */
	cameraPos: number | null;
};

function inferCbLayout(vs: string, parsed?: ParsedDxbc): CbLayout {
	// Prefer slot lookups by RDEF variable name when we have parsed
	// reflection data — that's the authoritative answer per shader (vehicle
	// shaders put ViewPosition at slot 37, water at slot 35, etc.). Fall
	// back to regex pattern matching for the few cases without parsed data.
	const slotByName = (name: string): number | null => {
		if (!parsed) return null;
		for (const cb of parsed.reflection.constantBuffers) {
			for (const v of cb.variables) {
				if (v.name === name) return Math.floor(v.startOffset / 16);
			}
		}
		return null;
	};

	// worldRow0: look for `pos.xxxx * cb0[N]` — N is the row-0 slot. fxc
	// emits rows in {y, x, z, w} accumulation order; we key on the .xxxx row
	// which is always the row-0 multiply.
	const worldMatch = vs.match(/position, 0\.0\)\.xxxx \* cb0\[(\d+)\]/);
	const worldRow0 = slotByName('world') ?? (worldMatch ? Number(worldMatch[1]) : 44);

	// viewRow2: first `dot(r0.xyzw, cb0[N].xyzw)` after the world transform,
	// whose result feeds into the `o0.zw` depth-encode pair.
	const viewMatch = vs.match(/r1\.x = vec4\(vec4\(dot\(r0\.xyzw, cb0\[(\d+)\]\.xyzw\)\)\)/);
	const viewRow2 = viewMatch ? Number(viewMatch[1]) : 7;

	// vpRow0: the ViewProjectionModified matrix slot, or the first cb used
	// in an o0.x dp4 if we can't read the RDEF.
	const vpMatch = vs.match(/o0\.x = vec4\(vec4\(dot\(r0\.xyzw, cb0\[(\d+)\]\.xyzw\)\)\)/);
	const vpRow0 = slotByName('ViewProjectionModified') ?? (vpMatch ? Number(vpMatch[1]) : 5);

	// cameraPos: prefer the named ViewPosition variable over the regex
	// pattern, since vehicle shaders put it at a different slot than terrain.
	const camMatch = vs.match(/-\(r0\.xyzx\) \+ cb0\[(\d+)\]\.xyzx/);
	const cameraPos = slotByName('ViewPosition') ?? (camMatch ? Number(camMatch[1]) : null);

	return { worldRow0, vpRow0, viewRow2, depthEncode: 8, cameraPos };
}

// Given a translated program, guess reasonable default three.js attribute
// aliases so a_POSITION0 / a_NORMAL0 / a_TEXCOORD0 are fed from standard
// geometry attributes. three.js passes `position`, `normal`, `uv` by default;
// we alias the DXBC-named attributes to those.
function attributeAliasPrefix(vs: string): string {
	const uses: string[] = [];
	if (/a_POSITION0/.test(vs)) uses.push('#define a_POSITION0 position');
	if (/a_NORMAL0/.test(vs)) uses.push('#define a_NORMAL0 normal');
	if (/a_TEXCOORD0/.test(vs)) uses.push('#define a_TEXCOORD0 uv');
	// Any other a_FOOn we leave undefined — three.js will compile-error and
	// the user can see which attribute needs a real binding.
	return uses.join('\n') + (uses.length ? '\n' : '');
}

type DebugMode = 'off' | 'reference';

// ---------------------------------------------------------------------------
// Procedural fallback textures
// ---------------------------------------------------------------------------
//
// Without parsing MaterialAssembly + the texture bundles we don't have the
// real game textures. But binding every sampler to a single 1×1 pink texel
// makes water look like pink soup. Instead, pick a fallback by sampler name
// so a "WaveNormal" sampler actually returns a normal map, "Reflection"
// returns a sky-blue gradient, "shadow" returns white (= no shadow), etc.
// Cached per-page-load — these are immutable once built.

let _waveNormalTex: THREE.DataTexture | null = null;
let _skyReflectionTex: THREE.DataTexture | null = null;
let _whiteTex: THREE.DataTexture | null = null;
let _riverFloorTex: THREE.DataTexture | null = null;
let _pinkTex: THREE.DataTexture | null = null;

function makeRepeatTex(data: Uint8Array, w: number, h: number) {
	const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.minFilter = THREE.LinearFilter;
	t.magFilter = THREE.LinearFilter;
	t.needsUpdate = true;
	return t;
}

function getWaveNormalTex(): THREE.DataTexture {
	if (_waveNormalTex) return _waveNormalTex;
	const N = 128;
	const data = new Uint8Array(N * N * 4);
	for (let y = 0; y < N; y++) {
		for (let x = 0; x < N; x++) {
			const u = x / N, v = y / N;
			// Two octaves of swirl give a tileable normal-ish surface.
			const dx = 0.30 * Math.cos(2 * Math.PI * 2 * u)
				+ 0.15 * Math.sin(2 * Math.PI * 4 * v + 1.7);
			const dy = 0.30 * Math.sin(2 * Math.PI * 2 * v)
				+ 0.15 * Math.cos(2 * Math.PI * 4 * u - 0.9);
			const z = Math.sqrt(Math.max(0.0, 1.0 - dx * dx - dy * dy));
			const i = (y * N + x) * 4;
			data[i + 0] = Math.round((dx * 0.5 + 0.5) * 255);
			data[i + 1] = Math.round((dy * 0.5 + 0.5) * 255);
			data[i + 2] = Math.round((z * 0.5 + 0.5) * 255);
			data[i + 3] = 255;
		}
	}
	return (_waveNormalTex = makeRepeatTex(data, N, N));
}

function getSkyReflectionTex(): THREE.DataTexture {
	if (_skyReflectionTex) return _skyReflectionTex;
	const W = 8, H = 64;
	const data = new Uint8Array(W * H * 4);
	for (let y = 0; y < H; y++) {
		const t = y / (H - 1);
		// y=0 horizon (warm-ish), y=H-1 zenith (deep sky blue).
		const r = Math.round(180 + (90 - 180) * t);
		const g = Math.round(200 + (140 - 200) * t);
		const b = Math.round(220 + (220 - 220) * t);
		for (let x = 0; x < W; x++) {
			const i = (y * W + x) * 4;
			data[i + 0] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
		}
	}
	return (_skyReflectionTex = makeRepeatTex(data, W, H));
}

function getWhiteTex(): THREE.DataTexture {
	if (_whiteTex) return _whiteTex;
	return (_whiteTex = makeRepeatTex(new Uint8Array([255, 255, 255, 255]), 1, 1));
}

function getRiverFloorTex(): THREE.DataTexture {
	if (_riverFloorTex) return _riverFloorTex;
	const N = 32;
	const data = new Uint8Array(N * N * 4);
	for (let y = 0; y < N; y++) {
		for (let x = 0; x < N; x++) {
			// Mottled muddy blue-green to break up the underwater colour.
			const n = 0.5 + 0.5 * Math.sin(x * 0.7) * Math.cos(y * 0.9);
			const i = (y * N + x) * 4;
			data[i + 0] = Math.round(40 + n * 30);
			data[i + 1] = Math.round(70 + n * 40);
			data[i + 2] = Math.round(60 + n * 30);
			data[i + 3] = 255;
		}
	}
	return (_riverFloorTex = makeRepeatTex(data, N, N));
}

function getPinkTex(): THREE.DataTexture {
	if (_pinkTex) return _pinkTex;
	return (_pinkTex = makeRepeatTex(new Uint8Array([255, 64, 200, 255]), 1, 1));
}

type FallbackKind = 'shadow' | 'normal' | 'reflection' | 'floor' | 'diffuse' | 'pink';

function classifyFallback(samplerName: string): FallbackKind {
	const n = samplerName.toLowerCase();
	if (n.includes('shadow')) return 'shadow';
	if (n.includes('wavenormal') || n.includes('normalmap') || n.includes('normal')) return 'normal';
	if (n.includes('reflection') || n.includes('reflect') || n.includes('envmap')) return 'reflection';
	if (n.includes('riverfloor')) return 'floor';
	if (n.includes('diffuse') || n.includes('albedo')) return 'diffuse';
	return 'pink';
}

const FALLBACK_LABELS: Record<FallbackKind, string> = {
	shadow:     'white 1×1 (no shadow)',
	normal:     'procedural wave normals 128² (sin/cos perturbation)',
	reflection: 'sky gradient 8×64 (warm horizon → blue zenith)',
	floor:      'muddy blue-green tile 32² (procedural noise)',
	diffuse:    'muddy blue-green tile 32² (procedural noise)',
	pink:       'pink 1×1 (no fallback for this sampler name)',
};

function pickFallbackTexture(samplerName: string): THREE.DataTexture {
	const k = classifyFallback(samplerName);
	switch (k) {
		case 'shadow': return getWhiteTex();
		case 'normal': return getWaveNormalTex();
		case 'reflection': return getSkyReflectionTex();
		case 'floor': case 'diffuse': return getRiverFloorTex();
		case 'pink': return getPinkTex();
	}
}

// Convert a DecodedTexture (RGBA pixel buffer + header) into a three.js
// DataTexture suitable for ShaderMaterial samplers. Repeat-wraps and uses
// linear filtering — close enough to the game's typical sampler state for
// the preview, and avoids needing the actual TextureState parsed.
function decodedToDataTexture(dt: DecodedTexture): THREE.DataTexture {
	const tex = new THREE.DataTexture(dt.pixels, dt.header.width, dt.header.height, THREE.RGBAFormat);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.flipY = false;
	tex.needsUpdate = true;
	return tex;
}

// Defaults applied to runtime-bound cb0 variables that the game would
// normally fill from the engine but we leave as plausible static values
// so the preview doesn't collapse to black. Module-scope so the Inputs
// tab can show users which variables we made up.
const HEURISTIC_DEFAULTS: Record<string, [number, number, number, number]> = {
	g_PerVehicleFog: [0, 0, 0, 1],
	FogColourPlusWhiteLevel: [0.55, 0.70, 0.85, 1],
	KeyLightColour: [1, 1, 1, 1],
	KeyLightClampedColour: [1, 1, 1, 1],
	KeyLightSpecularColour: [1, 1, 1, 1],
	KeyLightDirection: [0.4, -0.7, 0.6, 0],
	SkyReflectionColour: [0.55, 0.75, 0.95, 1],
	ShadowMap_Constants: [1, 1, 1, 1],
	ShadowMap_Constants2: [1, 1, 1, 1],
	ShadowMap_Constants3: [1, 1, 1, 1],
	ScattCoeffs: [0.4, 0.4, 0.5, 1],
	g_damageConstants: [0, 0, 0, 1],
	sampleCoverage: [1, 1, 1, 1],
	// Vehicle paint defaults — without these the vehicle PaintGloss
	// shader's `r0 *= g_paintColour` collapses the body to black.
	g_paintColour: [0.6, 0.1, 0.1, 1],
	g_pearlescentColour: [0.2, 0.2, 0.3, 1],
};

// A self-contained, known-good water shader used as a "does the rendering
// pipeline actually work?" reference. Three.js auto-provides modelMatrix,
// viewMatrix, projectionMatrix, normalMatrix, and cameraPosition. We only
// need to drive `u_time` from the render loop to animate the waves.
//
// VS: classic three-wave Gerstner displacement on the sphere's surface,
// with the per-vertex normal perturbed toward the wave gradient so the
// pixel shader has something physically plausible to shade.
// PS: schlick-fresnel mix between deep-water and a sky-blue reflection,
// plus a Blinn-Phong specular spike. No textures — pure procedural so the
// reference is dependency-free.
//
// Reference for the wave model: NVIDIA GPU Gems Ch. 1 (Finch / Laeuchli).
const REFERENCE_WATER_VS = /* glsl */ `
	uniform float u_time;
	varying vec3 vWorldNormal;
	varying vec3 vWorldPos;

	vec3 gerstner(vec2 xz, vec2 dir, float A, float k, float w, float Q, float t) {
		float phase = dot(dir, xz) * k - w * t;
		float c = cos(phase), s = sin(phase);
		return vec3(Q * A * dir.x * c, A * s, Q * A * dir.y * c);
	}

	void main() {
		vec3 p = position;
		vec2 xz = p.xz * 2.0;
		vec3 d  = vec3(0.0);
		d += gerstner(xz, normalize(vec2( 1.0,  0.6)), 0.06, 1.5, 1.6, 0.6, u_time);
		d += gerstner(xz, normalize(vec2(-0.7,  1.0)), 0.04, 2.4, 2.4, 0.5, u_time);
		d += gerstner(xz, normalize(vec2( 0.3, -0.9)), 0.025, 3.7, 3.0, 0.4, u_time);
		p += d;
		vec4 wp = modelMatrix * vec4(p, 1.0);
		vWorldPos = wp.xyz;
		vec3 n = normalize(normal + vec3(-d.x, 0.0, -d.z) * 1.5);
		vWorldNormal = normalize(mat3(modelMatrix) * n);
		gl_Position = projectionMatrix * viewMatrix * wp;
	}
`;
const REFERENCE_WATER_FS = /* glsl */ `
	precision highp float;
	varying vec3 vWorldNormal;
	varying vec3 vWorldPos;

	void main() {
		vec3 N = normalize(vWorldNormal);
		vec3 V = normalize(cameraPosition - vWorldPos);
		vec3 L = normalize(vec3(0.4, 0.8, 0.5));
		vec3 deepColor = vec3(0.02, 0.18, 0.32);
		vec3 shallow   = vec3(0.20, 0.55, 0.65);
		vec3 sky       = vec3(0.55, 0.75, 0.95);
		float NdotV = clamp(dot(N, V), 0.0, 1.0);
		float fresnel = pow(1.0 - NdotV, 5.0);
		vec3 base = mix(deepColor, shallow, clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
		vec3 H = normalize(L + V);
		float spec = pow(max(dot(N, H), 0.0), 80.0);
		float diff = clamp(dot(N, L), 0.0, 1.0);
		vec3 col = mix(base * (0.4 + 0.6 * diff), sky, fresnel) + vec3(spec);
		gl_FragColor = vec4(col, 1.0);
	}
`;

function PreviewMesh({
	tech,
	shader,
	debugMode,
	textureCatalog,
	materialBinding,
}: {
	tech: LinkedTechnique;
	/** Parent Shader resource — supplies the baked-in material constant
	 *  values (`materialDiffuse`, `g_fresnelRanges`, etc.) that the DXBC
	 *  pixel shader reads by name via cb0 slots. Without this they sit at
	 *  vec4(0) and the PS output collapses to black. */
	shader: ParsedShader;
	/** 'off'       — use the translated vs + ps from the DXBC pipeline.
	 *  'reference' — use the bundled Gerstner-water shader (sanity probe
	 *                that proves the three.js / mesh / uniforms wiring is
	 *                healthy independent of the translator). */
	debugMode: DebugMode;
	/** All Texture resources the user has loaded across primary + secondary
	 *  bundles. Per-sampler lookup picks the best name match; whatever has
	 *  no match falls back to a procedural placeholder. */
	textureCatalog: TextureCatalogEntry[];
	/** Pixel-correct sampler binding, when a Material targeting this shader
	 *  was found in any loaded bundle. Wins over name-matching. */
	materialBinding: MaterialBinding | null;
}) {
	const meshRef = useRef<THREE.Mesh>(null);
	const [compileError, setCompileError] = useState<string | null>(null);

	const material = useMemo(() => {
		const vs = tech.vertex?.translated?.source;
		const ps = tech.pixel?.translated?.source;
		if (debugMode === 'reference') {
			// Known-good Gerstner-wave water shader. Doesn't depend on the
			// DXBC translator at all — if this animates and shades correctly
			// then ShaderMaterial + the sphere mesh + the render loop are all
			// healthy and any defects must be in translateDxbc / cb seeding.
			const m = new THREE.ShaderMaterial({
				vertexShader: REFERENCE_WATER_VS,
				fragmentShader: REFERENCE_WATER_FS,
				uniforms: { u_time: { value: 0 } },
			});
			(m as THREE.ShaderMaterial & { __updateTime?: (t: number) => void }).__updateTime = (t) => {
				m.uniforms.u_time.value = t;
			};
			return m;
		}
		if (!vs || !ps) {
			return new THREE.ShaderMaterial({
				vertexShader: FALLBACK_VS,
				fragmentShader: FALLBACK_FS,
			});
		}
		const layout = inferCbLayout(vs, tech.vertex?.translated?.parsed);
		const m = buildTranslatedShaderMaterial({
			vsSource: vs,
			psSource: ps,
			vsParsed: tech.vertex?.translated?.parsed,
			psParsed: tech.pixel?.translated?.parsed,
			shaderName: shader.name,
			shaderConstants: shader.constants,
			layout,
			materialBinding,
			textureCatalog,
			heuristicDefaults: HEURISTIC_DEFAULTS,
			pickFallbackTexture,
			decodedToDataTexture: (entry) => {
				try { return decodedToDataTexture(entry.decode()); } catch { return null; }
			},
			applyPreviewTonemap: true,
		});
		// Debug hook: expose the actual shader sources + material so the
		// browser console / preview_eval can poke at them.
		(window as unknown as { __lastShaders?: { vs: string; ps: string } }).__lastShaders = {
			vs: m.vertexShader,
			ps: m.fragmentShader,
		};
		(window as unknown as { __lastMaterial?: THREE.ShaderMaterial }).__lastMaterial = m;
		return m;
	}, [tech, shader, debugMode, textureCatalog, materialBinding]);

	// Surface compile errors from WebGL so the UI can flag them. three.js
	// logs to the console; we also poll programInfoLog once per material.
	useFrame(({ gl, clock }) => {
		if (!meshRef.current) return;
		meshRef.current.rotation.y += 0.005;
		const upd = (material as THREE.Material & { __updateTime?: (t: number) => void }).__updateTime;
		if (upd) upd(clock.getElapsedTime());
		if (compileError === null) {
			const prog = (material as THREE.ShaderMaterial & { program?: WebGLProgram }).program;
			if (prog) {
				const log = gl.getContext().getProgramInfoLog(prog);
				if (log && log.trim().length > 0) setCompileError(log);
				else setCompileError('');
			}
		}
	});

	return (
		<>
			<mesh
				ref={meshRef}
				frustumCulled={false}
				onBeforeRender={(_r, _s, camera, _g, mat, _group) => {
					const upd = (mat as THREE.Material & { __updateCb0?: (c: THREE.Camera, o: THREE.Object3D) => void }).__updateCb0;
					if (upd && meshRef.current) upd(camera, meshRef.current);
				}}
			>
				<sphereGeometry args={[1, 64, 48]} />
				<primitive object={material} attach="material" />
			</mesh>
			{compileError && compileError.length > 0 && (
				<primitive
					object={(() => {
						// No-op three.js primitive: compile error is surfaced by the
						// parent via the onError prop instead. Kept here as a marker so
						// the render loop keeps updating.
						const g = new THREE.Object3D();
						g.userData.error = compileError;
						return g;
					})()}
				/>
			)}
		</>
	);
}

function PreviewCanvas({ tech, shader, debugMode, textureCatalog, materialBinding }: { tech: LinkedTechnique; shader: ParsedShader; debugMode: DebugMode; textureCatalog: TextureCatalogEntry[]; materialBinding: MaterialBinding | null }) {
	return (
		<Canvas
			camera={{ position: [0, 0, 3], fov: 40 }}
			dpr={[1, 2]}
			style={{ background: 'hsl(var(--muted))' }}
		>
			<ambientLight intensity={0.6} />
			<directionalLight position={[3, 4, 5]} intensity={1.0} />
			<PreviewMesh tech={tech} shader={shader} debugMode={debugMode} textureCatalog={textureCatalog} materialBinding={materialBinding} />
			<OrbitControls enablePan={false} enableDamping dampingFactor={0.1} />
		</Canvas>
	);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function TechniquesTab({ model, linked, activeTech, onPick }: {
	model: ParsedShader;
	linked: LinkedTechnique[];
	activeTech: number;
	onPick: (t: number) => void;
}) {
	return (
		<div className="space-y-2">
			{model.techniques.map((t, i) => {
				const l = linked[i];
				return (
					<Card key={i} className={i === activeTech ? 'border-primary' : ''}>
						<CardContent className="py-3">
							<div className="flex items-center gap-2">
								<button
									onClick={() => onPick(i)}
									className={`font-mono text-sm hover:underline ${i === activeTech ? 'text-primary' : ''}`}
								>
									#{i} {t.name || '(unnamed)'}
								</button>
								<span className="text-xs text-muted-foreground ml-auto">
									{l?.vertex?.translated?.summary ?? (l?.vertex?.error ? 'vs: err' : 'vs: —')} ·{' '}
									{l?.pixel?.translated?.summary ?? (l?.pixel?.error ? 'ps: err' : 'ps: —')}
								</span>
							</div>
							{t.samplers.length > 0 && (
								<table className="mt-2 text-xs w-full">
									<thead className="text-muted-foreground">
										<tr><th className="text-left font-normal pr-2">Sampler</th><th className="text-right font-normal">Channel</th></tr>
									</thead>
									<tbody className="font-mono">
										{t.samplers.map((s, si) => (
											<tr key={si}><td className="pr-2">{s.name}</td><td className="text-right">{s.channel}</td></tr>
										))}
									</tbody>
								</table>
							)}
						</CardContent>
					</Card>
				);
			})}
		</div>
	);
}

function ConstantsTab({ model }: { model: ParsedShader }) {
	if (model.constants.length === 0) {
		return <p className="text-sm text-muted-foreground p-2">No constants decoded.</p>;
	}
	return (
		<table className="text-xs w-full">
			<thead className="text-muted-foreground">
				<tr className="border-b">
					<th className="text-left font-normal py-1 pr-2">Name</th>
					<th className="text-right font-normal pr-2">Size</th>
					<th className="text-right font-normal pr-2">Idx</th>
					<th className="text-right font-normal pr-2">Hash</th>
					<th className="text-left font-normal">Instance data</th>
				</tr>
			</thead>
			<tbody className="font-mono">
				{model.constants.map((c, i) => (
					<tr key={i} className="border-b last:border-0">
						<td className="pr-2 py-1">{c.name || '(unnamed)'}</td>
						<td className="text-right pr-2">{c.size}</td>
						<td className="text-right pr-2">{c.index}</td>
						<td className="text-right pr-2">0x{c.hash.toString(16).padStart(8, '0')}</td>
						<td>{c.instanceData ? c.instanceData.map((v) => v.toFixed(3)).join(', ') : '—'}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function HeaderTab({ model, linked }: { model: ParsedShader; linked: LinkedTechnique[] }) {
	const vsCount = linked.filter((l) => l.vertex?.translated).length;
	const psCount = linked.filter((l) => l.pixel?.translated).length;
	const rows: [string, string][] = [
		['Shader name', model.name],
		['Flags (+0x05)', `0x${model.flags.toString(16).padStart(2, '0')}`],
		['Techniques', `${model.numTechniques}`],
		['Constants', `${model.numConstants} (${model.numConstantsWithInstanceData} with instance data)`],
		['Layout', model.hasInlineHLSL ? 'Original PC (inline HLSL at +0x24)' : 'Remastered (compiled ShaderProgramBuffer imports)'],
		['Translated programs', `${vsCount} vs · ${psCount} ps (of ${model.numTechniques} techniques)`],
		['Resource size', `${model.totalSize} bytes`],
	];
	return (
		<table className="text-sm">
			<tbody>
				{rows.map(([k, v]) => (
					<tr key={k}><td className="pr-4 py-1 text-muted-foreground">{k}</td><td className="font-mono">{v}</td></tr>
				))}
			</tbody>
		</table>
	);
}

// ---------------------------------------------------------------------------
// Inputs tab — make the implicit explicit.
//
// Surfaces what the shader expects to read (samplers + cb0 variables) and
// what the preview actually supplies for each. Three sources of truth:
//   - "engine"    we feed every frame from three.js (world / vp / camera /
//                 depth / time)
//   - "baked"     the Shader resource itself ships an instance default
//   - "heuristic" the preview made up a plausible value because nothing
//                 else was available
//   - "zero"      nobody supplies it — the shader operates on vec4(0)
// "zero" rows are the most likely culprit when output looks wrong.
// ---------------------------------------------------------------------------

type InputSource = 'engine' | 'baked' | 'heuristic' | 'zero';

const SOURCE_BADGE: Record<InputSource, { label: string; cls: string }> = {
	engine:    { label: 'engine',    cls: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
	baked:     { label: 'baked',     cls: 'bg-green-500/20 text-green-300 border-green-500/40' },
	heuristic: { label: 'heuristic', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
	zero:      { label: 'zero',      cls: 'bg-red-500/15 text-red-300 border-red-500/40' },
};

function InputsTab({ linked, activeTech, shader, textureCatalog, materialBinding }: { linked: LinkedTechnique[]; activeTech: number; shader: ParsedShader; textureCatalog: TextureCatalogEntry[]; materialBinding: MaterialBinding | null }) {
	const tech = linked[activeTech];
	const vsSrc = tech?.vertex?.translated?.source;
	if (!tech || !vsSrc) return <p className="text-sm text-muted-foreground p-2">No translated programs to analyse.</p>;
	const layout = inferCbLayout(vsSrc, tech.vertex?.translated?.parsed);

	// Engine-supplied slots (per-shader inferred layout).
	const engineSlots = new Map<number, string>();
	for (let i = 0; i < 4; i++) engineSlots.set(layout.worldRow0 + i, `world matrix row ${i} (mesh.matrixWorld)`);
	for (let i = 0; i < 2; i++) engineSlots.set(layout.vpRow0 + i, `view·projection row ${i} (camera)`);
	engineSlots.set(layout.viewRow2, 'view matrix row 2 (camera)');
	engineSlots.set(layout.depthEncode, 'depth encoder (A,B,C,D from camera near/far)');
	if (layout.cameraPos != null) engineSlots.set(layout.cameraPos, 'camera world position');

	// Collect cb0 variable usage across both stages.
	type Var = { name: string; comp: number; size: number };
	const slotVars = new Map<number, Var[]>();
	for (const stage of [tech.vertex, tech.pixel]) {
		const parsed = stage?.translated?.parsed;
		if (!parsed) continue;
		for (const cbuf of parsed.reflection.constantBuffers) {
			for (const v of cbuf.variables) {
				const slot = Math.floor(v.startOffset / 16);
				const comp = (v.startOffset % 16) / 4;
				const arr = slotVars.get(slot) ?? [];
				if (!arr.some((x) => x.name === v.name && x.comp === comp)) {
					arr.push({ name: v.name, comp, size: v.size });
				}
				slotVars.set(slot, arr);
			}
		}
	}
	// Add any engine-only slots not already in slotVars (so they show up too).
	for (const slot of engineSlots.keys()) {
		if (!slotVars.has(slot)) slotVars.set(slot, []);
	}

	const sortedSlots = Array.from(slotVars.entries()).sort((a, b) => a[0] - b[0]);

	const classifySlot = (slot: number, vars: Var[]): { source: InputSource; detail: string } => {
		if (engineSlots.has(slot)) return { source: 'engine', detail: engineSlots.get(slot)! };
		if (vars.some((v) => /time/i.test(v.name))) return { source: 'engine', detail: 'wall-clock time (performance.now / 1000)' };
		const baked = vars.find((v) => shader.constants.find((c) => c.name === v.name && c.instanceData));
		if (baked) {
			const c = shader.constants.find((cc) => cc.name === baked.name && cc.instanceData)!;
			return { source: 'baked', detail: `${baked.name} = (${c.instanceData!.map((x) => x.toFixed(3)).join(', ')})` };
		}
		const heur = vars.find((v) => HEURISTIC_DEFAULTS[v.name]);
		if (heur) {
			const hd = HEURISTIC_DEFAULTS[heur.name];
			return { source: 'heuristic', detail: `${heur.name} = (${hd.map((x) => x.toFixed(3)).join(', ')})` };
		}
		return { source: 'zero', detail: vars.length ? `not supplied — reads as vec4(0)` : '(unused)' };
	};

	// Sampler analysis: walk PS sources for `uniform sampler2D NAME // tN`.
	const psSrc = tech.pixel?.translated?.source ?? '';
	const sampDecls = Array.from(psSrc.matchAll(/uniform sampler2D ([A-Za-z0-9_]+);(?:\s*\/\/\s*t(\d+))?/g))
		.map((m) => ({ name: m[1], regNum: m[2] != null ? Number(m[2]) : -1 }));

	return (
		<div className="space-y-5 text-xs">
			<section>
				<h4 className="font-semibold mb-1 text-sm">Samplers</h4>
				<p className="text-muted-foreground mb-2">
					What the shader samples · what the preview binds. Precedence: <span className="text-blue-300">material</span>{' '}
					(authored binding from a Material in any loaded bundle) → <span className="text-green-300">real</span>{' '}
					(name-matched texture from the catalogue) → <span className="text-amber-300">heuristic</span>{' '}
					(procedural placeholder).
					{materialBinding && (
						<> Material in use: <span className="font-mono text-blue-300">{materialBinding.materialName}</span>{' '}
						<span className="text-muted-foreground">({materialBinding.source})</span></>
					)}
				</p>
				{sampDecls.length === 0 ? (
					<p className="text-muted-foreground">No samplers used.</p>
				) : (
					<table className="w-full">
						<thead className="text-muted-foreground">
							<tr className="border-b">
								<th className="text-left font-normal py-1 pr-2">Sampler</th>
								<th className="text-left font-normal pr-2">Reg</th>
								<th className="text-left font-normal pr-2">Source</th>
								<th className="text-left font-normal">Bound to</th>
							</tr>
						</thead>
						<tbody className="font-mono">
							{sampDecls.map((s) => {
								const fromMaterial = (s.regNum >= 0 && materialBinding) ? materialBinding.samplerBindings.get(s.regNum) : undefined;
								const nameMatch = fromMaterial ? null : pickTextureForSampler(s.name, textureCatalog, shader.name);
								const match = fromMaterial ?? nameMatch;
								const sourceKind = fromMaterial ? 'material' : (nameMatch ? 'real' : 'heuristic');
								const badge = sourceKind === 'material'
									? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
									: sourceKind === 'real'
										? 'bg-green-500/20 text-green-300 border-green-500/40'
										: 'bg-amber-500/20 text-amber-300 border-amber-500/40';
								return (
									<tr key={s.name} className="border-b last:border-0">
										<td className="py-1 pr-2">{s.name}</td>
										<td className="pr-2 text-muted-foreground">{s.regNum >= 0 ? `t${s.regNum}` : ''}</td>
										<td className="pr-2">
											<span className={`px-1.5 py-0.5 rounded border ${badge}`}>{sourceKind}</span>
										</td>
										<td>{match
											? <><span className={sourceKind === 'material' ? 'text-blue-300' : 'text-green-300'}>{match.name}</span>{' '}<span className="text-muted-foreground">({match.source})</span></>
											: <span className="text-muted-foreground">{FALLBACK_LABELS[classifyFallback(s.name)]}</span>}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</section>

			<section>
				<h4 className="font-semibold mb-1 text-sm">cb0 slots</h4>
				<p className="text-muted-foreground mb-2">
					Per-slot reflection of the $Globals constant buffer. Source colour shows where
					each value comes from in the preview. <span className="text-red-300">zero</span>{' '}
					slots are the most likely culprits when output looks wrong (they're read by the
					shader but nothing in the preview supplies them).
				</p>
				<table className="w-full">
					<thead className="text-muted-foreground">
						<tr className="border-b">
							<th className="text-right font-normal py-1 pr-2">Slot</th>
							<th className="text-left font-normal pr-2">Variable(s)</th>
							<th className="text-left font-normal pr-2">Source</th>
							<th className="text-left font-normal">Detail</th>
						</tr>
					</thead>
					<tbody className="font-mono">
						{sortedSlots.map(([slot, vars]) => {
							const { source, detail } = classifySlot(slot, vars);
							const badge = SOURCE_BADGE[source];
							const varNames = vars.length === 0
								? <span className="text-muted-foreground">—</span>
								: vars.map((v) => `${v.name}${v.size !== 16 ? `[${v.size / 4}f@.${'xyzw'[v.comp]}]` : ''}`).join(', ');
							return (
								<tr key={slot} className="border-b last:border-0">
									<td className="py-1 pr-2 text-right text-muted-foreground">{slot}</td>
									<td className="pr-2">{varNames}</td>
									<td className="pr-2">
										<span className={`px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
									</td>
									<td className="text-muted-foreground">{detail}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</section>

			<section>
				<h4 className="font-semibold mb-1 text-sm">Renderer assumptions</h4>
				<ul className="list-disc pl-5 text-muted-foreground space-y-1">
					<li>Geometry is a unit sphere. Burnout shaders are tuned for ~100m outdoor scenes,
						so cascade-shadow / scattering math can produce HDR negatives that we tonemap
						via <code>abs() / (abs() + 1)</code> (Reinhard on magnitude). Pink = NaN, cyan = Inf.</li>
					<li><code>log2 / sqrt / inversesqrt</code> are wrapped in <code>max(arg, 1e-30)</code>{' '}
						by the translator so a single negative input doesn't poison the frame with NaN.</li>
					<li>World matrix rows come from <code>mesh.matrixWorld</code>, view·projection rows
						from the orbit camera, depth encoder from camera near/far, time from
						<code>performance.now()</code>.</li>
					<li>Engine-bound variables we don't have real values for fall back to a heuristic
						(<span className="text-amber-300">amber</span> rows above) — sun roughly
						down-and-forward, white key light, sky-blue reflection probe, no fog.</li>
					<li>Skinned/vehicle bone slots (cb0[48..175] on car shaders) aren't seeded — that's
						why most vehicle shaders still render dark.</li>
				</ul>
			</section>
		</div>
	);
}

function GlslTab({ linked, activeTech }: { linked: LinkedTechnique[]; activeTech: number }) {
	const tech = linked[activeTech];
	if (!tech) return <p className="text-sm text-muted-foreground p-2">No technique selected.</p>;
	return (
		<div className="grid grid-cols-2 gap-3 text-xs">
			<ProgramSource title="Vertex" link={tech.vertex} />
			<ProgramSource title="Pixel" link={tech.pixel} />
		</div>
	);
}

function ProgramSource({
	title,
	link,
}: {
	title: string;
	link: LinkedTechnique['vertex'];
}) {
	if (!link) {
		return <div><h4 className="font-semibold mb-1">{title}</h4><p className="text-muted-foreground">Not imported.</p></div>;
	}
	if (link.error) {
		return <div><h4 className="font-semibold mb-1">{title}</h4><p className="text-destructive font-mono whitespace-pre-wrap">{link.error}</p></div>;
	}
	const t = link.translated;
	if (!t) {
		return <div><h4 className="font-semibold mb-1">{title}</h4><p className="text-muted-foreground">Translator produced no source.</p></div>;
	}
	return (
		<div className="flex flex-col min-h-0">
			<h4 className="font-semibold mb-1 flex items-center gap-2">
				{title}
				<Badge variant="outline">{t.programLabel}</Badge>
				<span className="text-muted-foreground font-normal">{t.decoded.body.length} instr</span>
			</h4>
			<pre className="font-mono bg-muted p-2 rounded max-h-[45vh] overflow-auto whitespace-pre-wrap break-all">
				{t.source}
			</pre>
			{t.unsupported.length > 0 && (
				<p className="mt-1 text-amber-700">Unsupported ops: {t.unsupported.join(', ')}</p>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const ShaderPage = () => {
	const { getResources } = useWorkspace();
	const bundleId = useFirstLoadedBundleId();
	const activeBundle = useFirstLoadedBundle();
	const loadedBundle = activeBundle?.parsed ?? null;
	const originalArrayBuffer = activeBundle?.originalArrayBuffer ?? null;
	const debugResources = activeBundle?.debugResources ?? [];
	const uiResources = activeBundle?.resources ?? [];
	const { secondaryBundles, loadSecondaryBundle, removeSecondaryBundle } = useWorkspaceCompanion();
	const models = useMemo(
		() => (bundleId ? [...getResources<ParsedShader>(bundleId, HANDLER_KEY)] : []),
		[bundleId, getResources],
	);
	const shaderUIResources = useMemo(
		() => uiResources.filter((r) => r.raw?.resourceTypeId === SHADER_TYPE_ID),
		[uiResources],
	);

	const allSources = useMemo(() => {
		const sources = [];
		if (loadedBundle && originalArrayBuffer) {
			sources.push({ source: 'primary', bundle: loadedBundle, arrayBuffer: originalArrayBuffer, debug: debugResources });
		}
		for (const sb of secondaryBundles) {
			sources.push({ source: sb.name, bundle: sb.bundle, arrayBuffer: sb.arrayBuffer, debug: sb.debugResources });
		}
		return sources;
	}, [loadedBundle, originalArrayBuffer, debugResources, secondaryBundles]);
	const textureCatalog = useMemo(() => buildTextureCatalog(allSources), [allSources]);
	const materialIndex = useMemo(() => buildMaterialIndex(allSources, textureCatalog), [allSources, textureCatalog]);

	const [query, setQuery] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [activeTech, setActiveTech] = useState(0);
	const [debugMode, setDebugMode] = useState<DebugMode>('off');
	const cycleDebugMode = () => {
		setDebugMode((m) => m === 'off' ? 'reference' : 'off');
	};

	const entries = useMemo(() => {
		return models.map((m, i) => ({
			model: m,
			index: i,
			label: m?.name || shaderUIResources[i]?.name || `Shader #${i}`,
		}));
	}, [models, shaderUIResources]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return entries;
		return entries.filter((e) => e.label.toLowerCase().includes(q));
	}, [entries, query]);

	// Resolve the bundle-level index of the currently-selected shader so we
	// can look up its imports. `entries` counts only Shader resources; we
	// need the position in loadedBundle.resources.
	const bundleResourceIndex = useMemo(() => {
		if (!loadedBundle) return -1;
		let count = 0;
		for (let i = 0; i < loadedBundle.resources.length; i++) {
			if (loadedBundle.resources[i].resourceTypeId === SHADER_TYPE_ID) {
				if (count === selectedIndex) return i;
				count++;
			}
		}
		return -1;
	}, [loadedBundle, selectedIndex]);

	const current = entries[selectedIndex]?.model ?? null;
	const linked = useLinkedShader(current, bundleResourceIndex);

	// Resolve current shader's u64 id (formatted as catalog-key hex) so we
	// can ask the material index "any Materials targeting this shader?".
	// Falls back through both primary and secondary sources because the
	// Water shader, for example, exists in both SHADERS.BNDL and
	// GLOBALBACKDROPS.BNDL — match by name first then by bundle position.
	const currentShaderId = useMemo(() => {
		if (!current) return null;
		const r = loadedBundle?.resources[bundleResourceIndex];
		if (r) return formatResourceId(u64ToBigInt(r.resourceId));
		return null;
	}, [current, loadedBundle, bundleResourceIndex]);

	// All shader-register slots used by either stage of the active technique,
	// so pickBestMaterial can prefer the Material with the richest binding.
	const activeRegistersForBestMaterial = useMemo(() => {
		const tech = linked[0];  // any technique works — same shader, same regs
		const ps = tech?.pixel?.translated?.source ?? '';
		const vs = tech?.vertex?.translated?.source ?? '';
		const out = new Set<number>();
		for (const m of (ps + vs).matchAll(/uniform sampler2D [A-Za-z0-9_]+;\s*\/\/\s*t(\d+)/g)) {
			out.add(Number(m[1]));
		}
		return [...out];
	}, [linked]);

	const materialBinding = useMemo<MaterialBinding | null>(() => {
		if (!currentShaderId) return null;
		return pickBestMaterial(currentShaderId, activeRegistersForBestMaterial, materialIndex);
	}, [currentShaderId, activeRegistersForBestMaterial, materialIndex]);

	if (entries.length === 0) {
		return (
			<Card>
				<CardHeader><CardTitle>Shader</CardTitle></CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						Load a bundle containing Shader resources (type 0x32) to begin — e.g. <span className="font-mono">example/SHADERS.BNDL</span>.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="h-full min-h-0 flex gap-3">
			{/* Left: shader list */}
			<div className="w-72 shrink-0 flex flex-col min-h-0">
				<Input
					placeholder="Filter shaders…"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="mb-2"
				/>
				<ScrollArea className="flex-1 min-h-0 border rounded">
					<ul className="text-xs">
						{filtered.map((e) => (
							<li key={e.index}>
								<button
									onClick={() => { setSelectedIndex(e.index); setActiveTech(0); }}
									className={`w-full text-left px-2 py-1 border-b last:border-0 hover:bg-muted/60 ${e.index === selectedIndex ? 'bg-muted font-medium' : ''}`}
								>
									<span className="font-mono truncate block">{e.label}</span>
									{e.model && (
										<span className="text-[10px] text-muted-foreground">
											{e.model.numTechniques} techs · {e.model.numConstants} consts
											{e.model.hasInlineHLSL ? ' · HLSL' : ''}
										</span>
									)}
								</button>
							</li>
						))}
						{filtered.length === 0 && (
							<li className="p-2 text-muted-foreground">No matches.</li>
						)}
					</ul>
				</ScrollArea>
				<div className="text-[10px] text-muted-foreground mt-1">
					{filtered.length} / {entries.length} shaders
				</div>

				{/* Companion-bundle picker — load WORLDTEX*.BIN etc. so the
				    sampler binder can pull real textures by name match. */}
				<div className="mt-3 border rounded p-2 bg-muted/40">
					<div className="text-[11px] font-semibold mb-1">Texture bundles</div>
					<p className="text-[10px] text-muted-foreground mb-2">
						Load companion bundles to bind real textures into samplers (matched by name).
						{textureCatalog.length > 0 && ` ${textureCatalog.length} textures indexed.`}
					</p>
					<label className="block">
						<input
							type="file"
							className="hidden"
							onChange={(e) => {
								const f = e.target.files?.[0];
								if (f) loadSecondaryBundle(f);
								if (e.target) e.target.value = '';
							}}
						/>
						<span className="text-[11px] cursor-pointer underline text-primary hover:text-primary/80">
							+ add bundle
						</span>
					</label>
					{secondaryBundles.length > 0 && (
						<ul className="mt-1 space-y-0.5">
							{secondaryBundles.map((b) => (
								<li key={b.name} className="flex items-center gap-1 text-[10px]">
									<span className="font-mono truncate flex-1">{b.name}</span>
									<button
										onClick={() => removeSecondaryBundle(b.name)}
										className="text-muted-foreground hover:text-destructive px-1"
										title="Remove"
									>×</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>

			{/* Right: preview + metadata tabs */}
			<div className="flex-1 min-h-0 flex flex-col gap-3">
				{current ? (
					<>
						<Card className="shrink-0">
							<CardHeader className="pb-2">
								<CardTitle className="text-base flex items-center gap-2">
									<span className="font-mono truncate">{current.name}</span>
									<Badge variant="secondary">flags 0x{current.flags.toString(16).padStart(2, '0')}</Badge>
									<Badge variant="outline">technique {activeTech} / {current.numTechniques - 1}</Badge>
									<button
										className="text-xs underline text-muted-foreground hover:text-foreground ml-auto"
										onClick={cycleDebugMode}
									>
										{debugMode === 'off' ? 'show: reference water' : 'show: translated'}
									</button>
								</CardTitle>
							</CardHeader>
							<CardContent className="h-[320px] p-0">
								{linked[activeTech] ? <PreviewCanvas tech={linked[activeTech]} shader={current} debugMode={debugMode} textureCatalog={textureCatalog} materialBinding={materialBinding} /> : null}
							</CardContent>
						</Card>

						<Card className="flex-1 min-h-0">
							<CardContent className="h-full p-3">
								<Tabs defaultValue="header" className="h-full flex flex-col">
									<TabsList>
										<TabsTrigger value="header">Header</TabsTrigger>
										<TabsTrigger value="techniques">Techniques ({current.techniques.length})</TabsTrigger>
										<TabsTrigger value="constants">Constants ({current.constants.length})</TabsTrigger>
										<TabsTrigger value="inputs">Inputs</TabsTrigger>
										<TabsTrigger value="glsl">GLSL</TabsTrigger>
									</TabsList>
									<ScrollArea className="flex-1 min-h-0 mt-2">
										<TabsContent value="header"><HeaderTab model={current} linked={linked} /></TabsContent>
										<TabsContent value="techniques"><TechniquesTab model={current} linked={linked} activeTech={activeTech} onPick={setActiveTech} /></TabsContent>
										<TabsContent value="constants"><ConstantsTab model={current} /></TabsContent>
										<TabsContent value="inputs"><InputsTab linked={linked} activeTech={activeTech} shader={current} textureCatalog={textureCatalog} materialBinding={materialBinding} /></TabsContent>
										<TabsContent value="glsl"><GlslTab linked={linked} activeTech={activeTech} /></TabsContent>
									</ScrollArea>
								</Tabs>
							</CardContent>
						</Card>
					</>
				) : (
					<Card>
						<CardContent className="p-6 text-sm text-muted-foreground">
							Shader #{selectedIndex} failed to parse.
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	);
};

export default ShaderPage;

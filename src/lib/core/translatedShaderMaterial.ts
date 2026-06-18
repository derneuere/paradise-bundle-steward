// Build a three.js ShaderMaterial from a Burnout DXBC-translated shader.
//
// This is the same pipeline the ShaderPage preview uses, lifted into a
// reusable helper so the Renderable viewport can apply real authored
// shaders (instead of MeshStandardMaterial approximations) to actual
// vehicle / scene meshes.
//
// Inputs:
//   - vsSrc / psSrc   GLSL ES emitted by `translateDxbc` for the two stages
//   - vsParsed/psParsed  parsed DXBC reflection so we can read RDEF variable
//                        names + cb slot positions
//   - shaderConstants the parent Shader resource's baked instance defaults
//   - layout          the cb0 slot map produced by `inferCbLayout`
//   - materialBinding optional per-register MaterialAssembly binding (wins
//                     over name-matching when present)
//   - textureCatalog  cross-bundle Texture catalog for name-matched fallback
//
// Output: THREE.ShaderMaterial with cb arrays seeded, samplers bound to
// either real game textures or procedural placeholders, and an
// `__updateCb0(camera, object)` callback the mesh's onBeforeRender should
// invoke per frame to refresh world / view-projection / depth-encoder /
// camera-position / time slots.

import * as THREE from 'three';
import type { ParsedDxbc } from './dxbc';
import type { TextureCatalogEntry } from './textureCatalog';
import { pickTextureForSampler } from './textureCatalog';
import type { MaterialBinding } from './materialBinding';
import type { ParsedShaderConstant } from './shader';
import { type CbLayout, seedSkinningPalettes } from './shaderEngineConstants';

export type BuildOptions = {
	vsSource: string;
	psSource: string;
	vsParsed?: ParsedDxbc;
	psParsed?: ParsedDxbc;
	shaderName: string;
	shaderConstants: readonly ParsedShaderConstant[];
	layout: CbLayout;
	materialBinding: MaterialBinding | null;
	textureCatalog: TextureCatalogEntry[];
	/** Heuristic defaults for runtime-bound cb0 variables. Module-level so
	 *  callers (ShaderPage / RenderableViewport) share one table. */
	heuristicDefaults: Record<string, [number, number, number, number]>;
	/** Returns a procedural fallback `THREE.DataTexture` for a sampler whose
	 *  name didn't match anything in the catalog (e.g. white for shadow,
	 *  sky-blue gradient for reflection). */
	pickFallbackTexture: (samplerName: string) => THREE.DataTexture;
	/** Convert a `DecodedTexture` from the catalog into a uploaded
	 *  `THREE.DataTexture`. Lifted to caller because both ShaderPage and
	 *  RenderableViewport already have similar helpers. */
	decodedToDataTexture: (entry: TextureCatalogEntry) => THREE.DataTexture | null;
	/** When true, wrap the user's gl_FragColor in an abs+Reinhard tonemap
	 *  with NaN→pink / Inf→cyan tints. Useful for the sphere preview where
	 *  HDR negatives are common; the Renderable viewport disables it so a
	 *  vehicle paint colour shows its real albedo, not a tonemapped one. */
	applyPreviewTonemap?: boolean;
	/** Side flag passed straight through to `THREE.ShaderMaterial`. */
	side?: THREE.Side;
	/** Forwarded to `ShaderMaterial.transparent`. */
	transparent?: boolean;
};

export type TranslatedMaterial = THREE.ShaderMaterial & {
	__updateCb0?: (camera: THREE.Camera, object: THREE.Object3D) => void;
};

export function buildTranslatedShaderMaterial(opts: BuildOptions): TranslatedMaterial {
	const {
		vsSource, psSource, vsParsed, psParsed,
		shaderName, shaderConstants, layout,
		materialBinding, textureCatalog,
		heuristicDefaults, pickFallbackTexture, decodedToDataTexture,
		applyPreviewTonemap = false,
		side = THREE.DoubleSide, transparent = false,
	} = opts;

	// cb0 size fixup — VS and PS must agree on the array dimension or GLSL
	// linkage fails.
	const [harmonizedVs, harmonizedPs] = harmonizeCbSizes(vsSource, psSource);

	// Aliases so a_POSITION0 / a_NORMAL0 / a_TEXCOORD0 pull from three.js's
	// standard `position` / `normal` / `uv` attributes.
	const finalVs = attributeAliasPrefix(harmonizedVs) + harmonizedVs;

	// Optional preview safety net + Reinhard tonemap on gl_FragColor.
	const finalPs = applyPreviewTonemap
		? harmonizedPs.replace(/\}\s*$/, PREVIEW_TONEMAP_SUFFIX)
		: harmonizedPs;

	const m = new THREE.ShaderMaterial({
		vertexShader: finalVs,
		fragmentShader: finalPs,
		uniforms: THREE.UniformsUtils.clone({}),
		side,
		transparent,
	}) as TranslatedMaterial;

	// Allocate zeroed cb arrays for every `uniform vec4 cbN[...]` declared.
	const cbDecls = Array.from(finalPs.matchAll(/uniform vec4 (cb\d+)\[(\d+)\];/g)).concat(
		Array.from(finalVs.matchAll(/uniform vec4 (cb\d+)\[(\d+)\];/g)),
	);
	const seededCbs = new Set<string>();
	for (const [, name, lenStr] of cbDecls) {
		if (seededCbs.has(name)) continue;
		seededCbs.add(name);
		const len = Number(lenStr);
		m.uniforms[name] = {
			value: new Array(len).fill(0).map(() => new THREE.Vector4()),
		};
	}

	// Seed material defaults from the Shader's baked constants + the
	// heuristic table for runtime-bound variables (sun direction, fog,
	// shadow constants etc.). Tracks any "Time"-named slots so __updateCb0
	// can refresh them per-frame.
	const timeSlots = new Set<number>();
	const writeScalars = (arr: THREE.Vector4[], slot: number, comp: number, src: ArrayLike<number>, n: number) => {
		const v = arr[slot]; if (!v) return;
		const c: [number, number, number, number] = [v.x, v.y, v.z, v.w];
		for (let i = 0; i < n; i++) {
			const idx = comp + i;
			if (idx < 4) c[idx] = src[i] ?? 0;
		}
		v.set(c[0], c[1], c[2], c[3]);
	};
	const seedDefaults = (parsed: ParsedDxbc | undefined) => {
		if (!parsed) return;
		const arr = m.uniforms.cb0?.value as THREE.Vector4[] | undefined;
		if (!arr) return;
		for (const cbuf of parsed.reflection.constantBuffers) {
			for (const v of cbuf.variables) {
				const slot = Math.floor(v.startOffset / 16);
				if (slot >= arr.length) continue;
				const comp = (v.startOffset % 16) / 4;
				const nFloats = Math.max(1, Math.min(4 - comp, Math.floor(v.size / 4)));
				if (/time/i.test(v.name)) timeSlots.add(slot);
				const baked = shaderConstants.find((c) => c.name === v.name && c.instanceData);
				if (baked?.instanceData) {
					writeScalars(arr, slot, comp, baked.instanceData, nFloats);
					continue;
				}
				const hd = heuristicDefaults[v.name];
				if (hd) writeScalars(arr, slot, comp, hd, nFloats);
			}
		}
	};
	seedDefaults(vsParsed);
	seedDefaults(psParsed);

	// Identity-fill the bone-matrix palette so skinned vehicle meshes render at
	// rest pose instead of collapsing to the origin (see shaderEngineConstants).
	const cb0Arr = m.uniforms.cb0?.value as THREE.Vector4[] | undefined;
	if (cb0Arr) {
		const writeVec4 = (slot: number, x: number, y: number, z: number, w: number) => {
			if (slot >= 0 && slot < cb0Arr.length) cb0Arr[slot].set(x, y, z, w);
		};
		seedSkinningPalettes(vsParsed, writeVec4);
		seedSkinningPalettes(psParsed, writeVec4);
	}

	// __updateCb0 — engine-fed slots refreshed per frame from three.js
	// matrices + clock. The mesh's onBeforeRender invokes this.
	if (seededCbs.has('cb0')) {
		const world = new THREE.Matrix4();
		const viewMat = new THREE.Matrix4();
		const viewProj = new THREE.Matrix4();
		const worldViewProj = new THREE.Matrix4();
		const cameraPos = new THREE.Vector3();
		// Two ways a shader consumes a matrix from cb0, and they need DIFFERENT
		// extraction:
		//  - dot pattern  `o.x = dot(v, cb0[N])`  → cb0[N] = math ROW N of the
		//    matrix. fxc emits this for the view/projection matrices applied to an
		//    already-transformed worldPos.
		//  - mad pattern  `wp = v.x*cb0[N] + v.y*cb0[N+1] + v.z*cb0[N+2] + cb0[N+3]`
		//    → cb0[N..N+3] = the matrix's COLUMNS, so the translation lands in
		//    cb0[N+3].xyz. fxc emits this for the object `world` matrix applied to
		//    the local vertex position.
		// Using setRow for a mad-consumed matrix drops the translation (cb0[N+3]
		// becomes the (0,0,0,1) bottom row) — every part collapses toward local
		// origin, which on a multi-part vehicle reads as "GraphicsSpec ignored".
		const setRow = (cb: THREE.Vector4[], slot: number, mm: THREE.Matrix4, row: number) => {
			if (slot < 0 || slot >= cb.length) return;
			const e = mm.elements;
			cb[slot].set(e[row], e[4 + row], e[8 + row], e[12 + row]);
		};
		const setCol = (cb: THREE.Vector4[], slot: number, mm: THREE.Matrix4, col: number) => {
			if (slot < 0 || slot >= cb.length) return;
			const e = mm.elements;
			const o = col * 4;
			cb[slot].set(e[o], e[o + 1], e[o + 2], e[o + 3]);
		};
		m.__updateCb0 = (camera, object) => {
			world.copy(object.matrixWorld);
			viewMat.copy((camera as THREE.PerspectiveCamera).matrixWorldInverse);
			viewProj.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, viewMat);
			cameraPos.setFromMatrixPosition(camera.matrixWorld);
			const cb0 = m.uniforms.cb0.value as THREE.Vector4[];
			setRow(cb0, layout.vpRow0, viewProj, 0);
			setRow(cb0, layout.vpRow0 + 1, viewProj, 1);
			setRow(cb0, layout.viewRow2, viewMat, 2);
			const pc = camera as THREE.PerspectiveCamera;
			const near = pc.near ?? 0.1;
			const far = pc.far ?? 1000;
			const A = -(far + near) / (far - near);
			const B = -2 * far * near / (far - near);
			if (cb0[layout.depthEncode]) cb0[layout.depthEncode].set(A, B, -1, 0);
			// world is mad-consumed (`wp = pos.x*cb0[w] + … + cb0[w+3]`), so write
			// COLUMNS — cb0[worldRow0+3] must carry the locator translation.
			setCol(cb0, layout.worldRow0 + 0, world, 0);
			setCol(cb0, layout.worldRow0 + 1, world, 1);
			setCol(cb0, layout.worldRow0 + 2, world, 2);
			setCol(cb0, layout.worldRow0 + 3, world, 3);
			// Full 4-row engine matrices: shaders that transform with
			// `worldViewProj` / `viewProjection` directly (rather than the
			// ViewProjectionModified depth-encode scheme) need all four rows or
			// the vertex never reaches clip space and the mesh vanishes.
			if (layout.viewProjectionRow0 != null) {
				for (let r = 0; r < 4; r++) setRow(cb0, layout.viewProjectionRow0 + r, viewProj, r);
			}
			if (layout.worldViewProjRow0 != null) {
				worldViewProj.multiplyMatrices(viewProj, world);
				for (let r = 0; r < 4; r++) setRow(cb0, layout.worldViewProjRow0 + r, worldViewProj, r);
			}
			if (layout.cameraPos != null && cb0[layout.cameraPos]) {
				cb0[layout.cameraPos].set(cameraPos.x, cameraPos.y, cameraPos.z, 1);
			}
			if (timeSlots.size > 0) {
				const t = performance.now() * 0.001;
				for (const slot of timeSlots) {
					if (cb0[slot]) cb0[slot].set(t, t, t, t);
				}
			}
		};
	}

	// Sampler binding: material → name-match → procedural fallback.
	const samplerRe = /uniform sampler2D ([A-Za-z0-9_]+);(?:\s*\/\/\s*t(\d+))?/g;
	const sampDecls = Array.from(finalPs.matchAll(samplerRe)).concat(Array.from(finalVs.matchAll(samplerRe)));
	for (const decl of sampDecls) {
		const name = decl[1];
		const reg = decl[2] != null ? Number(decl[2]) : -1;
		if (m.uniforms[name]) continue;
		const fromMaterial = (reg >= 0 && materialBinding) ? materialBinding.samplerBindings.get(reg) : undefined;
		const match = fromMaterial ?? pickTextureForSampler(name, textureCatalog, shaderName);
		let tex: THREE.DataTexture | null = null;
		if (match) tex = decodedToDataTexture(match);
		m.uniforms[name] = { value: tex ?? pickFallbackTexture(name) };
	}

	return m;
}

// =============================================================================
// Helpers (private)
// =============================================================================

function harmonizeCbSizes(a: string, b: string): [string, string] {
	const maxForReg = new Map<string, number>();
	const gather = (src: string) => {
		for (const [, name, len] of src.matchAll(/uniform vec4 (cb\d+)\[(\d+)\];/g)) {
			const L = Number(len);
			if (L > (maxForReg.get(name) ?? 0)) maxForReg.set(name, L);
		}
	};
	gather(a); gather(b);
	const rewrite = (src: string) =>
		src.replace(/uniform vec4 (cb\d+)\[(\d+)\];/g, (_m, name) =>
			`uniform vec4 ${name}[${maxForReg.get(name)}];`);
	return [rewrite(a), rewrite(b)];
}

function attributeAliasPrefix(vs: string): string {
	const uses: string[] = [];
	if (/a_POSITION0/.test(vs)) uses.push('#define a_POSITION0 position');
	if (/a_NORMAL0/.test(vs)) uses.push('#define a_NORMAL0 normal');
	if (/a_TEXCOORD0/.test(vs)) uses.push('#define a_TEXCOORD0 uv');
	return uses.join('\n') + (uses.length ? '\n' : '');
}

const PREVIEW_TONEMAP_SUFFIX = `
	{
		vec3 _c = gl_FragColor.rgb;
		bool _nan = (_c.r != _c.r) || (_c.g != _c.g) || (_c.b != _c.b);
		bool _inf = (abs(_c.r) > 1e10) || (abs(_c.g) > 1e10) || (abs(_c.b) > 1e10);
		if (_nan) gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
		else if (_inf) gl_FragColor = vec4(0.0, 1.0, 1.0, 1.0);
		else { vec3 a = abs(_c); gl_FragColor = vec4(a / (a + vec3(1.0)), 1.0); }
	}
}`;

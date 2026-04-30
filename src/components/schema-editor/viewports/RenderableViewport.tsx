// 3D viewport for the Renderable schema editor.
//
// Pure renderer / UI shell. The expensive decoding pipeline (parseRenderable
// → resolve imports → decode vertex arrays → resolve material textures)
// lives in RenderableDecodedProvider, which also owns the decode-mode / LOD
// filter / texture pack / shader name state so the tree and the inspector
// see the same filtered set.
//
// The viewport keeps only local, interaction-scoped state:
//   - wireframe toggle
//   - paint color + active palette
//   - hovered mesh (mouse-move highlight, viewport-only — never escapes)
//
// Selection is NOT local state. The highlighted mesh is DERIVED from the
// schema editor's `selectedPath` via a useMemo. Clicks in 3D dispatch
// `selectPath(...)` directly — that single write causes the re-render, the
// re-derivation, and the highlight update in one pass. A previous version
// of this file used a separate `selected` useState plus two effects (one
// for viewport→schema and one for schema→viewport sync) — those effects
// shared deps and kept overwriting each other with stale values, causing
// a visible flicker as the highlight oscillated between clicks. The
// derived-state pattern below is ping-pong-proof because there's only one
// direction of data flow.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { useActiveBundle, useWorkspaceCompanion } from '@/context/WorkspaceContext';
import { RENDERABLE_TYPE_ID } from '@/lib/core/renderable';
import { extractResourceRaw } from '@/lib/core/registry/extract';
import type { ResolvedMaterial } from '@/lib/core/materialChain';
import { parsePlayerCarColoursData, type PlayerCarColours } from '@/lib/core/playerCarColors';
import type { DecodedTexture } from '@/lib/core/texture';
import { D3DTextureAddress } from '@/lib/core/textureState';
import type { ParsedBundle, ResourceEntry } from '@/lib/core/types';
import { SHADER_TYPE_ID, parseShaderData, SHADER_PROGRAM_BUFFER_TYPE_ID } from '@/lib/core/shader';
import { getResourceBlocks } from '@/lib/core/resourceManager';
import { getImportIds } from '@/lib/core/bundle';
import { u64ToBigInt } from '@/lib/core/u64';
import { translateDxbc, type TranslatedShader } from '@/lib/core/dxbc';
import { buildTextureCatalog, type TextureCatalogEntry } from '@/lib/core/textureCatalog';
import { buildMaterialIndex, pickBestMaterial } from '@/lib/core/materialBinding';
import { buildTranslatedShaderMaterial, type TranslatedMaterial } from '@/lib/core/translatedShaderMaterial';
import { decodeTexture } from '@/lib/core/texture';
import { parseMaterialData } from '@/lib/core/material';
import {
	type DecodedMesh,
	type DecodedRenderable,
	useRenderableDecoded,
	computeSceneBounds,
	locatorToMatrix4,
} from './renderableDecodedContext';
import { useSchemaEditor } from '../context';

// =============================================================================
// Colour picker — uses PlayerCarColours from the loaded bundle if available,
// falls back to a built-in palette otherwise.
// =============================================================================

const DEFAULT_PAINT_COLORS: { name: string; r: number; g: number; b: number }[] = [
	{ name: 'White', r: 0.95, g: 0.95, b: 0.95 },
	{ name: 'Silver', r: 0.75, g: 0.75, b: 0.78 },
	{ name: 'Gunmetal', r: 0.35, g: 0.37, b: 0.40 },
	{ name: 'Black', r: 0.05, g: 0.05, b: 0.05 },
	{ name: 'Red', r: 0.85, g: 0.08, b: 0.08 },
	{ name: 'Dark Red', r: 0.55, g: 0.02, b: 0.02 },
	{ name: 'Orange', r: 0.95, g: 0.45, b: 0.05 },
	{ name: 'Yellow', r: 0.95, g: 0.85, b: 0.05 },
	{ name: 'Lime', r: 0.45, g: 0.85, b: 0.08 },
	{ name: 'Green', r: 0.02, g: 0.55, b: 0.15 },
	{ name: 'Teal', r: 0.05, g: 0.65, b: 0.65 },
	{ name: 'Blue', r: 0.08, g: 0.35, b: 0.85 },
	{ name: 'Dark Blue', r: 0.05, g: 0.12, b: 0.45 },
	{ name: 'Purple', r: 0.45, g: 0.08, b: 0.75 },
	{ name: 'Pink', r: 0.90, g: 0.20, b: 0.55 },
	{ name: 'Gold', r: 0.75, g: 0.60, b: 0.15 },
	{ name: 'Bronze', r: 0.55, g: 0.35, b: 0.15 },
	{ name: 'Brown', r: 0.35, g: 0.18, b: 0.05 },
];

function VehicleColorPicker({
	carColours,
	activePalette,
	setActivePalette,
	paintColor,
	onSelectColor,
}: {
	carColours: PlayerCarColours | null;
	activePalette: number;
	setActivePalette: (p: number) => void;
	paintColor: { r: number; g: number; b: number; pearl?: { r: number; g: number; b: number } } | null;
	onSelectColor: (color: { r: number; g: number; b: number; pearl?: { r: number; g: number; b: number } } | null) => void;
}) {
	if (carColours) {
		const palette = carColours.palettes[activePalette];
		return (
			<div className="px-3 pb-2 space-y-1">
				<div className="flex items-center gap-1 text-xs">
					{carColours.palettes.map((p, i) => (
						<button
							key={i}
							className={`px-2 py-0.5 rounded text-xs ${i === activePalette ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
							onClick={() => setActivePalette(i)}
						>
							{p.typeName}
						</button>
					))}
					<button
						className="px-2 py-0.5 rounded text-xs bg-muted hover:bg-muted/80 ml-2"
						onClick={() => onSelectColor(null)}
					>
						reset
					</button>
				</div>
				<div className="flex flex-wrap gap-1">
					{palette.paintColours.map((c, i) => {
						const rgb = { r: Math.max(0, Math.min(1, c.red)), g: Math.max(0, Math.min(1, c.green)), b: Math.max(0, Math.min(1, c.blue)) };
						const pearlC = palette.pearlColours[i];
						const pearl = pearlC ? { r: Math.max(0, Math.min(1, pearlC.red)), g: Math.max(0, Math.min(1, pearlC.green)), b: Math.max(0, Math.min(1, pearlC.blue)) } : undefined;
						const isActive = paintColor && Math.abs(paintColor.r - rgb.r) < 0.01 && Math.abs(paintColor.g - rgb.g) < 0.01 && Math.abs(paintColor.b - rgb.b) < 0.01;
						return (
							<button
								key={i}
								className={`w-5 h-5 rounded-sm border ${isActive ? 'border-white ring-1 ring-white' : 'border-white/20'}`}
								style={{ backgroundColor: c.rgbValue }}
								title={`[${i}] ${c.hexValue}${pearlC ? ' + pearl ' + pearlC.hexValue : ''}${c.isNeon ? ' (neon)' : ''}`}
								onClick={() => onSelectColor({ ...rgb, pearl })}
							/>
						);
					})}
				</div>
			</div>
		);
	}
	return (
		<div className="px-3 pb-2 space-y-1">
			<div className="flex items-center gap-1 text-xs">
				<span className="text-muted-foreground">paint color:</span>
				<button
					className="px-2 py-0.5 rounded text-xs bg-muted hover:bg-muted/80 ml-1"
					onClick={() => onSelectColor(null)}
				>
					reset
				</button>
			</div>
			<div className="flex flex-wrap gap-1">
				{DEFAULT_PAINT_COLORS.map((c, i) => {
					const isActive = paintColor && Math.abs(paintColor.r - c.r) < 0.01 && Math.abs(paintColor.g - c.g) < 0.01 && Math.abs(paintColor.b - c.b) < 0.01;
					return (
						<button
							key={i}
							className={`w-5 h-5 rounded-sm border ${isActive ? 'border-white ring-1 ring-white' : 'border-white/20'}`}
							style={{ backgroundColor: `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})` }}
							title={c.name}
							onClick={() => onSelectColor({ r: c.r, g: c.g, b: c.b })}
						/>
					);
				})}
			</div>
		</div>
	);
}

// =============================================================================
// Environment cubemap (PMREM-baked sky-ground gradient)
// =============================================================================

function SceneEnvironment() {
	const { gl, scene } = useThree();
	useEffect(() => {
		const pmrem = new THREE.PMREMGenerator(gl);
		pmrem.compileCubemapShader();
		const envScene = new THREE.Scene();
		const skyGeo = new THREE.SphereGeometry(50, 32, 16);
		const skyMat = new THREE.ShaderMaterial({
			side: THREE.BackSide,
			uniforms: {},
			vertexShader: `
				varying vec3 vWorldPosition;
				void main() {
					vec4 worldPos = modelMatrix * vec4(position, 1.0);
					vWorldPosition = worldPos.xyz;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: `
				varying vec3 vWorldPosition;
				void main() {
					float h = normalize(vWorldPosition).y;
					vec3 sky = mix(vec3(0.8, 0.85, 0.9), vec3(0.5, 0.7, 1.0), max(h, 0.0));
					vec3 ground = mix(vec3(0.4, 0.35, 0.3), vec3(0.1, 0.08, 0.06), max(-h, 0.0));
					vec3 color = h > 0.0 ? sky : ground;
					gl_FragColor = vec4(color, 1.0);
				}
			`,
		});
		envScene.add(new THREE.Mesh(skyGeo, skyMat));
		const envMap = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
		scene.environment = envMap;
		return () => {
			envMap.dispose();
			pmrem.dispose();
			skyGeo.dispose();
			skyMat.dispose();
			scene.environment = null;
		};
	}, [gl, scene]);
	return null;
}

// =============================================================================
// Texture helpers
// =============================================================================

function makeDataTexture(
	decoded: DecodedTexture,
	sampler: { addressU: number; addressV: number } | null,
	srgb = true,
): THREE.DataTexture {
	const tex = new THREE.DataTexture(
		decoded.pixels,
		decoded.header.width,
		decoded.header.height,
		THREE.RGBAFormat,
	);
	tex.flipY = false;
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.generateMipmaps = true;
	if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
	applyWrapping(tex, sampler);
	tex.needsUpdate = true;
	return tex;
}

function applyWrapping(
	tex: THREE.DataTexture,
	sampler: { addressU: number; addressV: number } | null,
) {
	const map: Record<number, THREE.Wrapping> = {
		[D3DTextureAddress.WRAP]: THREE.RepeatWrapping,
		[D3DTextureAddress.MIRROR]: THREE.MirroredRepeatWrapping,
		[D3DTextureAddress.CLAMP]: THREE.ClampToEdgeWrapping,
		[D3DTextureAddress.BORDER]: THREE.ClampToEdgeWrapping,
		[D3DTextureAddress.MIRRORONCE]: THREE.MirroredRepeatWrapping,
	};
	tex.wrapS = map[sampler?.addressU ?? D3DTextureAddress.WRAP] ?? THREE.RepeatWrapping;
	tex.wrapT = map[sampler?.addressV ?? D3DTextureAddress.WRAP] ?? THREE.RepeatWrapping;
}

// =============================================================================
// Translated-shader rendering — opt-in path. When the user toggles
// "translated shaders" in the viewport header, each unique Material seen
// across the visible Renderables gets a real DXBC-translated ShaderMaterial
// (same pipeline the ShaderPage preview uses), wired up via the
// MaterialAssembly chain so per-channel sampler bindings come from the
// authored TextureStates instead of the heuristic Window/Chrome/Glass
// guesses below.
// =============================================================================

const TRANSLATED_HEURISTIC_DEFAULTS: Record<string, [number, number, number, number]> = {
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
	g_paintColour: [0.6, 0.1, 0.1, 1],
	g_pearlescentColour: [0.2, 0.2, 0.3, 1],
};

type Source = { source: string; bundle: ParsedBundle; arrayBuffer: ArrayBuffer; debug: any[] };

/** One-shot procedural placeholder — same look the ShaderPage uses for
 *  shadow-map and reflection probe samplers. */
function makePinkTex(): THREE.DataTexture {
	const t = new THREE.DataTexture(new Uint8Array([255, 64, 200, 255]), 1, 1, THREE.RGBAFormat);
	t.needsUpdate = true;
	return t;
}
function makeWhiteTex(): THREE.DataTexture {
	const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
	t.needsUpdate = true;
	return t;
}
const _fallback2x2 = makePinkTex();
const _fallbackWhite = makeWhiteTex();
function pickRenderableFallback(name: string): THREE.DataTexture {
	const n = name.toLowerCase();
	if (n.includes('shadow')) return _fallbackWhite;
	return _fallback2x2;
}

function decodedToDataTextureRV(entry: TextureCatalogEntry): THREE.DataTexture | null {
	let dt: DecodedTexture;
	try { dt = entry.decode(); } catch { return null; }
	const tex = new THREE.DataTexture(dt.pixels, dt.header.width, dt.header.height, THREE.RGBAFormat);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.flipY = false;
	tex.needsUpdate = true;
	return tex;
}

/**
 * Translate the ShaderProgramBuffer imports of a Shader resource into
 * `{ vs, ps }` GLSL. Returns null if the bundle layout doesn't match
 * (no block 1, broken import chain, etc.).
 */
function translateShaderById(shaderId: bigint, sources: Source[]): { vs: TranslatedShader; ps: TranslatedShader; shaderName: string; constants: any[] } | null {
	for (const s of sources) {
		for (let i = 0; i < s.bundle.resources.length; i++) {
			const r = s.bundle.resources[i];
			if (r.resourceTypeId !== SHADER_TYPE_ID) continue;
			if (u64ToBigInt(r.resourceId) !== shaderId) continue;
			let parsed;
			try {
				const raw = extractResourceRaw(s.arrayBuffer, s.bundle, r);
				parsed = parseShaderData(raw);
			} catch { return null; }
			const importIds = getImportIds(s.bundle.imports, s.bundle.resources, i);
			// First two imports are typically VS / PS for the default tech.
			let vs: TranslatedShader | null = null;
			let ps: TranslatedShader | null = null;
			for (const id of importIds) {
				const target = s.bundle.resources.find((rr) => u64ToBigInt(rr.resourceId) === id && rr.resourceTypeId === SHADER_PROGRAM_BUFFER_TYPE_ID);
				if (!target) continue;
				const blocks = getResourceBlocks(s.arrayBuffer, s.bundle, target as ResourceEntry);
				const bytecode = blocks[1];
				if (!bytecode) continue;
				try {
					const t = translateDxbc(bytecode);
					if (t.parsed.programType === 'vertex' && !vs) vs = t;
					else if (t.parsed.programType === 'pixel' && !ps) ps = t;
					if (vs && ps) break;
				} catch { /* try next */ }
			}
			if (!vs || !ps) return null;
			return { vs, ps, shaderName: parsed.name, constants: parsed.constants };
		}
	}
	return null;
}

/** Pattern-match the cb0 layout from a translated VS, falling back to the
 *  RDEF variable names when available. Identical to ShaderPage's
 *  `inferCbLayout` — duplicated here so the renderable viewport doesn't
 *  pull React state from the shader-page module. */
function inferCbLayoutForRV(vsSrc: string, parsed: any) {
	const slotByName = (name: string): number | null => {
		if (!parsed) return null;
		for (const cb of parsed.reflection.constantBuffers) {
			for (const v of cb.variables) {
				if (v.name === name) return Math.floor(v.startOffset / 16);
			}
		}
		return null;
	};
	const worldMatch = vsSrc.match(/position, 0\.0\)\.xxxx \* cb0\[(\d+)\]/);
	const worldRow0 = slotByName('world') ?? (worldMatch ? Number(worldMatch[1]) : 44);
	const viewMatch = vsSrc.match(/r1\.x = vec4\(vec4\(dot\(r0\.xyzw, cb0\[(\d+)\]\.xyzw\)\)\)/);
	const viewRow2 = viewMatch ? Number(viewMatch[1]) : 7;
	const vpMatch = vsSrc.match(/o0\.x = vec4\(vec4\(dot\(r0\.xyzw, cb0\[(\d+)\]\.xyzw\)\)\)/);
	const vpRow0 = slotByName('ViewProjectionModified') ?? (vpMatch ? Number(vpMatch[1]) : 5);
	const camMatch = vsSrc.match(/-\(r0\.xyzx\) \+ cb0\[(\d+)\]\.xyzx/);
	const cameraPos = slotByName('ViewPosition') ?? (camMatch ? Number(camMatch[1]) : null);
	return { worldRow0, vpRow0, viewRow2, depthEncode: 8, cameraPos };
}

// =============================================================================
// Mesh rendering + materials
// =============================================================================

function RenderableMeshes({
	renderables,
	wireframe,
	paintColor,
	selected,
	hovered,
	onSelect,
	onHover,
	useTranslatedShaders,
}: {
	renderables: DecodedRenderable[];
	wireframe: boolean;
	paintColor: { r: number; g: number; b: number; pearl?: { r: number; g: number; b: number } } | null;
	selected: { ri: number; mi: number } | null;
	hovered: { ri: number; mi: number } | null;
	onSelect: (sel: { ri: number; mi: number } | null) => void;
	onHover: (sel: { ri: number; mi: number } | null) => void;
	useTranslatedShaders: boolean;
}) {
	const activeBundle = useActiveBundle();
	const loadedBundle = activeBundle?.parsed ?? null;
	const originalArrayBuffer = activeBundle?.originalArrayBuffer ?? null;
	const debugResources = activeBundle?.debugResources ?? [];
	const { secondaryBundles } = useWorkspaceCompanion();
	const decoded = useRenderableDecoded();

	// Cross-bundle catalog + material index, only computed when the user
	// actually flips to translated shaders. Sources include the primary
	// bundle, the global secondaryBundles, AND the renderable page's own
	// "+ texture pack" list — that way users can drop SHADERS.BNDL via the
	// existing texture-pack button and have its shaders become translatable.
	const translatedSetup = useMemo(() => {
		if (!useTranslatedShaders) return null;
		const sources: Source[] = [];
		if (loadedBundle && originalArrayBuffer) {
			sources.push({ source: 'primary', bundle: loadedBundle, arrayBuffer: originalArrayBuffer, debug: debugResources });
		}
		for (const sb of secondaryBundles) {
			sources.push({ source: sb.name, bundle: sb.bundle, arrayBuffer: sb.arrayBuffer, debug: sb.debugResources });
		}
		// Renderable's own texture-pack list — separate state, but the same
		// raw bytes work fine as Material/Shader sources too.
		for (const tb of decoded?.textureBundles ?? []) {
			sources.push({ source: 'texture-pack', bundle: tb.bundle, arrayBuffer: tb.buffer, debug: [] });
		}
		const textureCatalog = buildTextureCatalog(sources);
		const materialIndex = buildMaterialIndex(sources, textureCatalog);
		return { sources, textureCatalog, materialIndex };
	}, [useTranslatedShaders, loadedBundle, originalArrayBuffer, debugResources, secondaryBundles, decoded?.textureBundles]);
	const baseMaterial = useMemo(
		() => {
			const mat = new THREE.MeshStandardMaterial({ color: 0xb0b8c0, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide, wireframe });
			if (paintColor) {
				mat.color.setRGB(paintColor.r, paintColor.g, paintColor.b);
				const pearl = paintColor.pearl;
				if (pearl) {
					mat.emissive.setRGB(pearl.r * 0.25, pearl.g * 0.25, pearl.b * 0.25);
				} else {
					mat.emissive.setRGB(paintColor.r * 0.3, paintColor.g * 0.3, paintColor.b * 0.3);
				}
				mat.emissiveIntensity = 1.0;
				mat.metalness = 0.6;
				mat.roughness = 0.25;
			}
			return mat;
		},
		[wireframe, paintColor],
	);
	const hoverMaterial = useMemo(
		() => new THREE.MeshStandardMaterial({ color: 0x5fa8ff, metalness: 0.1, roughness: 0.5, side: THREE.DoubleSide, emissive: 0x113355, emissiveIntensity: 0.4 }),
		[],
	);
	const selectedMaterial = useMemo(
		() => new THREE.MeshStandardMaterial({ color: 0xffaa33, metalness: 0.1, roughness: 0.5, side: THREE.DoubleSide, emissive: 0x664400, emissiveIntensity: 0.6 }),
		[],
	);

	const texturedMaterials = useMemo(() => {
		const map = new Map<string, THREE.MeshStandardMaterial>();
		for (const r of renderables) {
			for (const m of r.meshes) {
				if (!m.resolvedMaterial || !m.materialAssemblyId) continue;
				const key = m.materialAssemblyId.toString(16);
				if (map.has(key)) continue;

				const rm = m.resolvedMaterial;
				const props = rm.properties;
				let side: THREE.Side = THREE.DoubleSide;
				if (props) {
					if (props.cullMode === 2) side = THREE.FrontSide;
					else if (props.cullMode === 3) side = THREE.BackSide;
				}

				const mat = new THREE.MeshStandardMaterial({
					side,
					metalness: 0.15,
					roughness: 0.7,
					transparent: props?.alphaBlendEnable ?? false,
					alphaTest: props?.alphaTestEnable ? (props.alphaRef / 255) : 0,
					depthWrite: !(props?.alphaBlendEnable),
					wireframe,
				});

				if (rm.diffuse) {
					const tex = makeDataTexture(rm.diffuse, rm.samplerState);
					mat.map = tex;
				}

				const sn = rm.shaderName ?? '';

				if (sn.includes('Window')) {
					mat.transparent = true;
					mat.opacity = rm.diffuse ? 0.35 : 0.25;
					mat.color.setRGB(0.08, 0.1, 0.14);
					mat.metalness = 0.95;
					mat.roughness = 0.02;
					mat.envMapIntensity = 2.5;
					mat.depthWrite = false;
				} else if (sn.includes('Chrome')) {
					mat.color.setRGB(0.35, 0.35, 0.38);
					mat.metalness = 1.0;
					mat.roughness = 0.08;
					mat.envMapIntensity = 2.5;
				} else if (sn.includes('PaintGloss')) {
					if (paintColor) {
						mat.color.setRGB(paintColor.r, paintColor.g, paintColor.b);
						const pearl = paintColor.pearl;
						if (pearl) {
							mat.emissive.setRGB(pearl.r * 0.25, pearl.g * 0.25, pearl.b * 0.25);
						} else {
							mat.emissive.setRGB(paintColor.r * 0.3, paintColor.g * 0.3, paintColor.b * 0.3);
						}
						mat.emissiveIntensity = 1.0;
					} else {
						mat.color.setRGB(0.18, 0.18, 0.20);
					}
					mat.metalness = 0.6;
					mat.roughness = 0.2;
					mat.envMapIntensity = 1.5;
				} else if (sn.includes('Light') && sn.includes('EnvMapped')) {
					mat.metalness = 0.8;
					mat.roughness = 0.1;
					mat.envMapIntensity = 2.0;
				} else if (sn.includes('Metal') || sn.includes('SimpleMetal')) {
					mat.metalness = 0.7;
					mat.roughness = 0.3;
					mat.envMapIntensity = 1.2;
				} else if (sn.includes('Decal') && sn.includes('EnvMapped')) {
					mat.metalness = 0.4;
					mat.roughness = 0.3;
					mat.envMapIntensity = 1.5;
				} else if (sn.includes('Decal')) {
					mat.metalness = 0.1;
					mat.roughness = 0.6;
				} else if (sn.includes('CarGuts') || sn.includes('Livery')) {
					mat.metalness = 0.1;
					mat.roughness = 0.8;
				} else {
					const isGlassNoTex = !rm.diffuse && !rm.diffuseFromSecondary && rm.crossBundleMisses > 0;
					const isGlassSmallAlpha = rm.diffuse && rm.diffuseFromSecondary
						&& rm.diffuse.header.format === 'DXT5'
						&& rm.diffuse.header.width <= 128 && rm.diffuse.header.height <= 128;
					const isGlass = isGlassNoTex || isGlassSmallAlpha;
					if (isGlass) {
						mat.transparent = true;
						mat.opacity = 0.3;
						mat.color.setRGB(0.15, 0.18, 0.22);
						mat.metalness = 0.95;
						mat.roughness = 0.02;
						mat.envMapIntensity = 2.0;
						mat.depthWrite = false;
					}
					const isBodyMaterial = !isGlass && (rm.diffuseFromSecondary || rm.anyFromSecondary || !rm.diffuse);
					if (paintColor && isBodyMaterial) {
						mat.color.setRGB(paintColor.r, paintColor.g, paintColor.b);
						mat.metalness = 0.6;
						mat.roughness = 0.25;
						mat.envMapIntensity = 1.2;
					} else if (isBodyMaterial) {
						mat.color.setRGB(0.18, 0.18, 0.20);
						mat.metalness = 0.5;
						mat.roughness = 0.3;
						mat.envMapIntensity = 1.5;
					}
				}

				if (rm.specular) {
					const tex = makeDataTexture(rm.specular, rm.samplerState, false);
					mat.metalnessMap = tex;
				}
				if (rm.emissive) {
					const tex = makeDataTexture(rm.emissive, rm.samplerState);
					mat.emissiveMap = tex;
					mat.emissive.setRGB(1, 1, 1);
					mat.emissiveIntensity = 2.0;
				}
				if (rm.ao) {
					const tex = makeDataTexture(rm.ao, rm.samplerState, false);
					mat.aoMap = tex;
					mat.aoMapIntensity = 1.0;
				}

				map.set(key, mat);
			}
		}
		return map;
	}, [renderables, wireframe, paintColor]);

	useEffect(() => () => {
		baseMaterial.dispose();
		hoverMaterial.dispose();
		selectedMaterial.dispose();
		for (const mat of texturedMaterials.values()) {
			mat.map?.dispose();
			mat.normalMap?.dispose();
			mat.roughnessMap?.dispose();
			mat.dispose();
		}
	}, [baseMaterial, hoverMaterial, selectedMaterial, texturedMaterials]);

	// Translated-shader materials. Keyed by materialAssemblyId so shared
	// materials produce one ShaderMaterial reused across every mesh that
	// references them. Each entry caches `{ shader translation, material
	// binding, ShaderMaterial }` so swapping the toggle off then on again
	// doesn't re-translate every shader.
	const translatedMaterialMap = useMemo(() => {
		const out = new Map<string, TranslatedMaterial | null>();
		if (!translatedSetup) return out;
		const { sources, textureCatalog, materialIndex } = translatedSetup;
		// First, find the Material → Shader id for each materialAssemblyId
		// we've actually seen on a mesh. Walk all sources for the matching
		// Material resource and read its shaderImport.id.
		const matIdToShaderId = new Map<string, bigint>();
		for (const r of renderables) {
			for (const m of r.meshes) {
				if (!m.materialAssemblyId) continue;
				const key = m.materialAssemblyId.toString(16);
				if (matIdToShaderId.has(key)) continue;
				// Search loaded sources for the Material with this id and
				// read its shaderImport.
				outer: for (const s of sources) {
					for (const res of s.bundle.resources) {
						if (res.resourceTypeId !== 0x01) continue;
						if (u64ToBigInt(res.resourceId) !== m.materialAssemblyId) continue;
						try {
							const blocks = getResourceBlocks(s.arrayBuffer, s.bundle, res as ResourceEntry);
							const block0 = blocks[0];
							if (!block0) break outer;
							const parsedMat = parseMaterialData(block0);
							matIdToShaderId.set(key, parsedMat.shaderImport.id);
						} catch { /* fall through */ }
						break outer;
					}
				}
			}
		}
		// For each unique material, build a ShaderMaterial by translating
		// its target shader and pulling per-register bindings from the
		// material index.
		for (const [matKey, shaderId] of matIdToShaderId) {
			const translated = translateShaderById(shaderId, sources);
			if (!translated) {
				out.set(matKey, null);
				continue;
			}
			const shaderIdHex = shaderId.toString(16).padStart(16, '0');
			// Find the Material whose id matches this MESH's materialAssemblyId,
			// not just any material targeting the shader. Multiple body parts
			// share the same shader (PaintGloss) but each has its own Material
			// pointing at its own per-part Skin / AO / Scratch textures —
			// picking one arbitrarily smears the same texture across every
			// part. The hex-comparison normalises both sides because matKey
			// drops leading zeros (toString(16)) while materialId keeps them.
			const matKeyNorm = matKey.padStart(16, '0');
			const matBinding = materialIndex.get(shaderIdHex)?.find((b) => b.materialId === matKeyNorm)
				?? pickBestMaterial(shaderIdHex, [], materialIndex);
			const layout = inferCbLayoutForRV(translated.vs.source, translated.vs.parsed);
			const sm = buildTranslatedShaderMaterial({
				vsSource: translated.vs.source,
				psSource: translated.ps.source,
				vsParsed: translated.vs.parsed,
				psParsed: translated.ps.parsed,
				shaderName: translated.shaderName,
				shaderConstants: translated.constants,
				layout,
				materialBinding: matBinding ?? null,
				textureCatalog,
				heuristicDefaults: TRANSLATED_HEURISTIC_DEFAULTS,
				pickFallbackTexture: pickRenderableFallback,
				decodedToDataTexture: decodedToDataTextureRV,
				applyPreviewTonemap: true,  // vehicle shaders run HDR; without an engine tonemap, paint-gloss saturates to white
				side: THREE.DoubleSide,
			});
			out.set(matKey, sm);
		}
		return out;
	}, [translatedSetup, renderables]);

	useEffect(() => () => {
		for (const mat of translatedMaterialMap.values()) {
			if (!mat) continue;
			mat.dispose();
		}
	}, [translatedMaterialMap]);

	const matrices = useMemo(() => {
		const out: (THREE.Matrix4 | null)[][] = [];
		for (const r of renderables) {
			const partMatrix = r.partLocator ? locatorToMatrix4(r.partLocator) : null;
			const row: (THREE.Matrix4 | null)[] = [];
			for (const _m of r.meshes) {
				row.push(partMatrix);
			}
			out.push(row);
		}
		return out;
	}, [renderables]);

	return (
		<>
			{renderables.map((r, ri) =>
				r.meshes.map((m: DecodedMesh, mi: number) => {
					const mat = matrices[ri]?.[mi] ?? null;
					const isSelected = selected !== null && selected.ri === ri && selected.mi === mi;
					const isHovered = hovered !== null && hovered.ri === ri && hovered.mi === mi;
					const matKey = m.materialAssemblyId?.toString(16);
					// Translated path wins when the toggle's on AND we built
					// a ShaderMaterial for this material's shader. Falls back
					// to the PBR-approximation MeshStandardMaterial otherwise
					// so the toggle is non-destructive.
					const translatedMat = useTranslatedShaders && matKey
						? translatedMaterialMap.get(matKey) ?? null
						: null;
					const texturedMat = !translatedMat && matKey
						? texturedMaterials.get(matKey) ?? null
						: null;
					const meshMaterial = isSelected ? selectedMaterial
						: isHovered ? hoverMaterial
						: (translatedMat ?? texturedMat ?? baseMaterial);
					return (
						<mesh
							key={`${r.resourceId.toString(16)}-${mi}`}
							geometry={m.geometry}
							material={meshMaterial}
							matrixAutoUpdate={mat === null}
							matrix={mat ?? undefined}
							onBeforeRender={function (
								this: THREE.Mesh,
								_r: THREE.WebGLRenderer, _s: THREE.Scene,
								camera: THREE.Camera, _g: THREE.BufferGeometry,
								material: THREE.Material, _group: THREE.Group,
							) {
								// Three.js invokes `mesh.onBeforeRender.call(mesh, ...)`
								// so `this` is the mesh being drawn. Earlier this code
								// fetched the mesh via `material.userData.__mesh` set
								// in a ref callback, but ShaderMaterials are shared
								// across all meshes that use the same material — the
								// userData stash got overwritten by whichever mesh
								// mounted last, so every LOD/part received the SAME
								// matrixWorld and renderables piled up on top of each
								// other instead of each landing at its own
								// partLocator. Using `this` per-call gives the correct
								// world matrix for every draw.
								const upd = (material as TranslatedMaterial).__updateCb0;
								if (upd) {
									// DEBUG: verify `this` is the mesh — should log
									// the mesh's id and its own matrixWorld diagonal
									// (different per mesh).
									const w = (this as THREE.Object3D)?.matrixWorld?.elements;
									if (w) console.log('onBeforeRender mesh id=', (this as THREE.Object3D).id, 'mw[12,13,14]=', w[12].toFixed(2), w[13].toFixed(2), w[14].toFixed(2));
									upd(camera, this);
								}
								void _r; void _s; void _g; void _group;
							}}
							onClick={(e) => {
								e.stopPropagation();
								onSelect({ ri, mi });
							}}
							onPointerOver={(e) => {
								e.stopPropagation();
								onHover({ ri, mi });
								document.body.style.cursor = 'pointer';
							}}
							onPointerOut={(e) => {
								e.stopPropagation();
								onHover(null);
								document.body.style.cursor = 'auto';
							}}
						/>
					);
				}),
			)}
		</>
	);
}

// =============================================================================
// Component
// =============================================================================

export function RenderableViewport() {
	const activeBundle = useActiveBundle();
	const loadedBundle = activeBundle?.parsed ?? null;
	const originalArrayBuffer = activeBundle?.originalArrayBuffer ?? null;
	const decoded = useRenderableDecoded();
	const { selectPath, selectedPath } = useSchemaEditor();

	// Local interaction state. Notably absent: a `selected` useState — the
	// highlighted mesh is DERIVED from the schema editor's selectedPath
	// below, so there's only one source of truth and no effect-based sync
	// to ping-pong against.
	const [wireframe, setWireframe] = useState(false);
	const [useTranslatedShaders, setUseTranslatedShaders] = useState(false);
	const [paintColor, setPaintColor] = useState<{ r: number; g: number; b: number; pearl?: { r: number; g: number; b: number } } | null>(null);
	const [activePalette, setActivePalette] = useState(0);
	const [hovered, setHovered] = useState<{ ri: number; mi: number } | null>(null);

	const carColours: PlayerCarColours | null = useMemo(() => {
		const PLAYER_CAR_COLOURS_TYPE = 0x1001E;
		const tryParse = (buf: ArrayBuffer, bun: ParsedBundle): PlayerCarColours | null => {
			const res = bun.resources.find(r => r.resourceTypeId === PLAYER_CAR_COLOURS_TYPE);
			if (!res) return null;
			try {
				const raw = extractResourceRaw(buf, bun, res);
				return parsePlayerCarColoursData(raw);
			} catch { return null; }
		};
		if (loadedBundle && originalArrayBuffer) {
			const result = tryParse(originalArrayBuffer, loadedBundle);
			if (result) return result;
		}
		if (decoded) {
			for (const src of decoded.textureBundles) {
				const result = tryParse(src.buffer, src.bundle);
				if (result) return result;
			}
		}
		return null;
	}, [loadedBundle, originalArrayBuffer, decoded]);

	// Clear hover when the decoded set changes (different mode / LOD).
	useEffect(() => {
		setHovered(null);
	}, [decoded?.decoded]);

	// Selection is a pure function of (schema path, decoded index map).
	// Clicking in 3D writes the schema path; clicking in the tree writes
	// the schema path; both produce the same derivation here. There's no
	// separate state to keep in sync, so the old forward+reverse sync
	// effects are gone.
	const selected = useMemo<{ ri: number; mi: number } | null>(() => {
		if (!decoded) return null;
		if (selectedPath[0] !== 'renderables' || typeof selectedPath[1] !== 'number') return null;
		const wi = selectedPath[1] as number;
		const di = decoded.wrappedToDecodedIndex[wi];
		if (di == null) return null;
		if (selectedPath[2] !== 'meshes' || typeof selectedPath[3] !== 'number') {
			// Renderable-level selection (tree click on a ParsedRenderable
			// row). Don't highlight a specific mesh — it would force the
			// path to jump to meshes[0], visually shifting the tree row
			// mid-click. Leave the 3D highlight off at this level.
			return null;
		}
		const mi = selectedPath[3] as number;
		return { ri: di, mi };
	}, [decoded, selectedPath]);

	// Click in 3D → dispatch the schema path. The single write causes a
	// re-render, re-derives `selected`, and updates the visual highlight.
	const handleSelect = useCallback((sel: { ri: number; mi: number } | null) => {
		if (!decoded) return;
		if (sel === null) {
			selectPath([]);
			return;
		}
		const wi = decoded.decodedToWrappedIndex.get(sel.ri);
		if (wi == null) return;
		selectPath(['renderables', wi, 'meshes', sel.mi]);
	}, [decoded, selectPath]);

	const sceneBounds = useMemo(() => {
		if (!decoded?.decoded) return null;
		return computeSceneBounds(decoded.decoded.renderables);
	}, [decoded?.decoded]);

	if (!loadedBundle || !originalArrayBuffer) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground">
				Load a bundle to view Renderable geometry.
			</div>
		);
	}

	if (!decoded) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground">
				Renderable decoded context missing. Wrap the page in RenderableDecodedProvider.
			</div>
		);
	}

	const renderableCount = loadedBundle.resources.filter((r) => r.resourceTypeId === RENDERABLE_TYPE_ID).length;
	if (renderableCount === 0) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground">
				This bundle has no Renderable (0xC) resources.
			</div>
		);
	}

	const center = sceneBounds ? sceneBounds.center : new THREE.Vector3();
	const radius = sceneBounds ? sceneBounds.radius : 1;
	const camDistance = Math.max(radius * 2.2, 1.5);

	return (
		<div className="h-full flex flex-col min-h-0">
			{/* Controls header */}
			<div className="shrink-0 px-3 py-2 border-b space-y-2">
				<div className="flex flex-row items-center justify-between">
					<span className="text-sm font-medium">3D Preview</span>
					<span className="text-xs text-muted-foreground">
						{decoded.decoded
							? `${decoded.decoded.renderables.length} renderables, ${decoded.decoded.totalMeshes} meshes${decoded.decoded.failed > 0 ? `, ${decoded.decoded.failed} failed` : ''}`
							: 'decoding…'}
					</span>
				</div>
				<div className="flex flex-row flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<span className="font-medium">source:</span>
					<Button
						variant={decoded.decodeMode === 'graphics' ? 'default' : 'outline'}
						size="sm"
						onClick={() => decoded.setDecodeMode('graphics')}
						title="Drive decode through GraphicsSpec → Model → Renderable; attaches part locators"
					>
						GraphicsSpec
					</Button>
					<Button
						variant={decoded.decodeMode === 'all' ? 'default' : 'outline'}
						size="sm"
						onClick={() => decoded.setDecodeMode('all')}
						title="Decode every Renderable in the bundle, no part transforms"
					>
						all renderables
					</Button>
					<span className="font-medium ml-2">lod:</span>
					<Button
						variant={decoded.includeNonLOD0 ? 'default' : 'outline'}
						size="sm"
						onClick={() => decoded.setIncludeNonLOD0(!decoded.includeNonLOD0)}
					>
						{decoded.includeNonLOD0 ? 'all LODs' : 'LOD0 only'}
					</Button>
					<span className="font-medium ml-2">display:</span>
					<Button
						variant={wireframe ? 'default' : 'outline'}
						size="sm"
						onClick={() => setWireframe(w => !w)}
						title="Toggle wireframe rendering"
					>
						wireframe
					</Button>
					<Button
						variant={useTranslatedShaders ? 'default' : 'outline'}
						size="sm"
						onClick={() => setUseTranslatedShaders(v => !v)}
						title="Use real DXBC-translated shaders instead of PBR approximations. Requires SHADERS.BNDL + texture bundles to be loaded as companions."
					>
						translated shaders
					</Button>
					<span className="font-medium ml-2">textures:</span>
					<Button
						variant="outline"
						size="sm"
						onClick={() => { void decoded.loadTexturePack(); }}
						title="Load a secondary bundle containing textures (e.g. VEHICLETEX.BIN)"
					>
						+ texture pack
					</Button>
					{decoded.textureBundleNames.length > 0 && (
						<span className="text-xs text-muted-foreground">
							{decoded.textureBundleNames.join(', ')}
						</span>
					)}
				</div>
				<VehicleColorPicker
					carColours={carColours}
					activePalette={activePalette}
					setActivePalette={setActivePalette}
					paintColor={paintColor}
					onSelectColor={setPaintColor}
				/>
			</div>

			{/* 3D canvas — fills remaining space */}
			<div className="flex-1 min-h-0" style={{ background: '#1a1d23' }}>
				<Canvas
					camera={{
						position: [center.x + camDistance, center.y + camDistance * 0.5, center.z + camDistance],
						fov: 45,
						near: 0.01,
						far: Math.max(camDistance * 20, 100),
					}}
					gl={{ antialias: true }}
					onPointerMissed={() => handleSelect(null)}
				>
					<color attach="background" args={['#1a1d23']} />
					<SceneEnvironment />
					<ambientLight intensity={0.5} />
					<hemisphereLight args={['#b1c8e8', '#4a3f2f', 0.4]} />
					<directionalLight position={[10, 10, 5]} intensity={1.2} />
					<directionalLight position={[-8, 5, -10]} intensity={0.6} />
					<directionalLight position={[0, -5, 8]} intensity={0.3} />
					<Grid
						position={[center.x, center.y - radius, center.z]}
						args={[Math.max(radius * 4, 4), Math.max(radius * 4, 4)]}
						cellSize={0.5}
						cellThickness={0.5}
						sectionSize={2}
						sectionThickness={1}
						fadeDistance={camDistance * 4}
						infiniteGrid
					/>
					<Suspense fallback={null}>
						{decoded.decoded && (
							<RenderableMeshes
								renderables={decoded.decoded.renderables}
								wireframe={wireframe}
								paintColor={paintColor}
								selected={selected}
								hovered={hovered}
								onSelect={handleSelect}
								onHover={setHovered}
								useTranslatedShaders={useTranslatedShaders}
							/>
						)}
					</Suspense>
					<OrbitControls
						target={[center.x, center.y, center.z]}
						enableDamping
						dampingFactor={0.1}
						makeDefault
					/>
				</Canvas>
			</div>

			{/* Status footer */}
			{decoded.decoded && decoded.decoded.failed > 0 && (
				<div className="shrink-0 px-3 py-1 text-xs text-destructive border-t">
					{decoded.decoded.failed} renderable(s) failed to decode. See console for details.
				</div>
			)}
		</div>
	);
}

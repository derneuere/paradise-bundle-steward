// Workspace viewport for the Shader resource (type 0x32).
//
// Translates the selected shader's DXBC program pairs to GLSL and renders the
// active technique on a test sphere — the same translated-shader pipeline the
// RenderableViewport uses for vehicle paint, but on a neutral mesh. Built on
// the shared rendering helpers (translateDxbc / buildTranslatedShaderMaterial /
// inferCbLayout), so it inherits the engine-matrix, skinning-palette and
// sampler-binding behaviour without duplicating it.
//
// Self-contained: resolves the selected Shader + its Shader-Program-Buffer
// imports from the workspace, so ViewportPane can mount it directly (it is not
// a WorldViewport overlay).

import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
	SHADER_TYPE_ID,
	SHADER_PROGRAM_BUFFER_TYPE_ID,
	type ParsedShader,
} from '@/lib/core/shader';
import { getImportIds } from '@/lib/core/bundle';
import { getResourceBlocks } from '@/lib/core/resourceManager';
import { translateDxbc, type TranslatedShader } from '@/lib/core/dxbc';
import { u64ToBigInt } from '@/lib/core/u64';
import { formatResourceId } from '@/lib/core/bundle';
import { buildTextureCatalog } from '@/lib/core/textureCatalog';
import { buildMaterialIndex, pickBestMaterial, type MaterialBinding } from '@/lib/core/materialBinding';
import { buildTranslatedShaderMaterial } from '@/lib/core/translatedShaderMaterial';
import { ENGINE_CONSTANT_DEFAULTS, inferCbLayout } from '@/lib/core/shaderEngineConstants';
import type { DecodedTexture } from '@/lib/core/texture';
import type { ParsedBundle } from '@/lib/core/types';

// ---------------------------------------------------------------------------
// Fallback textures (samplers with no catalog match — same intent as the
// ShaderPage preview, trimmed to the cases the workspace needs).
// ---------------------------------------------------------------------------

function make1x1(r: number, g: number, b: number, a: number): THREE.DataTexture {
	const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
	t.needsUpdate = true;
	return t;
}
function pickFallbackTexture(samplerName: string): THREE.DataTexture {
	// Shadow / depth samplers read "lit" from white; everything else gets a
	// magenta marker so a missing texture is obvious rather than silently black.
	if (/shadow|depth/i.test(samplerName)) return make1x1(255, 255, 255, 255);
	return make1x1(255, 64, 200, 255);
}
function decodedToDataTexture(dt: DecodedTexture): THREE.DataTexture {
	const tex = new THREE.DataTexture(dt.pixels, dt.header.width, dt.header.height, THREE.RGBAFormat);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.flipY = false;
	tex.needsUpdate = true;
	return tex;
}

// ---------------------------------------------------------------------------
// Technique resolution
// ---------------------------------------------------------------------------

type LinkedTechnique = {
	vs: TranslatedShader | null;
	ps: TranslatedShader | null;
};

/** Resolve a shader's Shader-Program-Buffer imports and translate them into
 *  per-technique {vs, ps} GLSL pairs. Mirrors the ShaderPage preview's pairing:
 *  programs come in {vertex, pixel} order; swap when the DXBC program types say
 *  otherwise. */
function linkTechniques(
	parsed: ParsedBundle,
	originalArrayBuffer: ArrayBuffer,
	model: ParsedShader,
	bundleResourceIndex: number,
): LinkedTechnique[] {
	const importIds = getImportIds(parsed.imports, parsed.resources, bundleResourceIndex);
	const translated = importIds.map((id) => {
		const target = parsed.resources.find(
			(r) => u64ToBigInt(r.resourceId) === id && r.resourceTypeId === SHADER_PROGRAM_BUFFER_TYPE_ID,
		);
		if (!target) return null;
		const block = getResourceBlocks(originalArrayBuffer, parsed, target)[1];
		if (!block) return null;
		try { return translateDxbc(block); } catch { return null; }
	});

	const out: LinkedTechnique[] = [];
	for (let t = 0; t < model.numTechniques; t++) {
		let vs = translated[2 * t] ?? null;
		let ps = translated[2 * t + 1] ?? null;
		if (vs?.parsed.programType === 'pixel' && ps?.parsed.programType === 'vertex') {
			[vs, ps] = [ps, vs];
		}
		out.push({ vs, ps });
	}
	return out;
}

// ---------------------------------------------------------------------------
// Preview mesh
// ---------------------------------------------------------------------------

function ShaderPreviewMesh({
	tech,
	shader,
	textureCatalog,
	materialBinding,
}: {
	tech: LinkedTechnique;
	shader: ParsedShader;
	textureCatalog: ReturnType<typeof buildTextureCatalog>;
	materialBinding: MaterialBinding | null;
}) {
	const meshRef = useRef<THREE.Mesh>(null);

	const material = useMemo(() => {
		const vs = tech.vs?.source;
		const ps = tech.ps?.source;
		if (!vs || !ps) {
			return new THREE.ShaderMaterial({
				vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
				fragmentShader: 'void main(){ gl_FragColor = vec4(0.5,0.5,0.55,1.0); }',
			});
		}
		return buildTranslatedShaderMaterial({
			vsSource: vs,
			psSource: ps,
			vsParsed: tech.vs?.parsed,
			psParsed: tech.ps?.parsed,
			shaderName: shader.name,
			shaderConstants: shader.constants,
			layout: inferCbLayout(vs, tech.vs?.parsed),
			materialBinding,
			textureCatalog,
			heuristicDefaults: ENGINE_CONSTANT_DEFAULTS,
			pickFallbackTexture,
			decodedToDataTexture: (entry) => {
				try { return decodedToDataTexture(entry.decode()); } catch { return null; }
			},
			applyPreviewTonemap: true,
		});
	}, [tech, shader, textureCatalog, materialBinding]);

	useFrame(() => {
		if (meshRef.current) meshRef.current.rotation.y += 0.005;
	});

	return (
		<mesh
			ref={meshRef}
			frustumCulled={false}
			onBeforeRender={(_r, _s, camera, _g, mat) => {
				const upd = (mat as THREE.Material & { __updateCb0?: (c: THREE.Camera, o: THREE.Object3D) => void }).__updateCb0;
				if (upd && meshRef.current) upd(camera, meshRef.current);
			}}
		>
			<sphereGeometry args={[1, 64, 48]} />
			<primitive object={material} attach="material" />
		</mesh>
	);
}

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

export function ShaderViewport() {
	const { bundles, selection } = useWorkspace();
	const [activeTech, setActiveTech] = useState(0);

	const bundle = useMemo(
		() => (selection ? bundles.find((b) => b.id === selection.bundleId) ?? null : null),
		[bundles, selection],
	);
	const model = useMemo(() => {
		if (!bundle || selection?.index == null) return null;
		return (bundle.parsedResourcesAll.get('shader')?.[selection.index] as ParsedShader | null) ?? null;
	}, [bundle, selection]);

	// Bundle-wide resource index of the selected shader (shader-list index →
	// position in parsed.resources), needed to resolve its imports.
	const bundleResourceIndex = useMemo(() => {
		if (!bundle || selection?.index == null) return -1;
		let count = 0;
		for (let i = 0; i < bundle.parsed.resources.length; i++) {
			if (bundle.parsed.resources[i].resourceTypeId === SHADER_TYPE_ID) {
				if (count === selection.index) return i;
				count++;
			}
		}
		return -1;
	}, [bundle, selection]);

	const sources = useMemo(
		() => (bundle ? [{ source: 'primary', bundle: bundle.parsed, arrayBuffer: bundle.originalArrayBuffer, debug: bundle.debugResources }] : []),
		[bundle],
	);
	// TODO(types): buildTextureCatalog/buildMaterialIndex take a loosely-typed
	// source list shared with ShaderPage; cast until that shape is exported.
	const textureCatalog = useMemo(() => buildTextureCatalog(sources as never), [sources]);
	const materialIndex = useMemo(() => buildMaterialIndex(sources as never, textureCatalog), [sources, textureCatalog]);

	const linked = useMemo(() => {
		if (!bundle || !model || bundleResourceIndex < 0) return [];
		return linkTechniques(bundle.parsed, bundle.originalArrayBuffer, model, bundleResourceIndex);
	}, [bundle, model, bundleResourceIndex]);

	const materialBinding = useMemo<MaterialBinding | null>(() => {
		if (!bundle || bundleResourceIndex < 0) return null;
		const r = bundle.parsed.resources[bundleResourceIndex];
		if (!r) return null;
		const shaderId = formatResourceId(u64ToBigInt(r.resourceId));
		// Prefer the material whose sampler set best matches the active technique.
		const src = (linked[activeTech]?.ps?.source ?? '') + (linked[activeTech]?.vs?.source ?? '');
		const regs = new Set<number>();
		for (const m of src.matchAll(/uniform sampler2D [A-Za-z0-9_]+;\s*\/\/\s*t(\d+)/g)) regs.add(Number(m[1]));
		return pickBestMaterial(shaderId, [...regs], materialIndex);
	}, [bundle, bundleResourceIndex, materialIndex, linked, activeTech]);

	if (!model) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
				This shader instance couldn't be parsed — no preview to show.
			</div>
		);
	}

	const tech = linked[activeTech] ?? null;

	return (
		<div className="h-full min-h-0 flex flex-col">
			{model.numTechniques > 1 && (
				<div className="shrink-0 flex items-center gap-1 p-1 border-b text-xs overflow-x-auto">
					<span className="text-muted-foreground mr-1">Technique:</span>
					{Array.from({ length: model.numTechniques }, (_, i) => (
						<button
							key={i}
							onClick={() => setActiveTech(i)}
							className={`px-2 py-0.5 rounded border ${i === activeTech ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
						>
							{model.techniques[i]?.name || `#${i}`}
						</button>
					))}
				</div>
			)}
			<div className="flex-1 min-h-0">
				<Canvas camera={{ position: [0, 0, 3], fov: 40 }} dpr={[1, 2]} style={{ background: 'hsl(var(--muted))' }}>
					<ambientLight intensity={0.6} />
					<directionalLight position={[3, 4, 5]} intensity={1.0} />
					{tech && <ShaderPreviewMesh tech={tech} shader={model} textureCatalog={textureCatalog} materialBinding={materialBinding} />}
					<OrbitControls enablePan={false} enableDamping dampingFactor={0.1} />
				</Canvas>
			</div>
		</div>
	);
}

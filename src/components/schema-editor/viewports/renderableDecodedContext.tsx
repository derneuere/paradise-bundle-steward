// Shared decode state for the Renderable schema editor.
//
// Before this provider existed, the viewport owned the entire 3D-decode
// pipeline: parseRenderable → resolve imports → decode vertex arrays →
// resolve material textures → produce a DecodedRenderable[]. That was fine
// for a pure-viewport page, but the schema editor needs to expose the same
// data to:
//
//   1. The hierarchy tree — the tree only lists the currently-decoded
//      renderables so tree order matches 3D order.
//   2. The inspector's "Materials & Textures" extension — the card shows
//      texture thumbs + shader info + OBB matrix for the selected mesh,
//      which all come from the decoded data, not from the raw parser.
//   3. The viewport itself — still the primary consumer.
//
// Lifting the decode pass to this provider means all three consumers see
// the same set of renderables under the same decode-mode + LOD filter, and
// the tree automatically reshuffles when the user toggles GraphicsSpec /
// all / LOD0 / all LODs.
//
// The provider also owns the "slow UI state" that influences decoding
// (decode mode, LOD filter, loaded texture packs, shader name map).
// "Fast" viewport state (wireframe, paint color, selection highlight)
// stays local to the viewport.

import React, { createContext, useContext, useMemo, useState } from 'react';
import { useLoadShaderNameMap } from '@/hooks/useLoadShaderNameMap';
import { useWorkspace } from '@/context/WorkspaceContext';
import { type ParsedRenderable } from '@/lib/core/renderable';
import {
	decodeAllRenderables,
	computeSceneBounds,
	locatorToMatrix4,
	type DecodedMesh,
	type DecodedRenderable,
	type DecodeMode,
} from '@/lib/core/renderableDecode';
import type { TextureSourceBundle, ShaderNameMap } from '@/lib/core/materialChain';

// Re-exported so existing consumers (RenderableViewport, renderableExtensions)
// keep importing decode types + helpers from the context they already use.
export { computeSceneBounds, locatorToMatrix4 };
export type { DecodedMesh, DecodedRenderable, DecodeMode };


// =============================================================================
// React provider
// =============================================================================

export type RenderableDecodedValue = {
	/** Full decoded result from the current decode pass. Null until the
	 *  bundle is loaded and the first memo runs. */
	decoded: { renderables: DecodedRenderable[]; totalMeshes: number; failed: number } | null;
	/** ParsedRenderable[] aligned with `filteredWrappedIndex` — what the
	 *  schema editor's tree walks. Every entry is guaranteed to be a
	 *  successfully-parsed ParsedRenderable (failed parses are skipped). */
	filteredParsed: ParsedRenderable[];
	/** Parallel to `filteredParsed`. Debug-resolved names (e.g.
	 *  `P_CA_Sportscar_Body_Bonnet_LOD0`) for each wrapped entry. Null when
	 *  the RST didn't know the resource. */
	filteredDebugNames: (string | null)[];
	/** Parallel to `filteredParsed`. Pre-computed triangle count for label
	 *  callbacks that don't have React context access. */
	filteredTriCounts: number[];
	/** wrappedIndex → DecodedRenderable. Extensions use this to look up the
	 *  card data for the currently-selected renderable. */
	byWrappedIndex: Map<number, DecodedRenderable>;
	/** wrappedIndex → the corresponding index into `decoded.renderables`. The
	 *  viewport uses this to highlight the mesh referenced by the schema
	 *  editor's selectedPath. */
	wrappedToDecodedIndex: number[];
	/** decodedIndex → wrappedIndex. The viewport's click handler uses this
	 *  to translate a clicked mesh back into the schema editor's path space. */
	decodedToWrappedIndex: Map<number, number>;

	// UI state that influences decoding.
	decodeMode: DecodeMode;
	setDecodeMode: (m: DecodeMode) => void;
	includeNonLOD0: boolean;
	setIncludeNonLOD0: (b: boolean) => void;
	/** Every OTHER loaded workspace bundle, as texture/shader sources. Textures
	 *  and shaders resolve from whatever bundles are loaded in the workspace —
	 *  no separate "texture pack" step. */
	textureBundles: TextureSourceBundle[];
	/** Display names of the bundles contributing textures/shaders. */
	textureBundleNames: string[];
	shaderNameMap: ShaderNameMap | null;
};

const RenderableDecodedContext = createContext<RenderableDecodedValue | null>(null);

export function useRenderableDecoded(): RenderableDecodedValue | null {
	return useContext(RenderableDecodedContext);
}

export function RenderableDecodedProvider({ children }: { children: React.ReactNode }) {
	// Idempotent: when a parent already provides the decoded context (the
	// legacy RenderablePage wraps the whole page in one), pass through so the
	// ~100-renderable decode pass doesn't run twice. The workspace mounts this
	// provider in ViewportPane where there's no parent, so it decodes there.
	const parent = useContext(RenderableDecodedContext);
	if (parent) return <>{children}</>;
	return <RenderableDecodedProviderInner>{children}</RenderableDecodedProviderInner>;
}

function RenderableDecodedProviderInner({ children }: { children: React.ReactNode }) {
	const { bundles, selection } = useWorkspace();
	const [decodeMode, setDecodeMode] = useState<DecodeMode>('graphics');
	const [includeNonLOD0, setIncludeNonLOD0] = useState(false);
	const [shaderNameMap, setShaderNameMap] = useState<ShaderNameMap | null>(null);

	// Auto-load SHADERS.BNDL from the example directory at mount; every
	// consumer sees the resulting shader name map.
	useLoadShaderNameMap(setShaderNameMap);

	// Decode the renderables of the SELECTED bundle (the one the user is
	// inspecting), falling back to the first loaded bundle. Textures + shaders
	// come from EVERY loaded workspace bundle — load the vehicle GR bundle, its
	// texture bundle and SHADERS.BNDL into the workspace and they all resolve
	// automatically; there's no separate "texture pack" step.
	const renderableBundle = useMemo(() => {
		const sel = selection?.bundleId ? bundles.find((b) => b.id === selection.bundleId) : null;
		return sel ?? bundles[0] ?? null;
	}, [bundles, selection]);

	const loadedBundle = renderableBundle?.parsed ?? null;
	const originalArrayBuffer = renderableBundle?.originalArrayBuffer ?? null;
	const debugResources = renderableBundle?.debugResources ?? [];

	// Every OTHER loaded bundle is a texture/shader source for the material
	// chain (cross-bundle texture resolution — a vehicle's pixels live in its
	// companion texture bundle, its shaders in SHADERS.BNDL).
	const textureBundles = useMemo<TextureSourceBundle[]>(
		() => bundles
			.filter((b) => b !== renderableBundle)
			.map((b) => ({ buffer: b.originalArrayBuffer, bundle: b.parsed })),
		[bundles, renderableBundle],
	);
	const textureBundleNames = useMemo(
		() => bundles.filter((b) => b !== renderableBundle).map((b) => b.id),
		[bundles, renderableBundle],
	);

	const debugNames = useMemo(() => {
		const norm = (s: string) => s.toLowerCase().replace(/^0x/, '').replace(/^0+(?=.)/, '');
		const m = new Map<string, string>();
		for (const d of debugResources) {
			if (d.id && d.name) m.set(norm(d.id), d.name);
		}
		return m;
	}, [debugResources]);

	// Decoding the whole bundle's renderables is expensive; only run it while a
	// renderable is actually being viewed.
	const active = selection?.resourceKey === 'renderable';

	const decoded = useMemo(() => {
		if (!active || !loadedBundle || !originalArrayBuffer) return null;
		const result = decodeAllRenderables(
			originalArrayBuffer,
			loadedBundle,
			debugNames,
			includeNonLOD0,
			decodeMode,
			textureBundles,
			shaderNameMap,
		);
		// Debug helper — still handy for inspecting the decoded scene from
		// the devtools console while reproducing user reports.
		(window as unknown as Record<string, unknown>).__decoded = result;
		return result;
	}, [active, loadedBundle, originalArrayBuffer, debugNames, includeNonLOD0, decodeMode, textureBundles, shaderNameMap]);

	// Derive the ParsedRenderable array the schema editor walks. Failed
	// parses are dropped; everything else is kept in decode order so a click
	// in 3D lines up with the tree row.
	const {
		filteredParsed,
		filteredDebugNames,
		filteredTriCounts,
		byWrappedIndex,
		wrappedToDecodedIndex,
		decodedToWrappedIndex,
	} = useMemo(() => {
		if (!decoded) {
			return {
				filteredParsed: [] as ParsedRenderable[],
				filteredDebugNames: [] as (string | null)[],
				filteredTriCounts: [] as number[],
				byWrappedIndex: new Map<number, DecodedRenderable>(),
				wrappedToDecodedIndex: [] as number[],
				decodedToWrappedIndex: new Map<number, number>(),
			};
		}
		const parsed: ParsedRenderable[] = [];
		const names: (string | null)[] = [];
		const tris: number[] = [];
		const byWi = new Map<number, DecodedRenderable>();
		const wtoD: number[] = [];
		const dtoW = new Map<number, number>();
		let wi = 0;
		for (let di = 0; di < decoded.renderables.length; di++) {
			const dr = decoded.renderables[di];
			if (!dr.parsed) continue;
			parsed.push(dr.parsed);
			names.push(dr.debugName);
			// Tri count from the PARSED struct (not the decoded meshes), so the
			// count still reflects the raw mesh list even when some meshes
			// were filtered out of 3D rendering (numIndices === 0, etc.).
			let t = 0;
			for (const m of dr.parsed.meshes) {
				if (m.primitiveType === 4) t += Math.floor(m.numIndices / 3);
			}
			tris.push(t);
			byWi.set(wi, dr);
			wtoD.push(di);
			dtoW.set(di, wi);
			wi++;
		}
		return {
			filteredParsed: parsed,
			filteredDebugNames: names,
			filteredTriCounts: tris,
			byWrappedIndex: byWi,
			wrappedToDecodedIndex: wtoD,
			decodedToWrappedIndex: dtoW,
		};
	}, [decoded]);

	const value = useMemo<RenderableDecodedValue>(() => ({
		decoded,
		filteredParsed,
		filteredDebugNames,
		filteredTriCounts,
		byWrappedIndex,
		wrappedToDecodedIndex,
		decodedToWrappedIndex,
		decodeMode,
		setDecodeMode,
		includeNonLOD0,
		setIncludeNonLOD0,
		textureBundles,
		textureBundleNames,
		shaderNameMap,
	}), [
		decoded,
		filteredParsed,
		filteredDebugNames,
		filteredTriCounts,
		byWrappedIndex,
		wrappedToDecodedIndex,
		decodedToWrappedIndex,
		decodeMode,
		includeNonLOD0,
		textureBundles,
		textureBundleNames,
		shaderNameMap,
	]);

	return (
		<RenderableDecodedContext.Provider value={value}>
			{children}
		</RenderableDecodedContext.Provider>
	);
}

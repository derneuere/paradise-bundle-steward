// Workspace-aware decode source for the Texture 2D preview.
//
// The center-pane `TextureViewport` reads its decoded RGBA pixels from
// `TextureContext`. The legacy standalone TexturePage used to be the only
// provider of that context; once the page is gone the Workspace itself has
// to supply it. This provider mounts once at the Workspace root (next to
// `RenderableDecodedProvider`) and decodes the *currently-selected* texture
// from the *selected* bundle.
//
// It mirrors RenderableDecodedProvider's two load-bearing traits:
//   1. Idempotent — if a parent already provides TextureContext, pass through
//      so we never double-decode.
//   2. Cheap when inactive — decoding only runs while a texture is actually
//      selected (`selection.resourceKey === 'texture'`); every other
//      selection leaves the context value inert.

import React, { useContext, useMemo } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
	TEXTURE_TYPE_ID,
	decodeTexture,
	type ParsedTextureHeader,
} from '@/lib/core/texture';
import type { ParsedBundle, ResourceEntry } from '@/lib/core/types';
import {
	TextureContext,
	type TextureContextValue,
	type TextureDecodeResult,
} from './textureContext';

const TEXTURE_HANDLER_KEY = 'texture';

/** The bundle's texture-typed resource entries, in bundle order. Pure helper
 *  so the index→resource correlation can be unit-tested without React. The
 *  Nth entry here lines up with the Nth parsed `texture` instance in
 *  `parsedResourcesAll` (the parser walks `bundle.resources` in order). */
export function textureResourcesOf(bundle: ParsedBundle): ResourceEntry[] {
	return bundle.resources.filter((r) => r.resourceTypeId === TEXTURE_TYPE_ID);
}

export function TextureDecodedProvider({ children }: { children: React.ReactNode }) {
	// Idempotent: a parent already supplying TextureContext means the decode
	// pass is owned upstream — pass through. (No such parent exists today, but
	// keeping the guard matches RenderableDecodedProvider and is harmless.)
	const parent = useContext(TextureContext);
	if (parent) return <>{children}</>;
	return <TextureDecodedProviderInner>{children}</TextureDecodedProviderInner>;
}

function TextureDecodedProviderInner({ children }: { children: React.ReactNode }) {
	const { bundles, selection } = useWorkspace();

	// Decode against the selected bundle (the one being inspected), falling
	// back to the first loaded bundle so a Bundle/Resource-type-level selection
	// still resolves a sensible source.
	const textureBundle = useMemo(() => {
		const sel = selection?.bundleId ? bundles.find((b) => b.id === selection.bundleId) : null;
		return sel ?? bundles[0] ?? null;
	}, [bundles, selection]);

	const active = selection?.resourceKey === TEXTURE_HANDLER_KEY;
	const selectedIndex = active && selection?.index != null ? selection.index : -1;

	const headers = useMemo<(ParsedTextureHeader | null)[]>(() => {
		const list = textureBundle?.parsedResourcesAll.get(TEXTURE_HANDLER_KEY) ?? [];
		return list as (ParsedTextureHeader | null)[];
	}, [textureBundle]);

	// Decode the selected texture's pixel block. Keyed on (bundle, index) only
	// — header-field edits in the inspector don't touch pixels, so the preview
	// stays cached while the user fiddles.
	const decoded = useMemo<TextureDecodeResult>(() => {
		if (!active) return { status: 'error', error: 'No texture selected.' };
		const loadedBundle = textureBundle?.parsed ?? null;
		const buffer = textureBundle?.originalArrayBuffer ?? null;
		if (!loadedBundle || !buffer) {
			return { status: 'error', error: 'No bundle loaded.' };
		}
		const resource = textureResourcesOf(loadedBundle)[selectedIndex];
		if (!resource) {
			return { status: 'error', error: `No texture at index ${selectedIndex}.` };
		}
		try {
			const d = decodeTexture(buffer, loadedBundle, resource);
			return { status: 'ok', pixels: d.pixels, width: d.header.width, height: d.header.height };
		} catch (err) {
			return { status: 'error', error: err instanceof Error ? err.message : String(err) };
		}
	}, [active, textureBundle, selectedIndex]);

	const value = useMemo<TextureContextValue>(
		() => ({ headers, selectedIndex, decoded }),
		[headers, selectedIndex, decoded],
	);

	return <TextureContext.Provider value={value}>{children}</TextureContext.Provider>;
}

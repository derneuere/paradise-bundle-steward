// Shared state between TexturePage and TextureViewport.
//
// The schema editor holds only the currently-selected ParsedTextureHeader in
// its `data` prop. The 2D preview needs TWO extra things the schema model
// doesn't have:
//
//   1. Decoded RGBA pixel data for the active texture. Pixels live in the
//      resource's block 1 (Disposable memory); `decodeTexture` pulls them
//      out of the raw bundle buffer and runs the DXT/swizzle pass. Doing
//      that work inside the viewport would require re-deriving the correct
//      bundle + resource; it's simpler and faster for the page to decode
//      once per selection change and hand the result down.
//
//   2. Which resource index the page is currently editing, so the viewport
//      can label the preview and surface useful errors ("Texture #7 is DXT3,
//      unsupported").
//
// This mirrors the PolygonSoupListContext pattern: a tiny non-JSX file both
// the page and the viewport can import without dragging React component
// code into each other.

import { createContext, useContext } from 'react';
import type { ParsedTextureHeader } from '@/lib/core/texture';

// Result of decoding the selected texture's pixel block.
// `status: 'error'` covers parse failures, unsupported formats (DXT3),
// empty blocks, and anything else `decodeTexture` might throw.
//
// A string-based discriminant (`status`) is used instead of a boolean
// (`ok`) because steward's tsconfig runs with `strict: false`, and
// non-strict TypeScript doesn't reliably narrow discriminated unions on
// `true | false` literal types — the discriminant collapses back to
// `boolean` and narrowing silently disappears. Strings narrow cleanly in
// every mode.
export type TextureDecodeResult =
	| { status: 'ok'; pixels: Uint8Array; width: number; height: number }
	| { status: 'error'; error: string };

export type TextureContextValue = {
	/** Parsed header for every texture resource in the loaded bundle, in
	 *  resource-index order. Entries that failed to parse are `null` to keep
	 *  indexes aligned with `bundle.resources`. */
	headers: (ParsedTextureHeader | null)[];
	/** Resource index currently owned by the schema editor — matches the
	 *  `selectedIndex` state in TexturePage. */
	selectedIndex: number;
	/** Decoded pixel data for the selected texture, or an error describing
	 *  why it couldn't be decoded. */
	decoded: TextureDecodeResult;
};

export const TextureContext = createContext<TextureContextValue | null>(null);

export function useTextureContext(): TextureContextValue | null {
	return useContext(TextureContext);
}

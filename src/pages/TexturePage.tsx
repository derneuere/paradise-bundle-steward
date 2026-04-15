// Schema-driven editor for Texture resources (type 0x0).
//
// Bundles like VEH_CARBRWDS_GR.BIN hold hundreds of Texture resources — the
// old gallery page showed every one at once, but the schema editor is
// per-resource. This page follows the same pattern as PolygonSoupListPage:
//
//   - `getResources<ParsedTextureHeader>('texture')` lists every parsed
//     header in the loaded bundle, indexed in resource-order.
//   - A dropdown above the 3-pane SchemaEditor picks which one the editor
//     should open. The preview viewport re-decodes pixel data for the
//     selected texture on every selection change.
//   - TextureContext carries the decoded RGBA payload + the active index
//     into TextureViewport (the center pane), which is where the 2D
//     preview lives. The schema editor's left tree is minimal (single
//     record) and the inspector shows the header fields.
//
// Edits to the schema's header fields are kept in memory (setResourceAt),
// but the texture handler is read-only so they're silently dropped on
// export. Every field is marked readOnly in the schema to make that
// behavior visible in the UI — users see a rendered value rather than an
// editable input.

import { useCallback, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { useBundle } from '@/context/BundleContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { textureResourceSchema } from '@/lib/schema/resources/texture';
import {
	TEXTURE_TYPE_ID,
	decodeTexture,
	type ParsedTextureHeader,
} from '@/lib/core/texture';
import {
	TextureContext,
	type TextureContextValue,
	type TextureDecodeResult,
} from '@/components/schema-editor/viewports/textureContext';
import { u64ToBigInt } from '@/lib/core/u64';

// Build a dropdown label for one texture resource. Shows the bundle index,
// resource id (hex), dimensions, and format so the user can tell similar
// textures apart (`64x64 DXT1 · body base` vs `128x128 DXT5 · body normal`
// etc.). Only the header is available here — the pre-migration page surfaced
// the same fields in its grid metadata strip.
function textureLabel(
	header: ParsedTextureHeader | null,
	resourceIdHex: string,
	index: number,
): string {
	if (header == null) {
		return `#${index} · ${resourceIdHex} · parse failed`;
	}
	return `#${index} · ${resourceIdHex} · ${header.width}×${header.height} · ${header.format}`;
}

const TexturePage = () => {
	const { getResources, setResourceAt, loadedBundle, originalArrayBuffer } = useBundle();
	const headers = getResources<ParsedTextureHeader>('texture');

	// The resources the UI dropdown maps onto. `getResources('texture')`
	// gives us one model per resource in bundle order, but we also need the
	// ResourceEntry itself so `decodeTexture` can find block 1 (the pixel
	// block) on demand.
	const textureResources = useMemo(() => {
		if (!loadedBundle) return [];
		return loadedBundle.resources.filter((r) => r.resourceTypeId === TEXTURE_TYPE_ID);
	}, [loadedBundle]);

	// Pre-format the resource ids once — 16-char upper-hex strings match the
	// byResourceId keys used elsewhere in the codebase, which makes the
	// dropdown values stable across sessions even if bundle order changes.
	const resourceIdHex = useMemo(
		() =>
			textureResources.map((r) =>
				u64ToBigInt(r.resourceId).toString(16).toUpperCase().padStart(16, '0'),
			),
		[textureResources],
	);

	// Default to the first successfully-parsed texture so the inspector opens
	// on something renderable instead of a parse-error stub.
	const firstParsed = useMemo(() => {
		for (let i = 0; i < headers.length; i++) {
			if (headers[i] != null) return i;
		}
		return 0;
	}, [headers]);

	const [selectedIndex, setSelectedIndex] = useState<number>(firstParsed);

	const currentModel = headers[selectedIndex] ?? null;

	// Re-decode pixel data whenever the selection or source bundle changes.
	// Edits to header fields (via the schema editor) do NOT invalidate this
	// — we're intentionally keying on (bundle, resourceIndex), not on the
	// header object identity, so the preview doesn't flicker while the user
	// fiddles with width/height/etc. in the inspector.
	const decoded: TextureDecodeResult = useMemo(() => {
		if (!loadedBundle || !originalArrayBuffer) {
			return { status: 'error', error: 'No bundle loaded.' };
		}
		const resource = textureResources[selectedIndex];
		if (!resource) {
			return { status: 'error', error: `No texture at index ${selectedIndex}.` };
		}
		try {
			const d = decodeTexture(originalArrayBuffer, loadedBundle, resource);
			return {
				status: 'ok',
				pixels: d.pixels,
				width: d.header.width,
				height: d.header.height,
			};
		} catch (err) {
			return {
				status: 'error',
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}, [loadedBundle, originalArrayBuffer, textureResources, selectedIndex]);

	const handleChange = useCallback(
		(next: unknown) => setResourceAt('texture', selectedIndex, next),
		[setResourceAt, selectedIndex],
	);

	if (headers.length === 0 || !loadedBundle) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Texture</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle containing a Texture resource (type 0x0) to begin.
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!currentModel) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Texture</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Texture #{selectedIndex} failed to parse — pick a different one from
						the dropdown above.
					</div>
				</CardContent>
			</Card>
		);
	}

	const textureCtxValue: TextureContextValue = {
		headers,
		selectedIndex,
		decoded,
	};

	return (
		<div className="h-full min-h-0 flex flex-col gap-3">
			<div className="flex items-center gap-4 shrink-0">
				<div className="flex-1">
					<h2 className="text-lg font-semibold">Texture</h2>
					<p className="text-xs text-muted-foreground">
						{headers.length === 1
							? '1 texture in bundle · header is read-only'
							: `${headers.length} textures in bundle · headers are read-only`}
					</p>
				</div>
				{headers.length > 1 && (
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground">Texture</span>
						<Select
							value={String(selectedIndex)}
							onValueChange={(v) => setSelectedIndex(Number(v))}
						>
							<SelectTrigger className="h-8 w-96">
								<SelectValue />
							</SelectTrigger>
							<SelectContent className="max-h-[60vh]">
								{headers.map((h, i) => (
									<SelectItem key={i} value={String(i)}>
										{textureLabel(h, resourceIdHex[i] ?? '', i)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
			</div>
			<div className="flex-1 min-h-0">
				<TextureContext.Provider value={textureCtxValue}>
					<SchemaEditorProvider
						// Remount on selection change so initialPath is reset and any
						// editor-local state (expanded nodes, focused input) clears.
						key={`texture-${selectedIndex}`}
						resource={textureResourceSchema}
						data={currentModel}
						onChange={handleChange}
					>
						<SchemaEditor />
					</SchemaEditorProvider>
				</TextureContext.Provider>
			</div>
		</div>
	);
};

export default TexturePage;

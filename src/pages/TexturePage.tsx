// Texture viewer page.
//
// Lists all Texture resources (type 0x0) in the loaded bundle and renders
// each one as a decoded image preview. Uses decodeTexture() to extract the
// RGBA pixel data, then paints it onto an offscreen canvas to produce a
// data URL for display.

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { TEXTURE_TYPE_ID, decodeTexture, parseTextureHeader, type DecodedTexture, type ParsedTextureHeader } from '@/lib/core/texture';
import { getResourceBlocks } from '@/lib/core/resourceManager';
import { u64ToBigInt } from '@/lib/core/u64';

// =============================================================================
// Helpers
// =============================================================================

/** Convert RGBA pixel data to a data:image/png URL via an offscreen canvas. */
function rgbaToDataUrl(pixels: Uint8Array, width: number, height: number): string {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d')!;
	const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height);
	ctx.putImageData(imageData, 0, 0);
	return canvas.toDataURL('image/png');
}

type DecodedTextureEntry = {
	resourceId: string;
	header: ParsedTextureHeader;
	dataUrl: string;
	error?: undefined;
} | {
	resourceId: string;
	header?: undefined;
	dataUrl?: undefined;
	error: string;
};

// =============================================================================
// Page
// =============================================================================

const TexturePage = () => {
	const { loadedBundle, originalArrayBuffer } = useBundle();

	const textures = useMemo(() => {
		if (!loadedBundle || !originalArrayBuffer) return [];

		const out: DecodedTextureEntry[] = [];
		for (const resource of loadedBundle.resources) {
			if (resource.resourceTypeId !== TEXTURE_TYPE_ID) continue;
			const id = u64ToBigInt(resource.resourceId).toString(16);
			try {
				const decoded = decodeTexture(originalArrayBuffer, loadedBundle, resource);
				out.push({
					resourceId: id,
					header: decoded.header,
					dataUrl: rgbaToDataUrl(decoded.pixels, decoded.header.width, decoded.header.height),
				});
			} catch (err) {
				// Capture raw header hex for debugging format issues.
				let hexDump = '';
				try {
					const blocks = getResourceBlocks(originalArrayBuffer, loadedBundle, resource);
					if (blocks[0]) {
						const h = blocks[0];
						hexDump = ' | header[0..31]: ' + Array.from(h.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
					}
				} catch { /* ignore */ }
				out.push({
					resourceId: id,
					error: (err instanceof Error ? err.message : String(err)) + hexDump,
				});
			}
		}
		return out;
	}, [loadedBundle, originalArrayBuffer]);

	if (!loadedBundle || !originalArrayBuffer) {
		return (
			<Card>
				<CardHeader><CardTitle>Texture Viewer</CardTitle></CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle that contains Texture resources to view them.
					</div>
				</CardContent>
			</Card>
		);
	}

	if (textures.length === 0) {
		return (
			<Card>
				<CardHeader><CardTitle>Texture Viewer</CardTitle></CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						No Texture resources (type 0x0) found in this bundle.
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>Texture Viewer</CardTitle>
					<p className="text-sm text-muted-foreground">
						{textures.length} texture(s) in bundle
					</p>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
						{textures.map((tex) => (
							<div
								key={tex.resourceId}
								className="border rounded-lg overflow-hidden bg-muted/30"
							>
								{tex.error ? (
									<div className="aspect-square flex items-center justify-center bg-destructive/10 text-destructive text-xs p-2">
										{tex.error}
									</div>
								) : (
									<div className="aspect-square flex items-center justify-center bg-[repeating-conic-gradient(#222_0%_25%,#333_0%_50%)] bg-[length:16px_16px]">
										<img
											src={tex.dataUrl}
											alt={`Texture ${tex.resourceId}`}
											className="max-w-full max-h-full object-contain"
											style={{ imageRendering: tex.header.width <= 64 ? 'pixelated' : 'auto' }}
										/>
									</div>
								)}
								<div className="p-2 text-xs space-y-0.5">
									<div className="font-mono text-muted-foreground truncate" title={tex.resourceId}>
										{tex.resourceId}
									</div>
									{tex.header && (
										<div className="flex gap-2 flex-wrap">
											<span>{tex.header.width}×{tex.header.height}</span>
											<span className="text-muted-foreground">{tex.header.format}</span>
											<span className="text-muted-foreground">{tex.header.mipLevels} mips</span>
										</div>
									)}
								</div>
							</div>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	);
};

export default TexturePage;

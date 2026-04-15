// 2D preview viewport for Texture resources (type 0x0).
//
// Renders the currently-selected texture's decoded RGBA pixels onto an
// offscreen canvas and paints the resulting PNG in the center pane. Pixel
// data comes from TextureContext (provided by TexturePage), not from the
// schema editor's `data` prop — `data` only holds the header record.
//
// Small textures (<= 64px on either axis) render with nearest-neighbor
// scaling so pixel art reads crisply. Everything else uses the browser's
// default smooth scaling. A checkerboard background makes alpha transparency
// visible.

import { useMemo } from 'react';
import { useTextureContext, type TextureDecodeResult } from './textureContext';

// Paint an RGBA byte buffer onto a canvas and return a data URL.
// Works exactly like the helper in the old TexturePage — copied verbatim so
// the preview behavior is unchanged from the pre-migration gallery view.
function rgbaToDataUrl(pixels: Uint8Array, width: number, height: number): string {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d')!;
	const ab = pixels.buffer.slice(
		pixels.byteOffset,
		pixels.byteOffset + pixels.byteLength,
	) as ArrayBuffer;
	const imageData = new ImageData(new Uint8ClampedArray(ab), width, height);
	ctx.putImageData(imageData, 0, 0);
	return canvas.toDataURL('image/png');
}

// Compute a preview data URL from a decode result. Returns null when the
// decode failed or no context was provided.
function makeDataUrl(decoded: TextureDecodeResult | undefined): string | null {
	if (!decoded || decoded.status !== 'ok') return null;
	return rgbaToDataUrl(decoded.pixels, decoded.width, decoded.height);
}

export function TextureViewport() {
	const ctx = useTextureContext();

	// Rebuild the data URL only when the decoded payload changes identity.
	// In practice that's once per texture selection — the schema editor's
	// header edits don't touch pixel data, so this stays cached while the
	// user fiddles with width/height/etc.
	const dataUrl = useMemo(() => makeDataUrl(ctx?.decoded), [ctx?.decoded]);

	if (!ctx) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground">
				Texture preview context not provided.
			</div>
		);
	}

	const decoded = ctx.decoded;

	if (decoded.status === 'error') {
		return (
			<div className="h-full flex items-center justify-center p-4">
				<div className="text-xs text-destructive text-center max-w-xs">
					Unable to decode texture #{ctx.selectedIndex}:<br />
					<span className="font-mono">{decoded.error}</span>
				</div>
			</div>
		);
	}

	const { width, height } = decoded;
	// Nearest-neighbor scaling for tiny textures so icon-sized art doesn't
	// blur. Threshold matches the pre-migration gallery (64px on either axis).
	const pixelated = width <= 64 || height <= 64;

	return (
		<div className="h-full w-full flex items-center justify-center bg-[repeating-conic-gradient(#222_0%_25%,#333_0%_50%)] bg-[length:16px_16px] p-4">
			<img
				src={dataUrl!}
				alt={`Texture #${ctx.selectedIndex} (${width}×${height})`}
				className="max-w-full max-h-full object-contain"
				style={{ imageRendering: pixelated ? 'pixelated' : 'auto' }}
			/>
		</div>
	);
}

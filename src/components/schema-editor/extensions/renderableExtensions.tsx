// Schema-editor extensions for the Renderable resource.
//
// Two adapters:
//
//   - RenderableCard — rendered when the inspector is on a ParsedRenderable
//     record (`renderables[wi]`). Shows every mesh in the renderable as a
//     mini-card: material id, resolved texture thumbs, shader name + class,
//     vertex layout, OBB matrix. This is the old PartInfoPanel from the
//     pre-schema RenderablePage, lifted to a schema extension so users can
//     browse texture resolution without leaving the inspector.
//
//   - RenderableMeshCard — rendered when the inspector is on a single mesh
//     (`renderables[wi].meshes[mi]`). Same content, scoped to one mesh.
//
// Both pull data from RenderableDecodedContext (the decoded pipeline
// output) rather than from the schema editor's `data` prop. The schema
// editor only holds raw ParsedRenderable; the resolved textures + shader
// info live in the DecodedRenderable produced by the viewport's decode
// pass.
//
// If the clicked renderable isn't currently decoded (e.g., it was filtered
// out by the decode mode), the card shows a friendly hint asking the user
// to switch decode mode. Everything degrades gracefully.

import React from 'react';
import type { SchemaExtensionProps, ExtensionRegistry } from '../context';
import {
	useRenderableDecoded,
	type DecodedMesh,
	type DecodedRenderable,
} from '../viewports/renderableDecodedContext';
import type { ResolvedMaterial } from '@/lib/core/materialChain';
import type { DecodedTexture } from '@/lib/core/texture';

// ---------------------------------------------------------------------------
// Texture thumbnail — converts a decoded RGBA texture to a data URL, with
// per-texture caching so the same thumb never gets encoded twice.
// ---------------------------------------------------------------------------

const texDataUrlCache = new WeakMap<DecodedTexture, string>();

function texToDataUrl(tex: DecodedTexture): string {
	const cached = texDataUrlCache.get(tex);
	if (cached) return cached;
	const { width, height } = tex.header;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d')!;
	const ab = tex.pixels.buffer.slice(
		tex.pixels.byteOffset,
		tex.pixels.byteOffset + tex.pixels.byteLength,
	) as ArrayBuffer;
	const imageData = new ImageData(new Uint8ClampedArray(ab), width, height);
	ctx.putImageData(imageData, 0, 0);
	const url = canvas.toDataURL('image/png');
	texDataUrlCache.set(tex, url);
	return url;
}

function TextureThumb({
	tex,
	label,
	suffix,
}: {
	tex: DecodedTexture | null;
	label: string;
	suffix?: string;
}) {
	if (!tex) {
		return (
			<div className="flex items-center gap-2">
				<span className="text-muted-foreground text-[10px] w-14">{label}</span>
				<span className="text-muted-foreground text-[10px]">none</span>
			</div>
		);
	}
	const url = texToDataUrl(tex);
	return (
		<div className="flex items-center gap-2">
			<span className="text-muted-foreground text-[10px] w-14 shrink-0">{label}</span>
			<a
				href={url}
				target="_blank"
				rel="noopener noreferrer"
				title={`View full ${tex.header.width}x${tex.header.height} ${tex.header.format} texture`}
				className="shrink-0 border border-border rounded hover:border-primary transition-colors"
			>
				<img
					src={url}
					alt={label}
					className="block"
					style={{
						width: 48,
						height: 48,
						imageRendering: 'pixelated',
						objectFit: 'contain',
						background: '#111',
					}}
				/>
			</a>
			<span className="font-mono text-[10px]">
				{tex.header.width}x{tex.header.height}
				<br />
				{tex.header.format}
				{suffix ? ` ${suffix}` : ''}
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Material classification — derives a short human label from the shader
// name. Mirrors the classification heuristics in the old PartInfoPanel.
// ---------------------------------------------------------------------------

function classifyMaterial(rm: ResolvedMaterial): string {
	const sn = rm.shaderName ?? '';
	if (sn.includes('Window')) return 'glass';
	if (sn.includes('Chrome')) return 'chrome';
	if (sn.includes('PaintGloss')) return 'paint';
	if (sn.includes('Light')) return 'light';
	if (sn.includes('Metal')) return 'metal';
	if (sn.includes('Decal')) return 'decal';
	if (sn.includes('CarGuts')) return 'interior';
	return 'textured';
}

function classColorClass(classification: string): string {
	switch (classification) {
		case 'chrome': return 'text-gray-300';
		case 'glass': return 'text-sky-400';
		case 'paint': return 'text-amber-400';
		case 'light': return 'text-yellow-300';
		case 'metal': return 'text-gray-400';
		default: return '';
	}
}

// ---------------------------------------------------------------------------
// Material section — texture thumbs + shader + classification + cross-bundle
// flags. Shared between the full-renderable card and the per-mesh card.
// ---------------------------------------------------------------------------

function MaterialInfoSection({ rm }: { rm: ResolvedMaterial }) {
	const classification = classifyMaterial(rm);
	const flags = [
		rm.diffuseFromSecondary && 'diffVT',
		rm.anyFromSecondary && 'anyVT',
		rm.crossBundleMisses > 0 && `miss:${rm.crossBundleMisses}`,
	].filter(Boolean).join(' ') || 'none';

	return (
		<div className="mb-3">
			<div className="text-muted-foreground mb-1">resolved textures</div>
			<div className="space-y-1.5">
				<TextureThumb
					tex={rm.diffuse}
					label="diffuse"
					suffix={rm.diffuseFromSecondary ? '(VT)' : rm.diffuse ? '(GR)' : undefined}
				/>
				<TextureThumb tex={rm.normal} label="normal" />
				<TextureThumb tex={rm.specular} label="specular" />
				<TextureThumb tex={rm.emissive} label="emissive" />
				<TextureThumb tex={rm.ao} label="AO" />
				{rm.unclassified.map((u, i) => (
					<TextureThumb key={i} tex={u.texture} label={`ch=${u.channel}`} suffix="(?)" />
				))}
			</div>
			<div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px] mt-2">
				{rm.shaderName && (
					<>
						<span className="text-muted-foreground">shader</span>
						<span className="text-emerald-400 break-all">{rm.shaderName}</span>
					</>
				)}
				<span className="text-muted-foreground">class</span>
				<span className={classColorClass(classification)}>{classification}</span>
				<span className="text-muted-foreground">flags</span>
				<span>{flags}</span>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Vertex layout table (same layout for every mesh in a renderable — one
// VD typically feeds all meshes).
// ---------------------------------------------------------------------------

const ATTR_NAMES: Record<number, string> = {
	1: 'POSITION',
	3: 'NORMAL',
	5: 'TEXCOORD0',
	6: 'TEXCOORD1',
	13: 'BLENDIDX',
	14: 'BLENDWT',
	15: 'TANGENT',
};

function VertexLayoutTable({ layout }: { layout: { type: number; offset: number; stride: number }[] | null }) {
	if (!layout || layout.length === 0) return null;
	const stride = layout[0]?.stride ?? 0;
	return (
		<div className="mb-3">
			<div className="text-muted-foreground mb-1">
				vertex layout <span className="text-foreground">(stride {stride}B)</span>
			</div>
			<table className="font-mono text-[10px] w-full">
				<thead>
					<tr className="text-muted-foreground">
						<td>attr</td>
						<td className="text-right">off</td>
						<td className="text-right">size</td>
					</tr>
				</thead>
				<tbody>
					{layout.map((a, i) => {
						const nextOff = i + 1 < layout.length ? layout[i + 1].offset : stride;
						const size = nextOff - a.offset;
						return (
							<tr key={i}>
								<td>{ATTR_NAMES[a.type] ?? `type_${a.type}`}</td>
								<td className="text-right">+{a.offset}</td>
								<td className="text-right">{size}B</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

// ---------------------------------------------------------------------------
// OBB matrix dump (4×4 row-major).
// ---------------------------------------------------------------------------

function OBBMatrixBlock({ matrix }: { matrix: Float32Array }) {
	const rows: string[] = [];
	for (let r = 0; r < 4; r++) {
		const row = [0, 1, 2, 3]
			.map((c) => matrix[r * 4 + c].toFixed(3).padStart(7, ' '))
			.join(' ');
		rows.push(row);
	}
	return (
		<div>
			<div className="text-muted-foreground mb-1">mesh boundingMatrix (OBB)</div>
			<pre className="font-mono text-[10px] leading-tight whitespace-pre">{rows.join('\n')}</pre>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Per-mesh detail block — used inline in the full-renderable card and as
// the body of the single-mesh card.
// ---------------------------------------------------------------------------

function MeshDetailBlock({ mesh, index }: { mesh: DecodedMesh; index: number }) {
	const idHex = (id: bigint | null) =>
		id === null ? '—' : '0x' + id.toString(16).padStart(8, '0');
	const vdList = mesh.vertexDescriptorIds.filter((id): id is bigint => id !== null);
	return (
		<div className="border-t pt-3 text-xs">
			<div className="font-semibold text-amber-300 mb-1">Mesh {index}</div>
			<div className="grid grid-cols-2 gap-1 mb-3">
				<div className="text-muted-foreground">vertices</div>
				<div className="font-mono text-right">{mesh.vertexCount.toLocaleString()}</div>
				<div className="text-muted-foreground">indices</div>
				<div className="font-mono text-right">{mesh.indexCount.toLocaleString()}</div>
				<div className="text-muted-foreground">tris</div>
				<div className="font-mono text-right">{(mesh.indexCount / 3).toLocaleString()}</div>
				<div className="text-muted-foreground">startIndex</div>
				<div className="font-mono text-right">{mesh.startIndex.toLocaleString()}</div>
				<div className="text-muted-foreground">primType</div>
				<div className="font-mono text-right">
					{mesh.primitiveType === 4 ? '4 (TRILIST)' : `${mesh.primitiveType}`}
				</div>
				<div className="text-muted-foreground">VDs (resolved)</div>
				<div className="font-mono text-right">{vdList.length} / 6</div>
			</div>
			<div className="mb-3">
				<div className="text-muted-foreground mb-1">material assembly</div>
				<div className="font-mono break-all text-[10px]">{idHex(mesh.materialAssemblyId)}</div>
			</div>
			{mesh.resolvedMaterial && <MaterialInfoSection rm={mesh.resolvedMaterial} />}
			<div className="mb-3">
				<div className="text-muted-foreground mb-1">vertex descriptors</div>
				{vdList.length === 0 ? (
					<div className="font-mono text-muted-foreground text-[10px]">none</div>
				) : (
					<ul className="font-mono space-y-0.5 text-[10px]">
						{mesh.vertexDescriptorIds.map((id, i) =>
							id === null ? null : (
								<li key={i}>
									[{i}] {idHex(id)}
								</li>
							),
						)}
					</ul>
				)}
			</div>
			<VertexLayoutTable layout={mesh.vertexLayout} />
			<OBBMatrixBlock matrix={mesh.boundingMatrix} />
		</div>
	);
}

// ---------------------------------------------------------------------------
// Header block shared by both extensions — resource id, debug name, part
// locator presence indicator.
// ---------------------------------------------------------------------------

function RenderableHeaderBlock({ dr }: { dr: DecodedRenderable }) {
	return (
		<div className="mb-3">
			<div className="text-muted-foreground">Renderable id</div>
			<div className="font-mono text-foreground">
				0x{dr.resourceId.toString(16).padStart(8, '0')}
			</div>
			{dr.debugName && (
				<div className="font-mono text-foreground break-all mt-1 text-[11px]">
					{dr.debugName}
				</div>
			)}
			<div className="text-[10px] text-muted-foreground mt-1">
				part locator: {dr.partLocator ? 'present (16 floats)' : 'none'}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Empty state — renderable not present in the current decoded set.
// ---------------------------------------------------------------------------

function NotDecodedHint() {
	return (
		<div className="text-xs text-muted-foreground p-3 border rounded">
			<div className="font-medium text-foreground mb-1">Not in current decode pass</div>
			<p>
				This renderable isn't part of the viewport's current decoded set. Material and texture
				resolution only runs on renderables the viewer draws. Try switching decode mode to
				"all renderables" or enabling "all LODs" in the 3D preview header to include it.
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Extension components
// ---------------------------------------------------------------------------

// Full-renderable view — shows every mesh's card stacked vertically.
export const RenderableCardExtension: React.FC<SchemaExtensionProps> = ({ path }) => {
	const ctx = useRenderableDecoded();
	const wi = path[0] === 'renderables' && typeof path[1] === 'number' ? (path[1] as number) : null;
	if (wi == null) {
		return (
			<div className="text-xs text-muted-foreground p-3">
				Select a renderable in the tree to see its materials and textures.
			</div>
		);
	}
	if (!ctx) {
		return (
			<div className="text-xs text-destructive p-3">
				Decoded context missing — expected a RenderableDecodedProvider above this editor.
			</div>
		);
	}
	const dr = ctx.byWrappedIndex.get(wi);
	if (!dr) return <NotDecodedHint />;

	return (
		<div className="text-xs overflow-y-auto h-full p-1">
			<RenderableHeaderBlock dr={dr} />
			{dr.meshes.length === 0 ? (
				<div className="text-muted-foreground">No drawable meshes in this renderable.</div>
			) : (
				dr.meshes.map((m, i) => <MeshDetailBlock key={i} mesh={m} index={i} />)
			)}
		</div>
	);
};

// Single-mesh view — like the full card but scoped to one mesh row.
export const RenderableMeshCardExtension: React.FC<SchemaExtensionProps> = ({ path }) => {
	const ctx = useRenderableDecoded();
	const wi = path[0] === 'renderables' && typeof path[1] === 'number' ? (path[1] as number) : null;
	const mi = path[2] === 'meshes' && typeof path[3] === 'number' ? (path[3] as number) : null;
	if (wi == null || mi == null) {
		return (
			<div className="text-xs text-muted-foreground p-3">
				Select a mesh in the tree to see its material and vertex layout.
			</div>
		);
	}
	if (!ctx) {
		return (
			<div className="text-xs text-destructive p-3">
				Decoded context missing — expected a RenderableDecodedProvider above this editor.
			</div>
		);
	}
	const dr = ctx.byWrappedIndex.get(wi);
	if (!dr) return <NotDecodedHint />;
	const mesh = dr.meshes[mi];
	if (!mesh) {
		return (
			<div className="text-xs text-muted-foreground p-3">
				This mesh was filtered out of the 3D decode (empty, non-TRIANGLELIST, or missing vertex
				descriptor). Material details are only available for drawable meshes.
			</div>
		);
	}
	return (
		<div className="text-xs overflow-y-auto h-full p-1">
			<RenderableHeaderBlock dr={dr} />
			<MeshDetailBlock mesh={mesh} index={mi} />
		</div>
	);
};

// ---------------------------------------------------------------------------
// Registry — what the SchemaEditorProvider receives via `extensions`.
// ---------------------------------------------------------------------------

export const renderableExtensions: ExtensionRegistry = {
	RenderableCard: RenderableCardExtension,
	RenderableMeshCard: RenderableMeshCardExtension,
};

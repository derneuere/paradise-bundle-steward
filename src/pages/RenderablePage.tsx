// Schema-driven editor for Renderable (resource type 0xC).
//
// A vehicle bundle (e.g. VEH_CARBRWDS_GR.BIN) holds ~100 Renderable records,
// one per LOD of each mesh group. All of them appear in the schema editor's
// hierarchy tree as children of a single `RenderableCollection` root. Tree
// order matches the viewport's decoded order so clicks in 3D line up with
// tree rows.
//
// Data flow:
//
//   useBundle + getResources('renderable')
//         │
//         │  (decode pipeline: parseRenderable → imports → textures)
//         ▼
//   RenderableDecodedProvider
//         ├── exposes `filteredParsed` (aligned with 3D view)
//         └── exposes `byWrappedIndex` (decoded data lookup for extensions)
//         │
//         ▼
//   SchemaEditorProvider (stable — no key-based remount)
//         data = { renderables: filteredParsed, _debugNames, _triCounts }
//         extensions = renderableExtensions
//         │
//         ▼
//   SchemaEditor
//     ├── HierarchyTree — lists every decoded renderable by debug name + tris
//     ├── ViewportPane → RenderableViewport — consumes decoded context
//     └── InspectorPanel
//           for path = ['renderables', wi]               → ParsedRenderable form + RenderableCard tab
//           for path = ['renderables', wi, 'meshes', mi] → RenderableMesh form + RenderableMeshCard tab
//
// Renderable is read-only, so onChange is a no-op.

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { renderableResourceSchema } from '@/lib/schema/resources/renderable';
import type { ParsedRenderable } from '@/lib/core/renderable';
import {
	RenderableDecodedProvider,
	useRenderableDecoded,
} from '@/components/schema-editor/viewports/renderableDecodedContext';
import { renderableExtensions } from '@/components/schema-editor/extensions/renderableExtensions';

// Inner body — rendered inside RenderableDecodedProvider so it can consume
// the filtered/aligned data via useRenderableDecoded.
function RenderablePageInner() {
	const { loadedBundle, getResources } = useBundle();
	const decoded = useRenderableDecoded();

	// Quick guard for the "no renderables in this bundle" case. The
	// decoded context will also report this, but we want a friendly empty
	// state before the first decode pass completes.
	const anyRenderables = useMemo(
		() => getResources<ParsedRenderable>('renderable').length > 0,
		[getResources],
	);

	// Wrap the decoded, aligned ParsedRenderable array into the schema
	// editor's root record shape. `_debugNames` and `_triCounts` are
	// hidden from the UI but read by tree-label callbacks.
	const data = useMemo(() => {
		if (!decoded) return null;
		return {
			renderables: decoded.filteredParsed,
			_debugNames: decoded.filteredDebugNames,
			_triCounts: decoded.filteredTriCounts,
		};
	}, [decoded]);

	if (!loadedBundle) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Renderable — Schema Editor</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle containing a Renderable resource (e.g. a vehicle graphics bundle) to begin.
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!anyRenderables) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Renderable — Schema Editor</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						This bundle has no Renderable (0xC) resources.
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!data) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Renderable — Schema Editor</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">Decoding…</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="h-full min-h-0 flex flex-col gap-3">
			<div className="flex items-center gap-4 shrink-0">
				<div className="flex-1">
					<h2 className="text-lg font-semibold">Renderable — Schema Editor</h2>
					<p className="text-xs text-muted-foreground">
						3D mesh resource (0xC). Click a part in the viewer or a renderable in the tree to drill
						in; the "Materials & Textures" tab in the inspector shows resolved texture thumbs.
					</p>
				</div>
			</div>
			<div className="flex-1 min-h-0">
				<SchemaEditorProvider
					resource={renderableResourceSchema}
					data={data}
					onChange={() => {
						/* Renderable is read-only — no edits to propagate. */
					}}
					extensions={renderableExtensions}
				>
					<SchemaEditor />
				</SchemaEditorProvider>
			</div>
		</div>
	);
}

const RenderablePage = () => (
	<RenderableDecodedProvider>
		<RenderablePageInner />
	</RenderableDecodedProvider>
);

export default RenderablePage;

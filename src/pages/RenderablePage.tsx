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
import {
	ShortcutsHelp,
	SCHEMA_TREE_SHORTCUTS,
	type ShortcutGroup,
} from '@/components/schema-editor/ShortcutsHelp';

// Renderable has no multi-resource picker (the page folds all bundle
// renderables into a single tree under one synthetic root), and it's
// read-only so there's no bulk-edit story. Just the tree and the
// viewport's click-to-focus gesture.
const RENDERABLE_SHORTCUT_GROUPS: ShortcutGroup[] = [
	SCHEMA_TREE_SHORTCUTS,
	{
		title: '3D viewport',
		items: [
			{ keys: ['Click', 'part'], label: 'Open that renderable in the inspector' },
			{ keys: ['Drag'], label: 'Orbit the camera' },
			{ keys: ['Right-Drag'], label: 'Pan' },
			{ keys: ['Scroll'], label: 'Zoom in / out' },
		],
	},
];

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
			<div className="shrink-0">
				<div className="flex items-center gap-3">
					<h2 className="text-lg font-semibold">Renderable — Schema Editor</h2>
					<ShortcutsHelp groups={RENDERABLE_SHORTCUT_GROUPS} />
				</div>
				<p className="text-xs text-muted-foreground mt-1">
					3D mesh data (resource type 0xC). A vehicle bundle typically holds ~100 Renderables —
					one per LOD of each mesh group (body, glass, interior, …). Each carries an index /
					vertex buffer plus a per-mesh draw table whose MaterialAssembly imports resolve to
					Texture and TextureState resources via the material chain. The viewport decodes and
					renders every Renderable in bundle order; the inspector's "Materials &amp; Textures"
					tab surfaces the resolved texture thumbs for whichever renderable is selected.
				</p>
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

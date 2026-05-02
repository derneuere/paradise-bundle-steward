// Center pane — hosts the resource's 3D viewport.
//
// Resolves an EditorProfile via the editor registry (ADR-0008) and mounts
// the profile's `overlay` inside a shared `<WorldViewport>` chrome. Two
// resource types own their own non-WorldViewport surfaces and are special-
// cased: `renderable` runs a full three.js scene driven by
// `RenderableDecodedProvider`; `texture` shows a 2D preview off
// `TextureContext`. Everything else flows through the profile's overlay.

import { ViewportErrorBoundary } from '@/components/common/ViewportErrorBoundary';
import { useSchemaEditor } from './context';
import type { NodePath } from '@/lib/schema/walk';
import { RenderableViewport } from './viewports/RenderableViewport';
import { TextureViewport } from './viewports/TextureViewport';
import { WorldViewport } from './viewports/WorldViewport';
import type { ResourceSchema } from '@/lib/schema/types';
import { pickProfileByKey } from '@/lib/editor/registry';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ViewportPane() {
	const { resource, data, selectedPath, selectPath, setAtPath } = useSchemaEditor();

	// Error boundary resets when the user switches resource — otherwise a
	// crash on one resource would wedge the pane until a full page reload.
	return (
		<ViewportErrorBoundary resetKey={resource.key}>
			<ViewportPaneInner
				resource={resource}
				data={data}
				selectedPath={selectedPath}
				selectPath={selectPath}
				setAtPath={setAtPath}
			/>
		</ViewportErrorBoundary>
	);
}

function ViewportPaneInner({
	resource,
	data,
	selectedPath,
	selectPath,
	setAtPath,
}: {
	resource: ResourceSchema;
	data: unknown;
	selectedPath: NodePath;
	selectPath: (path: NodePath) => void;
	setAtPath: (path: NodePath, next: unknown) => void;
}) {
	// Renderable / Texture own bespoke viewport surfaces — neither is a
	// WorldViewport overlay, so resolve those before consulting the
	// editor profile's `overlay`.
	if (resource.key === 'renderable') {
		// Renderable's 3D preview is the main user-facing value of the
		// resource — a full three.js scene that decodes every 0xC record in
		// the bundle. It pulls its own state from useWorkspace + the
		// RenderableDecodedProvider supplied by RenderablePage, and wires
		// click events back to the schema editor via useSchemaEditor.
		return <RenderableViewport />;
	}
	if (resource.key === 'texture') {
		// 2D preview: the schema's root is just the ParsedTextureHeader, but
		// TextureViewport pulls decoded RGBA pixels from TextureContext
		// (provided by TexturePage) so the center pane can show the image.
		return <TextureViewport />;
	}

	const profile = pickProfileByKey(resource.key, data);
	const Overlay = profile?.overlay;
	if (!Overlay) {
		return (
			<div className="h-full flex items-center justify-center text-xs text-muted-foreground">
				No viewport available for {resource.name}.
			</div>
		);
	}
	// All overlays speak the same NodePath contract (ADR-0001) — pass
	// (data, selectedPath, onSelect, onChange) directly. In-scene edits
	// route to setAtPath([], next), matching the pre-registry shim
	// behaviour.
	return (
		<WorldViewport>
			<Overlay
				data={data}
				selectedPath={selectedPath}
				onSelect={selectPath}
				onChange={(next: unknown) => setAtPath([], next)}
			/>
		</WorldViewport>
	);
}

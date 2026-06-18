// Bespoke-editor dispatch for resources that have no ResourceSchema.
//
// Most resource types are edited in the Workspace through the generic
// schema-driven InspectorPanel. A few (deformationSpec, attribSysVault) carry
// no schema — their models are too irregular for the schema framework, so
// they shipped as hand-written tabbed/accordion editors on their own legacy
// pages. When those pages were folded into the Workspace, the editors moved
// into feature folders as presentational `{ data, onChange }` components and
// this module became the single place that maps a `resourceKey` to one.
//
// The Workspace's CenterViewport renders `<BespokeResourceEditor>` in the
// main pane for any key `hasBespokeEditor` recognises (these resources have
// no 3D scene, so the wide pane hosts the form — same slot texture/shader/
// renderable use for their bespoke surfaces). The editor reads the selected
// instance straight from the Workspace and writes edits back via
// `setResourceAt`, so it participates in the global undo stack and dirty
// tracking like every other resource.

import type { ComponentType } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { DeformationSpecEditor } from '@/components/deformationSpec/DeformationSpecEditor';
import { AttribSysVaultEditor } from '@/components/attribSys/AttribSysVaultEditor';
import type { ParsedDeformationSpec } from '@/lib/core/deformationSpec';
import type { ParsedAttribSys } from '@/lib/core/attribSys';
import { hasBespokeEditor } from './bespokeEditorKeys';

// Re-export the predicate so render sites can import it alongside the
// component from one place; the source of truth is the pure key module.
export { hasBespokeEditor };

// A bespoke editor is a presentational `{ data, onChange }` component. The
// stored value is typed as `unknown` here; each entry casts to its model in
// its own render wrapper so the registry stays a flat string→component map.
type BespokeEditor = ComponentType<{ data: never; onChange: (next: never) => void }>;

const BESPOKE_EDITORS: Record<string, BespokeEditor> = {
	deformationSpec: DeformationSpecEditor as unknown as BespokeEditor,
	attribSysVault: AttribSysVaultEditor as unknown as BespokeEditor,
};

export function BespokeResourceEditor({ resourceKey }: { resourceKey: string }) {
	const { bundles, selection, setResourceAt } = useWorkspace();
	const Editor = BESPOKE_EDITORS[resourceKey];

	const placeholder = (msg: string) => (
		<div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
			{msg}
		</div>
	);

	if (!Editor || !selection || selection.resourceKey !== resourceKey) {
		return placeholder('No editor for this selection.');
	}
	const bundle = bundles.find((b) => b.id === selection.bundleId);
	if (!bundle) return placeholder('Bundle no longer loaded.');

	// These resources are single-instance, so the tree lands on index 0;
	// default to 0 if the selection is still at resource-type level.
	const index = selection.index ?? 0;
	const model = bundle.parsedResourcesAll.get(resourceKey)?.[index] ?? null;
	if (model == null) {
		return placeholder(`This ${resourceKey} instance couldn't be parsed — nothing to edit.`);
	}

	const Typed = Editor as ComponentType<{ data: unknown; onChange: (next: unknown) => void }>;
	return (
		<Typed
			data={model as ParsedDeformationSpec | ParsedAttribSys}
			onChange={(next) => setResourceAt(selection.bundleId, resourceKey, index, next)}
		/>
	);
}

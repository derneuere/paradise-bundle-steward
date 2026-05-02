// EditorProfile — the editor-aware view of a single resource layout variant.
//
// One handler in `src/lib/core/registry/` parses bytes for a typeId. One or
// more EditorProfiles describe how the editor surfaces those bytes once
// parsed: which schema, which 3D overlay, which extension panels, which
// conversions to other variants. AI Sections will eventually have three
// profiles registered against typeId 0x10001 — one for retail v12, one each
// for the Burnout 5 prototype V4 and V6 layouts — and `pickProfile` picks
// the right one by inspecting the parsed model. See ADR-0008.
//
// Why a separate layer (the "α-loose" rule):
//
//   parsers (src/lib/core/*.ts)              ← React-free, byte-level
//          ↑
//   core registry (src/lib/core/registry/)   ← React-free, CLI/export use this
//          ↑
//   editor registry (src/lib/editor/)        ← may import React, schema, overlays
//          ↑
//   Workspace UI                              ← only touches the editor registry
//
// The editor registry wraps the core registry but is the only thing the
// Workspace consults for schema/overlay/extensions/conversions. CLI flows,
// the bundle writer, and cross-platform export keep using the core registry
// directly so they never pull React or any JSX into pure-Node land.

import type { ReactNode } from 'react';
import type { ResourceSchema } from '@/lib/schema/types';
import type { ExtensionRegistry } from '@/components/schema-editor/context';
import type { WorldOverlayComponent } from '@/components/schema-editor/viewports/WorldViewport.types';
import type { NodePath } from '@/lib/schema/walk';

/** Result of converting a model from one EditorProfile's `kind` to another. */
export type ConversionResult<TTarget = unknown> = {
	/** The migrated model. The shape matches the target profile's expected
	 *  model type — callers should already have decided which target they
	 *  want, then pick the right type at the call site. */
	result: TTarget;
	/** Field names that were filled with default values because the source
	 *  variant had no equivalent. Plumbed through to the UI for an
	 *  "X fields defaulted on conversion" disclosure. */
	defaulted: string[];
	/** Field names whose source values had no representation in the target
	 *  variant and were dropped. Plumbed through for a "Y fields lost"
	 *  warning. */
	lossy: string[];
};

/** A single conversion entry on `EditorProfile.conversions` keyed by the
 *  target profile's `kind`. */
export type ConversionEntry<M, TTarget = unknown> = {
	/** Human label for the conversion menu — e.g. "Convert to v12 retail". */
	label: string;
	/** Pure transform from this profile's model type to the target's. */
	migrate: (model: M) => ConversionResult<TTarget>;
};

/** Optional sidecar for a profile's overlay/extension layer. The world-overlay
 *  selector in `WorldViewportComposition` and the schema editor's right-pane
 *  inspector both read these to render the right surface for the picked
 *  profile. Either may be omitted — a profile that only round-trips bytes
 *  through the core registry but has no editor UI yet (e.g. the V4/V6
 *  prototype slice) leaves both fields undefined. */
export type EditorProfile<M = unknown> = {
	/** Discriminator value the profile claims, e.g. 'v12' / 'v6' / 'v4'.
	 *  Resources without versioning use 'default'. Must be unique within
	 *  the set of profiles registered for one typeId. */
	kind: string;

	/** Display name shown in the tree-label suffix, the conversion menu, and
	 *  the inspector's variant chip — e.g. 'v12 retail', 'v6 prototype'. */
	displayName: string;

	/** Schema driving the inspector + tree's per-instance rows. */
	schema: ResourceSchema;

	/** Optional 3D overlay component mounted inside the WorldViewport
	 *  composition for this profile. Omit when the resource has no spatial
	 *  representation (e.g. text files, audio dictionaries). */
	overlay?: WorldOverlayComponent<M>;

	/** Optional extension registry consumed by the schema editor's
	 *  `SchemaEditorProvider`. Powers customRenderer fields and named tab
	 *  components. Omit when the schema's default rendering is enough. */
	extensions?: ExtensionRegistry;

	/** Optional matcher used by `pickProfile` to decide whether this profile
	 *  applies to a given parsed model. Defaults to "always matches" so
	 *  single-profile resources don't have to specify one. The first
	 *  registered profile whose matcher returns true wins, so register more
	 *  specific profiles before catch-alls. */
	matches?: (model: unknown) => boolean;

	/** Optional bag of conversion entries keyed by the *target* profile's
	 *  `kind`. The Workspace surfaces these as menu items on the resource's
	 *  inspector header (e.g. "Convert to v12 retail"). */
	conversions?: Record<string, ConversionEntry<M>>;
};

/** Re-exported for callers building extensions or overlays. */
export type { ExtensionRegistry, NodePath };
export type { WorldOverlayComponent } from '@/components/schema-editor/viewports/WorldViewport.types';

/** Identity helper that lets a resource module assert the model type its
 *  profile expects. The runtime value is the profile itself; the cast just
 *  pins the generic so callers writing `aiSectionsV12Profile` get a typed
 *  `EditorProfile<ParsedAISectionsV12>` without `as` gymnastics on
 *  consumption. */
export function defineProfile<M>(profile: EditorProfile<M>): EditorProfile<M> {
	return profile;
}

/** Render-time hint passed to overlays that aren't fully migrated to the
 *  ADR-0001 schema-NodePath contract. Most overlays accept this directly via
 *  their props; this alias keeps the EditorProfile module self-documenting. */
export type OverlayChildren = ReactNode;

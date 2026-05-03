// Map handler.key → lazy-imported React editor page component.
//
// App.tsx reads this to generate its <Route> entries instead of hardcoding
// them. Adding a new editable resource means: register a handler, drop a
// page component into src/pages/, then add one line here.
//
// Only bespoke editors live here — the generic schema-driven resources are
// edited inside the Workspace editor at /workspace, so they intentionally
// have no entry below.
//
// This file is the only place outside src/pages/ that touches page imports.
// The registry itself stays UI-framework-agnostic so the CLI can import it
// under Node.

import { lazy, type ComponentType } from 'react';

export const EDITOR_PAGES: Record<string, ComponentType<unknown>> = {
	attribSysVault: lazy(() => import('@/pages/AttribSysVaultPage')),
	deformationSpec: lazy(() => import('@/pages/DeformationSpecPage')),
	renderable: lazy(() => import('@/pages/RenderablePage')),
	texture: lazy(() => import('@/pages/TexturePage')),
	polygonSoupList: lazy(() => import('@/pages/PolygonSoupListPage')),
	shader: lazy(() => import('@/pages/ShaderPage')),
};

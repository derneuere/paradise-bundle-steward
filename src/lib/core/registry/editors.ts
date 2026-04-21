// Map handler.key → lazy-imported React editor page component.
//
// App.tsx reads this to generate its <Route> entries instead of hardcoding
// them. Adding a new editable resource means: register a handler, drop a
// page component into src/pages/, then add one line here.
//
// This file is the only place outside src/pages/ that touches page imports.
// The registry itself stays UI-framework-agnostic so the CLI can import it
// under Node.

import { lazy, type ComponentType } from 'react';

export const EDITOR_PAGES: Record<string, ComponentType<unknown>> = {
	aiSections: lazy(() => import('@/pages/AISectionsPage')),
	attribSysVault: lazy(() => import('@/pages/AttribSysVaultPage')),
	deformationSpec: lazy(() => import('@/pages/DeformationSpecPage')),
	streetData: lazy(() => import('@/pages/StreetDataPage')),
	triggerData: lazy(() => import('@/pages/TriggerDataPage')),
	challengeList: lazy(() => import('@/pages/ChallengeListPage')),
	vehicleList: lazy(() => import('@/pages/VehiclesPage')),
	playerCarColours: lazy(() => import('@/pages/ColorsPage')),
	iceTakeDictionary: lazy(() => import('@/pages/IcePage')),
	renderable: lazy(() => import('@/pages/RenderablePage')),
	texture: lazy(() => import('@/pages/TexturePage')),
	trafficData: lazy(() => import('@/pages/TrafficDataPage')),
	polygonSoupList: lazy(() => import('@/pages/PolygonSoupListPage')),
	shader: lazy(() => import('@/pages/ShaderPage')),
};

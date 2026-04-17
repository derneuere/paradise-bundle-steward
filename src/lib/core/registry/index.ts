// The one-stop registry. Import a handler from its file here and it is
// automatically picked up by the CLI, the registry test suite, and (once
// Step 6 of the refactor lands) the UI.
//
// Adding a new resource type: create src/lib/core/registry/handlers/<key>.ts
// exporting a ResourceHandler, and add one import + one array entry below.
// No edits to types.ts, resourceTypes.ts, capabilities.ts, BundleContext.tsx,
// or ResourcesPage.tsx should be needed.

import type { ResourceHandler } from './handler';
import { streetDataHandler } from './handlers/streetData';
import { triggerDataHandler } from './handlers/triggerData';
import { challengeListHandler } from './handlers/challengeList';
import { vehicleListHandler } from './handlers/vehicleList';
import { playerCarColoursHandler } from './handlers/playerCarColors';
import { iceTakeDictionaryHandler } from './handlers/iceTakeDictionary';
import { renderableHandler } from './handlers/renderable';
import { textureHandler } from './handlers/texture';
import { textureStateHandler } from './handlers/textureState';
import { aiSectionsHandler } from './handlers/aiSections';
import { trafficDataHandler } from './handlers/trafficData';
import { attribSysVaultHandler } from './handlers/attribSysVault';
import { polygonSoupListHandler } from './handlers/polygonSoupList';
import { modelHandler } from './handlers/model';
import { deformationSpecHandler } from './handlers/deformationSpec';
import { shaderHandler, shaderProgramBufferHandler } from './handlers/shader';
import { wheelGraphicsSpecHandler } from './handlers/wheelGraphicsSpec';
import { graphicsStubHandler } from './handlers/graphicsStub';
import { graphicsSpecHandler } from './handlers/graphicsSpec';
import { materialHandler } from './handlers/material';

export const registry: ResourceHandler[] = [
	aiSectionsHandler,
	trafficDataHandler,
	attribSysVaultHandler,
	streetDataHandler,
	triggerDataHandler,
	challengeListHandler,
	vehicleListHandler,
	playerCarColoursHandler,
	iceTakeDictionaryHandler,
	renderableHandler,
	textureHandler,
	textureStateHandler,
	polygonSoupListHandler,
	modelHandler,
	deformationSpecHandler,
	shaderHandler,
	shaderProgramBufferHandler,
	wheelGraphicsSpecHandler,
	graphicsStubHandler,
	graphicsSpecHandler,
	materialHandler,
];

const byTypeId = new Map<number, ResourceHandler>();
const byKey = new Map<string, ResourceHandler>();
for (const h of registry) {
	if (byTypeId.has(h.typeId)) {
		throw new Error(`Duplicate ResourceHandler typeId 0x${h.typeId.toString(16)}: ${h.key}`);
	}
	if (byKey.has(h.key)) {
		throw new Error(`Duplicate ResourceHandler key: ${h.key}`);
	}
	byTypeId.set(h.typeId, h);
	byKey.set(h.key, h);
}

export function getHandlerByTypeId(typeId: number): ResourceHandler | undefined {
	return byTypeId.get(typeId);
}

export function getHandlerByKey(key: string): ResourceHandler | undefined {
	return byKey.get(key);
}

export { type ResourceHandler, type ResourceFixture, type HandlerCaps, type ResourceCtx, type ResourceCategory, type StressScenario, resourceCtxFromBundle } from './handler';
export { extractResourceRaw } from './extract';

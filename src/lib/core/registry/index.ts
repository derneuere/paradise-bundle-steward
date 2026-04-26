// The one-stop registry. Import a handler from its file here and it is
// automatically picked up by the CLI, the registry test suite, and (once
// Step 6 of the refactor lands) the UI.
//
// Adding a new resource type: create src/lib/core/registry/handlers/<key>.ts
// exporting a ResourceHandler, and add one import + one array entry below.
// No edits to types.ts, resourceTypes.ts, capabilities.ts, BundleContext.tsx,
// or ResourcesPage.tsx should be needed.

import { HANDLER_PLATFORM, type HandlerPlatform, type ResourceHandler } from './handler';
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
import { zoneListHandler } from './handlers/zoneList';

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
	zoneListHandler,
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

/**
 * Returns the set of platforms a bundle can be safely exported as. This is
 * the intersection of every resource's handler-declared `writePlatforms`.
 *
 * - Resources whose type isn't in our registry constrain the result to the
 *   bundle's source platform only: their bytes pass through verbatim, which
 *   is only valid for the platform they were originally serialised for.
 * - Handlers without an explicit `writePlatforms` default to [PC] (matches
 *   the historical LE-only assumption).
 *
 * The source platform is always included even when no handler claims it,
 * because the no-op export (target == source) is always valid.
 */
export function getExportablePlatforms(bundle: { header: { platform: number }, resources: { resourceTypeId: number }[] }): HandlerPlatform[] {
	const sourcePlatform = bundle.header.platform as HandlerPlatform;
	let intersection: Set<HandlerPlatform> | null = null;

	for (const resource of bundle.resources) {
		const handler = byTypeId.get(resource.resourceTypeId);
		const platforms: HandlerPlatform[] = handler
			? (handler.caps.writePlatforms ?? [HANDLER_PLATFORM.PC])
			: [sourcePlatform]; // unknown type → pass-through bytes, source-only
		if (intersection === null) {
			intersection = new Set(platforms);
		} else {
			for (const p of [...intersection]) {
				if (!platforms.includes(p)) intersection.delete(p);
			}
		}
		if (intersection.size === 0) break;
	}

	const result = intersection ? [...intersection] : [sourcePlatform];
	// Always include the source platform — a no-op export must always work.
	if (!result.includes(sourcePlatform)) result.push(sourcePlatform);
	// Stable ordering: PC, X360, PS3.
	return result.sort((a, b) => a - b);
}

export {
	type ResourceHandler,
	type ResourceFixture,
	type HandlerCaps,
	type ResourceCtx,
	type ResourceCategory,
	type StressScenario,
	type HandlerPlatform,
	HANDLER_PLATFORM,
	resourceCtxFromBundle,
} from './handler';
export { extractResourceRaw } from './extract';

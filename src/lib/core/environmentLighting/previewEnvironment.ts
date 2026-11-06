// The lighting a translated-shader preview uses: a season loaded in the
// workspace (its keyframes blended at the game's start-up 13:00), else the
// retail daylight default. Bundles the cb0 defaults, the white level for the
// display transform and the reflection cube.

import type * as THREE from 'three';
import { ENGINE_CONSTANT_DEFAULTS } from '../shaderEngineConstants';
import { blendTimeline, deriveEngineLighting, type EngineLighting } from './engineLighting';
import { DEFAULT_ENGINE_LIGHTING } from './defaults';
import { DEFAULT_TIME_OF_DAY } from './sun';
import { findEnvironmentSchedule, type BundleSource } from './workspaceEnvironment';
import { buildReflectionCube, defaultReflectionCube } from './reflectionCube';

export type PreviewEnvironment = {
	/** Where the lighting came from, for the UI. */
	source: 'workspace' | 'default';
	lighting: EngineLighting;
	/** Full cb0 default table (engine defaults + this lighting). */
	constants: Record<string, readonly number[]>;
	reflectionCube: THREE.CubeTexture;
};

// Workspace cubes are cached by their lighting so re-deriving on every
// workspace change doesn't leak GPU textures; seasons are few.
const cubeCache = new Map<string, THREE.CubeTexture>();

export function previewEnvironment(sources: readonly BundleSource[]): PreviewEnvironment {
	const schedule = findEnvironmentSchedule(sources);
	if (!schedule) {
		return { source: 'default', lighting: DEFAULT_ENGINE_LIGHTING, constants: ENGINE_CONSTANT_DEFAULTS, reflectionCube: defaultReflectionCube() };
	}
	const lighting = deriveEngineLighting(blendTimeline(schedule, DEFAULT_TIME_OF_DAY), { timeOfDay: DEFAULT_TIME_OF_DAY });
	const key = JSON.stringify(lighting.carConstants);
	let cube = cubeCache.get(key);
	if (!cube) cubeCache.set(key, (cube = buildReflectionCube(lighting)));
	return {
		source: 'workspace',
		lighting,
		constants: { ...ENGINE_CONSTANT_DEFAULTS, ...lighting.carConstants },
		reflectionCube: cube,
	};
}

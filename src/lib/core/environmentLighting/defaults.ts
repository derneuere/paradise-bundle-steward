import { deriveEngineLighting } from './engineLighting';
import { RETAIL_DAYLIGHT_LOOK } from './retailDaylight';

/** The engine lighting at the game's start-up time of day in the first retail season. */
export const DEFAULT_ENGINE_LIGHTING = deriveEngineLighting(RETAIL_DAYLIGHT_LOOK);

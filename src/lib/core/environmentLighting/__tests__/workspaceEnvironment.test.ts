import { describe, expect, it } from 'vitest';
import { findEnvironmentSchedule, scheduleFromTimeline } from '../workspaceEnvironment';
import { previewEnvironment } from '../previewEnvironment';
import { DEFAULT_ENGINE_LIGHTING } from '../defaults';
import { RETAIL_DAYLIGHT_LOOK } from '../retailDaylight';
import type { ParsedEnvironmentKeyframe, ParsedEnvironmentTimeLine } from '../../environmentSettings';

const zero4 = { x: 0, y: 0, z: 0, w: 0 };
const kf = (r: number): ParsedEnvironmentKeyframe => ({
	muVersion: 8,
	mBloomData: { mfLuminance: 0, mfThreshold: 0, mv4Scale: zero4 },
	mVignetteData: {
		mfAngle: 0, mfSharpness: 0, mv2Amount: { x: 0, y: 0 }, mv2Centre: { x: 0, y: 0 },
		mv4InnerColour: zero4, mv4OuterColour: zero4,
	},
	mColourCubeId: 0n,
	mScatteringData: RETAIL_DAYLIGHT_LOOK.scattering,
	mLightingData: { ...RETAIL_DAYLIGHT_LOOK.lighting, mv3KeyLightColour: { x: r, y: r, z: r } },
	mCloudsData: {
		mav3LayerLiteColour: [], mav3LayerDarkColour: [], mafLayerDensity: [], mafLayerFeathering: [],
		mafLayerOpacity: [], mafLayerSpeed: [], mafLayerScale: [], mfDirectionAngle: 0,
	},
});

const timeline: ParsedEnvironmentTimeLine = {
	muVersion: 1,
	locations: [{ keyframes: [{ mfTimeOfDay: 43200, mKeyframeId: 1n }, { mfTimeOfDay: 50400, mKeyframeId: 2n }] }],
};

describe('scheduleFromTimeline', () => {
	it('pairs the first location with its keyframes, in order', () => {
		const s = scheduleFromTimeline(timeline, new Map([[2n, kf(2)], [1n, kf(1)]]));
		expect(s?.map((e) => e.timeOfDay)).toEqual([43200, 50400]);
		expect(s?.[1].look.lighting.mv3KeyLightColour.x).toBe(2);
	});

	it('is null when a keyframe is missing or the timeline is empty', () => {
		expect(scheduleFromTimeline(timeline, new Map([[1n, kf(1)]]))).toBeNull();
		expect(scheduleFromTimeline({ muVersion: 1, locations: [] }, new Map())).toBeNull();
	});
});

describe('findEnvironmentSchedule / previewEnvironment', () => {
	it('finds nothing in a workspace without environment bundles', () => {
		expect(findEnvironmentSchedule([])).toBeNull();
	});

	it('falls back to the retail daylight', () => {
		const p = previewEnvironment([]);
		expect(p.source).toBe('default');
		expect(p.lighting).toBe(DEFAULT_ENGINE_LIGHTING);
		expect(p.constants.HDRConstants).toEqual([0.5, 2, 0, 0]);
		expect(p.reflectionCube.images).toHaveLength(6);
	});
});

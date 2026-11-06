// Find a season's time-of-day schedule among loaded bundles: an
// EnvironmentTimeLine (0x10013) whose keyframes (0x10012) are all present.
// A season bundle (ENVIRONMENTSETTINGS/000_*.BUNDLE) carries exactly that, so
// loading one into the workspace lets the previews light cars with it.

import type { ParsedBundle, ResourceEntry } from '../types';
import { getResourceBlocks } from '../resourceManager';
import { u64ToBigInt } from '../u64';
import {
	ENVIRONMENT_KEYFRAME_TYPE_ID, ENVIRONMENT_TIME_LINE_TYPE_ID,
	parseEnvironmentKeyframe, parseEnvironmentTimeLine,
	type ParsedEnvironmentKeyframe, type ParsedEnvironmentTimeLine,
} from '../environmentSettings';
import type { TimedLook } from './engineLighting';

export type BundleSource = { bundle: ParsedBundle; arrayBuffer: ArrayBuffer };

/** Pair a timeline's first location with its keyframes; null if any keyframe is missing. */
export function scheduleFromTimeline(
	timeline: ParsedEnvironmentTimeLine,
	keyframes: ReadonlyMap<bigint, ParsedEnvironmentKeyframe>,
): TimedLook[] | null {
	const entries = timeline.locations[0]?.keyframes ?? [];
	if (entries.length === 0) return null;
	const out: TimedLook[] = [];
	for (const e of entries) {
		const kf = keyframes.get(e.mKeyframeId);
		if (!kf) return null;
		out.push({ timeOfDay: e.mfTimeOfDay, look: { lighting: kf.mLightingData, scattering: kf.mScatteringData } });
	}
	return out;
}

/** The first complete season schedule found across `sources`, or null. */
export function findEnvironmentSchedule(sources: readonly BundleSource[]): TimedLook[] | null {
	const keyframes = new Map<bigint, ParsedEnvironmentKeyframe>();
	const timelines: ParsedEnvironmentTimeLine[] = [];
	for (const { bundle, arrayBuffer } of sources) {
		for (const r of bundle.resources) {
			if (r.resourceTypeId !== ENVIRONMENT_KEYFRAME_TYPE_ID && r.resourceTypeId !== ENVIRONMENT_TIME_LINE_TYPE_ID) continue;
			try {
				const raw = getResourceBlocks(arrayBuffer, bundle, r as ResourceEntry)[0];
				if (!raw) continue;
				if (r.resourceTypeId === ENVIRONMENT_KEYFRAME_TYPE_ID) keyframes.set(u64ToBigInt(r.resourceId), parseEnvironmentKeyframe(raw));
				else timelines.push(parseEnvironmentTimeLine(raw));
			} catch { /* a malformed resource just doesn't light the preview */ }
		}
	}
	for (const tl of timelines) {
		const schedule = scheduleFromTimeline(tl, keyframes);
		if (schedule) return schedule;
	}
	return null;
}

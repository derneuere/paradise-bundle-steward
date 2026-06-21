// Drives a normalized [0,1] playback clock off requestAnimationFrame.
//
// The ICE take preview maps a single timeline t01 onto BOTH the camera take and
// the car arc, so play/pause/loop/speed live here in one place rather than as a
// raw useEffect in the viewport body (the codebase keeps effects out of
// component bodies — see CLAUDE.md). The clock advances `t01` by
// `dt * speed / durationS` each frame so a `speed` of 1 plays the take in real
// time over `durationS` seconds; at the end it either loops back to 0 or stops
// at 1.
//
// `t01` is owned here as state (so scrubbing and the readout re-render), but the
// rAF loop reads play/speed/duration/loop from refs so toggling them never tears
// down and rebuilds the loop mid-flight.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatestRef } from './useLatestRef';

export type AnimationClock = {
	/** Current normalized position in [0,1]. */
	t01: number;
	playing: boolean;
	play: () => void;
	pause: () => void;
	toggle: () => void;
	/** Jump to a normalized position (e.g. from the scrub slider). */
	seek: (t01: number) => void;
};

export type AnimationClockOptions = {
	/** Real-time seconds one full pass takes at speed 1. Must be > 0. */
	durationS: number;
	/** Playback rate multiplier (1 = real time). */
	speed: number;
	/** Wrap back to 0 at the end instead of stopping at 1. */
	loop: boolean;
	/** Start playing on mount. */
	autoPlay?: boolean;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function useAnimationClock({
	durationS,
	speed,
	loop,
	autoPlay = false,
}: AnimationClockOptions): AnimationClock {
	const [t01, setT01] = useState(0);
	const [playing, setPlaying] = useState(autoPlay);

	const durationRef = useLatestRef(Math.max(1e-3, durationS));
	const speedRef = useLatestRef(speed);
	const loopRef = useLatestRef(loop);
	const playingRef = useLatestRef(playing);

	const play = useCallback(() => setPlaying(true), []);
	const pause = useCallback(() => setPlaying(false), []);
	const toggle = useCallback(() => setPlaying((p) => !p), []);
	const seek = useCallback((next: number) => setT01(clamp01(next)), []);

	// One rAF loop for the component's lifetime. It self-cancels when paused via
	// the playing ref check, so play/pause never rebuilds the loop. Advancing is
	// done with a functional setState so we don't need t01 in the loop's closure.
	const rafRef = useRef<number | null>(null);
	const lastTsRef = useRef<number | null>(null);

	useEffect(() => {
		const step = (ts: number) => {
			rafRef.current = requestAnimationFrame(step);
			if (!playingRef.current) {
				lastTsRef.current = ts;
				return;
			}
			const last = lastTsRef.current ?? ts;
			lastTsRef.current = ts;
			const dtS = (ts - last) / 1000;
			const advance = (dtS * speedRef.current) / durationRef.current;
			setT01((prev) => {
				const raw = prev + advance;
				if (raw >= 1) {
					if (loopRef.current) return raw - Math.floor(raw);
					// Stop at the end; flip playing off so the readout settles.
					if (playingRef.current) setPlaying(false);
					return 1;
				}
				return clamp01(raw);
			});
		};
		rafRef.current = requestAnimationFrame(step);
		return () => {
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
			lastTsRef.current = null;
		};
		// Loop is rebuilt only on mount/unmount; all live params come from refs.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return { t01, playing, play, pause, toggle, seek };
}

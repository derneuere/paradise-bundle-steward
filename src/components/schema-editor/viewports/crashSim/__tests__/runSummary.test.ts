// The run readout: how the car was sent in, crash or knock and on which of
// the game's rules, and how the run ended.

import { describe, expect, it } from 'vitest';
import type { CrashRun } from '@/lib/core/deformationSim';
import { runSummary } from '../runSummary';

const run = (o: Partial<CrashRun>): CrashRun => ({
	launch: 'drive', driving: { gas: 1, brake: 0, handBrake: 0, steering: 0 }, crashInput: 'release', forceCrash: false,
	startSpeed: 50, touched: false, impactSpeed: 0, closingSpeed: 0, crash: null, crashSpeed: 0, elapsed: 0, end: null, ...o,
});

describe('runSummary', () => {
	it('is empty before the first run and says how the car went in', () => {
		expect(runSummary(null)).toBe('');
		expect(runSummary(run({}))).toBe('drove in from 180 km/h');
		expect(runSummary(run({ launch: 'slide', startSpeed: 25 }))).toBe('slid in from 90 km/h');
	});

	it('names the rule a crash came from', () => {
		expect(runSummary(run({ touched: true, crash: 'headOn', crashSpeed: 50 }))).toContain('crashed head-on: the car closed on the face at 40.5 m/s or more (180 km/h)');
		expect(runSummary(run({ crash: 'side', crashSpeed: 55 }))).toContain('side-on');
		expect(runSummary(run({ launch: 'roof', crash: 'rolled', crashSpeed: 10, end: 'frozen' }))).toBe(
			'landed on its roof from 180 km/h · crashed: rolled over onto the ground (36 km/h) · came to rest');
		expect(runSummary(run({ crash: 'forced', crashSpeed: 28 }))).toContain('crashed: forced');
	});

	it('calls a hit below the crash speeds a knock, with its closing speed', () => {
		expect(runSummary(run({ startSpeed: 27.8, touched: true, impactSpeed: 28.5, closingSpeed: 28.46, end: 'frozen' })))
			.toBe('drove in from 100 km/h · knock, no crash: hit at 103 km/h, 28.5 m/s into the face · came to rest');
	});

	it('says when the car never got there, and how a run ended', () => {
		expect(runSummary(run({ end: 'frozen' }))).toContain('never reached the obstacle');
		expect(runSummary(run({ touched: true, crash: 'headOn', crashSpeed: 50, end: 'clock' }))).toContain('crash over (crash clock ran out)');
		expect(runSummary(run({ touched: true, end: 'timeout' }))).toContain('stopped after 20 s');
	});
});

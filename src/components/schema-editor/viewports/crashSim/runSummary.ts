// The Crash Preview's one-line account of a run: how the car was sent in,
// whether the game's crash test crashed it (and on which rule) or let it off
// with a knock, which absorption table the game used, and how the run ended.

import { AbsorptionSet, type CrashRun } from '@/lib/core/deformationSim';

const kmh = (mps: number) => `${Math.round(mps * 3.6)} km/h`;

const LAUNCH: Record<CrashRun['launch'], string> = {
	drive: 'drove in from',
	slide: 'slid in from',
	roof: 'landed on its roof from',
};

const CRASH: Record<NonNullable<CrashRun['crash']>, string> = {
	headOn: 'crashed head-on: the car closed on the face at 40.5 m/s or more',
	side: 'crashed side-on: the hit point closed at 50 m/s or more',
	rolled: 'crashed: rolled over onto the ground',
};
// With both thresholds at 0 only the rule's geometry is left.
const FORCED_CRASH: Record<NonNullable<CrashRun['crash']>, string> = {
	headOn: 'crashed head-on (crash speeds forced to 0)',
	side: 'crashed side-on (crash speeds forced to 0)',
	rolled: CRASH.rolled,
};

const TABLE: Record<AbsorptionSet, string> = {
	[AbsorptionSet.Normal]: 'normal',
	[AbsorptionSet.AiCrashing]: 'rival crash',
	[AbsorptionSet.PlayerExtremeCrash]: 'extreme crash (crashed near top speed)',
	[AbsorptionSet.Shutdown]: 'rival shut down',
	[AbsorptionSet.Invincible]: 'invincible',
};

const END: Record<NonNullable<CrashRun['end']>, string> = {
	clock: 'crash over (crash clock ran out)',
	frozen: 'came to rest',
	timeout: 'stopped after 20 s',
};

export function runSummary(run: CrashRun | null): string {
	if (!run) return '';
	const parts = [`${LAUNCH[run.launch]} ${kmh(run.startSpeed)}`];
	if (run.crash) parts.push(`${(run.forceCrash ? FORCED_CRASH : CRASH)[run.crash]} (${kmh(run.crashSpeed)})`);
	else if (run.touched) {
		parts.push(`knock, no crash: hit at ${kmh(run.impactSpeed)}, ${run.closingSpeed.toFixed(1)} m/s into the face`);
	} else if (run.end) parts.push(run.launch === 'roof' ? 'no crash' : 'never reached the obstacle');
	if (run.crash || run.touched) parts.push(`${TABLE[run.absorption]} absorption`);
	if (run.end) parts.push(END[run.end]);
	return parts.join(' · ');
}

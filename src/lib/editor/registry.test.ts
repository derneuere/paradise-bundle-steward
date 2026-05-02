// Tests for the pure editor-profile resolution rules.
//
// Importing `./registry.ts` would drag in every overlay component (three.js,
// leaflet, react-three-fiber) which the vitest node environment can't load.
// So we test against `./resolver.ts` directly with hand-built profile arrays.
// The registry's job is just composing these rules with the static
// registration list — that composition is straightforward enough that an
// integration test against the real registry isn't worth the env upgrade.

import { describe, it, expect } from 'vitest';
import {
	pickProfileFromList,
	suffixFromList,
	assertUniqueKinds,
} from './resolver';
import type { EditorProfile } from './types';
import type { ResourceSchema } from '@/lib/schema/types';

const stubSchema: ResourceSchema = {
	key: 'stub',
	name: 'Stub',
	rootType: 'Stub',
	registry: { Stub: { name: 'Stub', fields: {} } },
};

function profile(kind: string, opts: Partial<EditorProfile<unknown>> = {}): EditorProfile<unknown> {
	return {
		kind,
		displayName: opts.displayName ?? kind,
		schema: stubSchema,
		...opts,
	};
}

describe('pickProfileFromList', () => {
	it('returns undefined for an empty profile list', () => {
		expect(pickProfileFromList([], { kind: 'v12' })).toBeUndefined();
	});

	it('returns the lone profile when there is exactly one and the model is null', () => {
		const p = profile('default');
		expect(pickProfileFromList([p], null)).toBe(p);
		expect(pickProfileFromList([p], undefined)).toBe(p);
	});

	it('returns undefined when model is null and multiple profiles exist (cannot disambiguate)', () => {
		const a = profile('v12', { matches: (m) => (m as { kind?: string })?.kind === 'v12' });
		const b = profile('v6', { matches: (m) => (m as { kind?: string })?.kind === 'v6' });
		expect(pickProfileFromList([a, b], null)).toBeUndefined();
	});

	it('returns the first profile whose matcher accepts the model', () => {
		const v12 = profile('v12', { matches: (m) => (m as { kind?: string })?.kind === 'v12' });
		const v6  = profile('v6',  { matches: (m) => (m as { kind?: string })?.kind === 'v6' });
		const v4  = profile('v4',  { matches: (m) => (m as { kind?: string })?.kind === 'v4' });

		expect(pickProfileFromList([v12, v6, v4], { kind: 'v6' })).toBe(v6);
		expect(pickProfileFromList([v12, v6, v4], { kind: 'v4' })).toBe(v4);
	});

	it('treats a missing matcher as a catch-all (always matches)', () => {
		const v12 = profile('v12', { matches: (m) => (m as { kind?: string })?.kind === 'v12' });
		const fallback = profile('default'); // no matcher
		// v12 model → v12 wins (declared first).
		expect(pickProfileFromList([v12, fallback], { kind: 'v12' })).toBe(v12);
		// v9 model (unknown to v12) → fallback wins.
		expect(pickProfileFromList([v12, fallback], { kind: 'v9' })).toBe(fallback);
	});

	it('returns undefined when no profile matches the model', () => {
		const v12 = profile('v12', { matches: (m) => (m as { kind?: string })?.kind === 'v12' });
		expect(pickProfileFromList([v12], { kind: 'v6' })).toBeUndefined();
	});
});

describe('suffixFromList', () => {
	it('returns undefined when there is at most one profile (nothing to disambiguate)', () => {
		expect(suffixFromList([], { kind: 'v12' })).toBeUndefined();
		expect(suffixFromList([profile('default')], { kind: 'v12' })).toBeUndefined();
	});

	it('returns undefined for the FIRST/primary profile (canonical variant stays bare)', () => {
		// AI Sections issue #33: tree shows `AI Sections` for V12 retail and
		// `AI Sections (v4 prototype)` for V4. The "primary" is whichever
		// profile is listed first in the registration array.
		const v12 = profile('v12', {
			displayName: 'v12 retail',
			matches: (m) => (m as { kind?: string })?.kind === 'v12',
		});
		const v4 = profile('v4', {
			displayName: 'v4 prototype',
			matches: (m) => (m as { kind?: string })?.kind === 'v4',
		});
		expect(suffixFromList([v12, v4], { kind: 'v12' })).toBeUndefined();
	});

	it('returns the picked profile displayName for non-primary variants', () => {
		const v12 = profile('v12', {
			displayName: 'v12 retail',
			matches: (m) => (m as { kind?: string })?.kind === 'v12',
		});
		const v6 = profile('v6', {
			displayName: 'v6 prototype',
			matches: (m) => (m as { kind?: string })?.kind === 'v6',
		});
		const v4 = profile('v4', {
			displayName: 'v4 prototype',
			matches: (m) => (m as { kind?: string })?.kind === 'v4',
		});
		expect(suffixFromList([v12, v6, v4], { kind: 'v6' })).toBe('v6 prototype');
		expect(suffixFromList([v12, v6, v4], { kind: 'v4' })).toBe('v4 prototype');
	});

	it('returns undefined when no profile matches the model (no suffix to surface)', () => {
		const v12 = profile('v12', { matches: (m) => (m as { kind?: string })?.kind === 'v12' });
		const v4 = profile('v4', { matches: (m) => (m as { kind?: string })?.kind === 'v4' });
		expect(suffixFromList([v12, v4], { kind: 'v6' })).toBeUndefined();
	});
});

describe('assertUniqueKinds', () => {
	it('passes when every profile has a unique kind', () => {
		expect(() =>
			assertUniqueKinds('aiSections', [profile('v12'), profile('v6'), profile('v4')]),
		).not.toThrow();
	});

	it('throws when two profiles share a kind', () => {
		expect(() =>
			assertUniqueKinds('aiSections', [profile('v12'), profile('v12')]),
		).toThrow(/Duplicate EditorProfile.kind 'v12' on aiSections/);
	});
});

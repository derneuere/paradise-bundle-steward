// Which loaded bundle a crash pairs with, and how many deformation rows the
// spec fills. A vehicle is two bundles: VEH_<name>_GR (GraphicsSpec + meshes)
// and VEH_<name>_AT (DeformationSpec + AttribSys vault).

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBundle } from '@/lib/core/bundle';
import type { ParsedBundle } from '@/lib/core/types';
import { makeSpec } from '@/lib/core/deformationSim/__tests__/fixture';
import { crashSpecFor, crashTestAvailable, pickTwin, specRows, twinBundleId, type CrashBundle } from '../crashSetup';
import type { CrashBody } from '../crashBody';

const EXAMPLE = path.resolve(__dirname, '../../../../../../example');
const load = (name: string) => {
	const file = fs.readFileSync(path.join(EXAMPLE, name));
	const buf = new Uint8Array(file.byteLength);
	buf.set(file);
	return { buffer: buf.buffer, parsed: parseBundle(buf.buffer) };
};

describe('twinBundleId', () => {
	it('swaps the _AT / _GR half and keeps the extension', () => {
		expect(twinBundleId('VEH_PUSSC01_AT.BIN', 'GR')).toBe('VEH_PUSSC01_GR.BIN');
		expect(twinBundleId('VEH_PUSSC01_GR.BIN', 'AT')).toBe('VEH_PUSSC01_AT.BIN');
		expect(twinBundleId('veh_alien_gr.bin', 'AT')).toBe('veh_alien_AT.bin');
	});

	it('returns null for bundles not named like a car half', () => {
		expect(twinBundleId('VEHICLETEX.BIN', 'AT')).toBeNull();
		expect(twinBundleId('WORLDCOL.BIN', 'GR')).toBeNull();
	});
});

describe('pickTwin', () => {
	const ids = (...xs: string[]) => xs.map((id) => ({ id }));
	const candidates = ids('VEH_ALIEN_AT.BIN', 'VEH_PUSSC01_AT.BIN');

	it('prefers an explicit choice', () => {
		expect(pickTwin(candidates, 'VEH_PUSSC01_GR.BIN', 'AT', 'VEH_ALIEN_AT.BIN')?.id).toBe('VEH_ALIEN_AT.BIN');
	});

	it('then the same-named twin, ignoring case', () => {
		expect(pickTwin(candidates, 'veh_pussc01_gr.bin', 'AT')?.id).toBe('VEH_PUSSC01_AT.BIN');
	});

	it('then the first candidate, so a mod body can borrow any spec', () => {
		expect(pickTwin(candidates, 'VEH_MYMOD_GR.BIN', 'AT')?.id).toBe('VEH_ALIEN_AT.BIN');
		expect(pickTwin(candidates, 'VEH_MYMOD_GR.BIN', 'AT', 'gone.bin')?.id).toBe('VEH_ALIEN_AT.BIN');
	});

	it('is undefined with no candidates', () => {
		expect(pickTwin([], 'VEH_PUSSC01_GR.BIN', 'AT')).toBeUndefined();
	});
});

describe('crashSpecFor', () => {
	const gr = load('VEH_CARBRWDS_GR.BIN').parsed;
	const at = load('VEH_CARBRWDS_AT.BIN').parsed;
	const spec = makeSpec();
	const other = makeSpec();
	const bundle = (id: string, parsed: ParsedBundle, resources: [string, unknown][] = []): CrashBundle =>
		({ id, parsed, parsedResources: new Map(resources) });
	const body = bundle('VEH_CARBRWDS_GR.BIN', gr);
	const twin = bundle('VEH_CARBRWDS_AT.BIN', at, [['deformationSpec', spec]]);
	const donor = bundle('VEH_DONOR_AT.BIN', at, [['deformationSpec', other]]);
	const textures = bundle('VEHICLETEX.BIN', at);

	it('pairs a body with its _AT twin among the bundles holding a spec', () => {
		const r = crashSpecFor(body, [donor, body, textures, twin]);
		expect(r.candidates.map((b) => b.id)).toEqual(['VEH_DONOR_AT.BIN', 'VEH_CARBRWDS_AT.BIN']);
		expect(r.picked).toBe(twin);
		expect(r.spec).toBe(spec);
	});

	it('honours an explicit pick', () => {
		expect(crashSpecFor(body, [donor, body, twin], 'VEH_DONOR_AT.BIN').spec).toBe(other);
	});

	it('offers nothing for a bundle without a GraphicsSpec, or with no spec loaded', () => {
		expect(crashSpecFor(twin, [body, twin, donor]).spec).toBeNull();
		expect(crashSpecFor(body, [body, textures]).candidates).toEqual([]);
		expect(crashSpecFor(null, [twin]).spec).toBeNull();
	});
});

describe('crashTestAvailable', () => {
	const body = (skinRows: number) => ({ skinRows }) as CrashBody;
	it('needs a spec and a body whose meshes read deformation rows', () => {
		expect(crashTestAvailable(makeSpec(), body(97))).toBe(true);
		expect(crashTestAvailable(makeSpec(), body(0))).toBe(false);
		expect(crashTestAvailable(null, body(97))).toBe(false);
	});

	it('still offers it before the body is decoded per part', () => {
		expect(crashTestAvailable(makeSpec(), null)).toBe(true);
	});
});

describe('specRows', () => {
	it('counts the leading skinned tag points plus every driven point', () => {
		// fixture: tags 0-4 skinned, 5-8 wheel tags unskinned; one driven point.
		expect(specRows(makeSpec())).toBe(5 + 1);
	});

	it('stops the tag run at the first unskinned tag', () => {
		const spec = makeSpec();
		spec.tagPoints[2].skinnedPoint = false;
		expect(specRows(spec)).toBe(2 + 1);
	});
});

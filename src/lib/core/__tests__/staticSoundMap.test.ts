// Gold coverage for parseStaticSoundMap / writeStaticSoundMap /
// rebucketStaticSoundMap.
//
// Every track unit carries TWO StaticSoundMap resources (emitter + passby) but
// the auto-generated registry fixture suite only exercises the first resource
// of a type per bundle — so this suite walks BOTH, pins hand-verified decoded
// values from TRK_UNIT100, and covers the empty-map shape (TRK_UNIT0) that the
// handler's entities[0] stress scenarios can't run on.
//
// The rebucket suite pins the reverse-engineered retail bucketing convention
// (see rebucketStaticSoundMap's header comment) with synthetic models, then
// proves it against the full retail corpus: when example/ has the TRK_UNIT
// bundles, every StaticSoundMap in every parseable bundle must satisfy
// write(rebucket(parse(raw))) === raw byte-for-byte.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseStaticSoundMap,
	writeStaticSoundMap,
	rebucketStaticSoundMap,
	staticSoundMapCellIndex,
	PASSBY_TYPES,
	type ParsedStaticSoundMap,
	type StaticSoundEntity,
} from '../staticSoundMap';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const STATIC_SOUND_MAP_TYPE_ID = 0x10016;

type ExtractedMap = { name: string; raw: Uint8Array };

function loadMaps(bundleFile: string): ExtractedMap[] {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const debugResources = typeof bundle.debugData === 'string'
		? parseDebugDataFromXml(bundle.debugData)
		: [];
	return bundle.resources
		.filter((r) => r.resourceTypeId === STATIC_SOUND_MAP_TYPE_ID)
		.map((r) => ({
			name: findDebugResourceById(debugResources, r.resourceId.low.toString(16))?.name ?? '?',
			raw: extractResourceRaw(buffer, bundle, r),
		}));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

describe('StaticSoundMap gold values (example/TRK_UNIT100_GR.BNDL)', () => {
	const maps = loadMaps('example/TRK_UNIT100_GR.BNDL');

	it('finds exactly two maps, emitter first, named by role', () => {
		expect(maps.length).toBe(2);
		expect(maps[0].name).toBe('TRK_UNIT100_Emitter');
		expect(maps[1].name).toBe('TRK_UNIT100_Passby');
	});

	it('decodes the emitter map', () => {
		const m = parseStaticSoundMap(maps[0].raw);
		expect(m.mMin).toEqual({ x: 3400, y: -500 });
		expect(m.mMax).toEqual({ x: 3450, y: -350 });
		expect(m.mfSubRegionSize).toBe(50);
		expect(m.miNumSubRegionsX).toBe(1);
		expect(m.miNumSubRegionsZ).toBe(3);
		expect(m.entities.length).toBe(2);
		// Emitter semantics: muTypeOrDistance is the audible distance in metres.
		expect(m.entities[0].mPosition.x).toBeCloseTo(3417.8, 1);
		expect(m.entities[0].mPosition.y).toBeCloseTo(-32.9, 1);
		expect(m.entities[0].mPosition.z).toBeCloseTo(-458.2, 1);
		expect(m.entities[0].muTypeOrDistance).toBe(86);
		expect(m.entities[0].muSoundIndex).toBe(14);
		// rootType is 0 even though this is the emitter map — the role only
		// exists in the debug name. Pin it so a "fix" trusting it gets caught.
		expect(m.meRootType).toBe(0);
	});

	it('decodes the passby map', () => {
		const m = parseStaticSoundMap(maps[1].raw);
		expect(m.miNumSubRegionsX).toBe(4);
		expect(m.miNumSubRegionsZ).toBe(8);
		expect(m.entities.length).toBe(24);
		// Passby semantics: muTypeOrDistance indexes PASSBY_TYPES.
		expect(m.entities[0].muTypeOrDistance).toBe(12);
		expect(PASSBY_TYPES[m.entities[0].muTypeOrDistance]).toBe('Collision');
		expect(m.entities[0].muSoundIndex).toBe(7);
		expect(m.subRegions.length).toBe(4 * 8);
		expect(m.subRegions[0]).toEqual({ mi16First: 0, mi16Count: 2 });
	});

	it('subregion runs exactly cover the entity array', () => {
		for (const { raw } of maps) {
			const m = parseStaticSoundMap(raw);
			let covered = 0;
			for (const cell of m.subRegions) {
				if (cell.mi16First >= 0) covered += cell.mi16Count;
				else expect(cell.mi16Count).toBe(0);
			}
			expect(covered).toBe(m.entities.length);
		}
	});
});

describe('StaticSoundMap empty maps (example/TRK_UNIT0_GR.BNDL)', () => {
	const maps = loadMaps('example/TRK_UNIT0_GR.BNDL');

	it('parses the empty shape: 1x1 grid, no entities, [-1,0] cell', () => {
		expect(maps.length).toBe(2);
		for (const { raw } of maps) {
			const m = parseStaticSoundMap(raw);
			expect(m.entities.length).toBe(0);
			expect(m.miNumSubRegionsX).toBe(1);
			expect(m.miNumSubRegionsZ).toBe(1);
			expect(m.subRegions).toEqual([{ mi16First: -1, mi16Count: 0 }]);
			// Empty maps keep valid offsets (header 0x40 + 4-byte grid → pad to
			// 0x50), unlike the null-pointer shape empty prop zones use.
			expect(m._trailingPad.byteLength).toBe(0x50 - 0x44);
		}
	});
});

describe('StaticSoundMap round-trip', () => {
	const bundles = [
		'example/TRK_UNIT100_GR.BNDL',
		'example/TRK_UNIT380_GR.BNDL',
		'example/TRK_UNIT0_GR.BNDL',
	];

	for (const bundleFile of bundles) {
		it(`round-trips both maps of ${bundleFile} byte-for-byte`, () => {
			for (const { name, raw } of loadMaps(bundleFile)) {
				const rewritten = writeStaticSoundMap(parseStaticSoundMap(raw));
				expect(rewritten.byteLength, name).toBe(raw.byteLength);
				expect(bytesEqual(rewritten, raw), name).toBe(true);
			}
		});
	}

	it('writer rejects a subregion array inconsistent with the grid dims', () => {
		const m = parseStaticSoundMap(loadMaps(bundles[0])[0].raw);
		const broken = { ...m, subRegions: m.subRegions.slice(0, -1) };
		expect(() => writeStaticSoundMap(broken)).toThrow(/subregions/);
	});
});

// =============================================================================
// rebucketStaticSoundMap — retail convention pins (synthetic models)
// =============================================================================

function ent(x: number, y: number, z: number, type = 0, sound = 0): StaticSoundEntity {
	return { mPosition: { x, y, z }, muTypeOrDistance: type, muSoundIndex: sound };
}

// A deliberately stale model: 1x1 grid that does NOT cover the entities, so
// every grid field must come out of the rebucket, not the input.
function staleModel(entities: StaticSoundEntity[]): ParsedStaticSoundMap {
	return {
		mMin: { x: 0, y: 0 },
		mMax: { x: 50, y: 50 },
		_minLanes23: { x: 0, y: 0 },
		_maxLanes23: { x: 0, y: 0 },
		mfSubRegionSize: 50,
		miNumSubRegionsX: 1,
		miNumSubRegionsZ: 1,
		subRegions: [{ mi16First: -1, mi16Count: 0 }],
		entities,
		meRootType: 0,
		_pad3C: 0,
		_trailingPad: new Uint8Array(0),
	};
}

describe('rebucketStaticSoundMap convention', () => {
	it('snaps bounds to cell multiples and sizes the grid from them', () => {
		const m = rebucketStaticSoundMap(staleModel([ent(3417.8, -32.9, -458.2), ent(3437.5, -30, -360.7)]));
		expect(m.mMin).toEqual({ x: 3400, y: -500 });
		expect(m.mMax).toEqual({ x: 3450, y: -350 });
		expect(m.miNumSubRegionsX).toBe(1);
		expect(m.miNumSubRegionsZ).toBe(3);
		expect(m.subRegions.length).toBe(3);
	});

	it('orders the flat grid X-fastest (index = cellZ * numX + cellX)', () => {
		// E1 in cell (cx 1, cz 0) -> flat 1; E2 in cell (cx 0, cz 1) -> flat 2.
		// Passed in reverse, rebucket must sort E1 before E2.
		const e1 = ent(75, 0, 10, 1);
		const e2 = ent(10, 0, 75, 2);
		const m = rebucketStaticSoundMap(staleModel([e2, e1]));
		expect(m.miNumSubRegionsX).toBe(2);
		expect(m.miNumSubRegionsZ).toBe(2);
		expect(m.entities.map((e) => e.muTypeOrDistance)).toEqual([1, 2]);
		expect(m.subRegions).toEqual([
			{ mi16First: -1, mi16Count: 0 },
			{ mi16First: 0, mi16Count: 1 },
			{ mi16First: 1, mi16Count: 1 },
			{ mi16First: -1, mi16Count: 0 },
		]);
	});

	it('keeps relative order within a cell (stable bucketing)', () => {
		const m = rebucketStaticSoundMap(staleModel([ent(40, 0, 40, 1), ent(5, 0, 5, 2), ent(20, 0, 20, 3)]));
		expect(m.miNumSubRegionsX).toBe(1);
		expect(m.miNumSubRegionsZ).toBe(1);
		expect(m.entities.map((e) => e.muTypeOrDistance)).toEqual([1, 2, 3]);
		expect(m.subRegions).toEqual([{ mi16First: 0, mi16Count: 3 }]);
	});

	it('puts an entity exactly on an interior cell boundary in the LOWER cell (TRK_UNIT114 convention)', () => {
		// Grid z rows: min -250. z=0 sits on the row-4/row-5 boundary; retail
		// buckets it into row 4. The z=20 entity forces a row 5 to exist so
		// this pin can't be satisfied by edge clamping.
		const low = ent(10, 0, -240, 1);
		const boundary = ent(10, 0, 0, 2);
		const above = ent(10, 0, 20, 3);
		const m = rebucketStaticSoundMap(staleModel([low, boundary, above]));
		expect(m.miNumSubRegionsZ).toBe(6);
		const cellOfBoundary = staticSoundMapCellIndex(m, boundary.mPosition);
		expect(cellOfBoundary).toBe(4 * m.miNumSubRegionsX); // cz 4, cx 0
		expect(m.subRegions[cellOfBoundary]).toEqual({ mi16First: 1, mi16Count: 1 });
	});

	it('clamps an entity exactly at the grid min into cell 0', () => {
		// z = -250 == mMin.y: the boundary-to-lower rule gives cell -1, which
		// clamps to 0 (retail does the same for its z=0-at-min entities).
		const m = rebucketStaticSoundMap(staleModel([ent(10, 0, -250, 1), ent(10, 0, -190, 2)]));
		expect(m.mMin.y).toBe(-250);
		expect(m.subRegions[0]).toEqual({ mi16First: 0, mi16Count: 1 });
	});

	it('preserves IEEE -0 on a ceil-snapped max (TRK_UNIT17/56/234 convention)', () => {
		const m = rebucketStaticSoundMap(staleModel([ent(10, 0, -42.5), ent(30, 0, -8.05)]));
		// ceil(-8.05 / 50) * 50 is negative zero, and the sign bit is on disk.
		expect(Object.is(m.mMax.y, -0)).toBe(true);
		const bytes = writeStaticSoundMap(m);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		expect(view.getUint32(0x14, true)).toBe(0x80000000); // mMax z lane: -0.0f
	});

	it('produces the canonical empty shape for zero entities', () => {
		const m = rebucketStaticSoundMap(staleModel([]));
		expect(m.mMin).toEqual({ x: 0, y: 0 });
		expect(m.mMax).toEqual({ x: 50, y: 50 });
		expect(m.miNumSubRegionsX).toBe(1);
		expect(m.miNumSubRegionsZ).toBe(1);
		expect(m.subRegions).toEqual([{ mi16First: -1, mi16Count: 0 }]);
		// header 0x40 + one 4-byte cell -> 0x44, zero-padded to 0x50.
		expect(m._trailingPad.byteLength).toBe(12);
		expect(writeStaticSoundMap(m).byteLength).toBe(0x50);
	});

	it('extends a degenerate axis (all entities on one exact multiple of the cell size) to one cell', () => {
		// floor and ceil agree at x=100, which would make a 0-wide grid; not
		// observed in retail, extended to a single valid cell.
		const m = rebucketStaticSoundMap(staleModel([ent(100, 0, 10, 1), ent(100, 0, 30, 2)]));
		expect(m.miNumSubRegionsX).toBe(1);
		expect(m.mMin.x).toBe(100);
		expect(m.mMax.x).toBe(150);
		expect(m.subRegions).toEqual([{ mi16First: 0, mi16Count: 2 }]);
	});

	it('recomputes the trailing pad for the new payload length', () => {
		const m = rebucketStaticSoundMap(staleModel([ent(10, 0, 10)]));
		const bytes = writeStaticSoundMap(m);
		expect(bytes.byteLength % 16).toBe(0);
		// header 0x40 + 1 entity 0x10 + 1 cell 0x4 = 0x54 -> pad to 0x60.
		expect(bytes.byteLength).toBe(0x60);
	});

	it('is idempotent', () => {
		const once = rebucketStaticSoundMap(staleModel([ent(75, 0, 10, 1), ent(10, 0, 75, 2), ent(-20, 0, -340, 3)]));
		const twice = rebucketStaticSoundMap(once);
		expect(twice).toEqual(once);
		expect(bytesEqual(writeStaticSoundMap(twice), writeStaticSoundMap(once))).toBe(true);
	});

	it('throws on non-finite positions, absurd coordinates, and int16 overflow', () => {
		expect(() => rebucketStaticSoundMap(staleModel([ent(NaN, 0, 10)]))).toThrow(/non-finite/);
		expect(() => rebucketStaticSoundMap(staleModel([ent(0, 0, 0), ent(1e9, 0, 1e9)]))).toThrow(/corrupt/);
		const tooMany = Array.from({ length: 0x8000 }, () => ent(10, 0, 10));
		expect(() => rebucketStaticSoundMap(staleModel(tooMany))).toThrow(/int16/);
		expect(() => rebucketStaticSoundMap({ ...staleModel([]), mfSubRegionSize: 0 })).toThrow(/cell size/);
	});

	it('passes verbatim fields through untouched', () => {
		const base = { ...staleModel([ent(10, 0, 10)]), meRootType: 1, _pad3C: 0xdeadbeef, _minLanes23: { x: 1, y: 2 } };
		const m = rebucketStaticSoundMap(base);
		expect(m.meRootType).toBe(1);
		expect(m._pad3C).toBe(0xdeadbeef);
		expect(m._minLanes23).toEqual({ x: 1, y: 2 });
	});
});

// =============================================================================
// Edit-then-rebucket round-trips on real fixtures
// =============================================================================

describe('rebucket after entity edits (example/TRK_UNIT100_GR.BNDL)', () => {
	const maps = loadMaps('example/TRK_UNIT100_GR.BNDL');

	function writeParseWriteStable(m: ParsedStaticSoundMap): ParsedStaticSoundMap {
		const written = writeStaticSoundMap(rebucketStaticSoundMap(m));
		const reparsed = parseStaticSoundMap(written);
		// Byte-exact round-trip AFTER rebucketing: a rebucketed model is a
		// fixed point, so the next write must reproduce the same bytes.
		expect(bytesEqual(writeStaticSoundMap(rebucketStaticSoundMap(reparsed)), written)).toBe(true);
		return reparsed;
	}

	function expectGridConsistent(m: ParsedStaticSoundMap) {
		let next = 0;
		m.subRegions.forEach((cell, ci) => {
			if (cell.mi16First === -1) {
				expect(cell.mi16Count).toBe(0);
				return;
			}
			expect(cell.mi16First).toBe(next);
			for (let j = cell.mi16First; j < cell.mi16First + cell.mi16Count; j++) {
				expect(staticSoundMapCellIndex(m, m.entities[j].mPosition)).toBe(ci);
			}
			next = cell.mi16First + cell.mi16Count;
		});
		expect(next).toBe(m.entities.length);
	}

	it('add-entity: grid grows to cover a sound placed outside the old bounds', () => {
		for (const { raw } of maps) {
			const m = parseStaticSoundMap(raw);
			const added = ent(m.mMax.x + 75, 12, m.mMin.y - 75, 5, 3);
			const after = writeParseWriteStable({ ...m, entities: [...m.entities, added] });
			expect(after.entities.length).toBe(m.entities.length + 1);
			expect(after.mMax.x).toBeGreaterThanOrEqual(added.mPosition.x);
			expect(after.mMin.y).toBeLessThanOrEqual(added.mPosition.z);
			expectGridConsistent(after);
		}
	});

	it('remove-entity: dropping entities[0] without touching the grid stays consistent', () => {
		for (const { raw } of maps) {
			const m = parseStaticSoundMap(raw);
			if (m.entities.length === 0) continue;
			const after = writeParseWriteStable({ ...m, entities: m.entities.slice(1) });
			expect(after.entities.length).toBe(m.entities.length - 1);
			expectGridConsistent(after);
		}
	});

	it('move-entity-across-cells: a sound dragged past the far corner lands in the right run', () => {
		for (const { raw } of maps) {
			const m = parseStaticSoundMap(raw);
			if (m.entities.length === 0) continue;
			const entities = m.entities.slice();
			const moved = { ...entities[0], mPosition: { x: m.mMax.x + 125, y: entities[0].mPosition.y, z: m.mMax.y + 125 } };
			entities[0] = moved;
			const after = writeParseWriteStable({ ...m, entities });
			const found = after.entities.filter((e) => e.mPosition.x === moved.mPosition.x && e.mPosition.z === moved.mPosition.z);
			expect(found.length).toBe(1);
			expectGridConsistent(after);
		}
	});

	it('remove-all-entities: collapses to the canonical empty shape', () => {
		for (const { raw } of maps) {
			const m = parseStaticSoundMap(raw);
			const after = writeParseWriteStable({ ...m, entities: [] });
			expect(after.entities.length).toBe(0);
			expect(after.mMin).toEqual({ x: 0, y: 0 });
			expect(after.mMax).toEqual({ x: 50, y: 50 });
			expect(after.subRegions).toEqual([{ mi16First: -1, mi16Count: 0 }]);
		}
	});
});

// =============================================================================
// Gold sweep — rebucket must be the identity on the entire retail corpus
// =============================================================================

describe('rebucket retail sweep (example/TRK_UNIT*_GR.BNDL)', () => {
	const exampleDir = path.resolve(REPO_ROOT, 'example');
	const trkBundles = fs.existsSync(exampleDir)
		? fs.readdirSync(exampleDir).filter((f) => /^TRK_UNIT\d+_GR\.BNDL$/.test(f)).sort()
		: [];

	// TRK_UNIT192_GR.BNDL fails at the BUNDLE level ('invalid stored block
	// lengths' during decompression) — a pre-existing envelope issue unrelated
	// to StaticSoundMap, so the sweep tolerates bundle-parse failures but
	// reports them, pinning that only this one exists.
	const KNOWN_UNPARSEABLE_BUNDLES = ['TRK_UNIT192_GR.BNDL'];

	it.skipIf(trkBundles.length === 0)(
		'write(rebucket(parse(raw))) is byte-identical to raw for every retail StaticSoundMap',
		() => {
			let checked = 0;
			const failures: string[] = [];
			const unparseable: string[] = [];
			// parseBundle logs stats per bundle; silence it for the 427-bundle sweep.
			const realLog = console.log;
			console.log = () => {};
			try {
				for (const file of trkBundles) {
					const buf = fs.readFileSync(path.join(exampleDir, file));
					const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
					let bundle;
					try {
						bundle = parseBundle(buffer, { strict: false });
					} catch {
						unparseable.push(file);
						continue;
					}
					for (const r of bundle.resources) {
						if (r.resourceTypeId !== STATIC_SOUND_MAP_TYPE_ID) continue;
						const raw = extractResourceRaw(buffer, bundle, r);
						const rewritten = writeStaticSoundMap(rebucketStaticSoundMap(parseStaticSoundMap(raw)));
						if (!bytesEqual(rewritten, raw)) failures.push(`${file} resource ${r.resourceId.low.toString(16)}`);
						checked++;
					}
				}
			} finally {
				console.log = realLog;
			}
			expect(unparseable).toEqual(KNOWN_UNPARSEABLE_BUNDLES);
			expect(failures).toEqual([]);
			// 427 parseable bundles x 2 maps each.
			expect(checked).toBe(854);
		},
		600_000,
	);
});

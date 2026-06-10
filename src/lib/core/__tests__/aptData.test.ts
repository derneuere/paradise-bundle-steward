// Gold coverage for parseAptData / writeAptData (resource type 0x1E).
//
// Pins hand-verified decoded values from the four GUIAPT fixtures, the
// byte-exact round-trip + writer idempotence bar, the wiki divergences the
// probe found (miTextureId is NOT an import index; mpTexture holds a cookie,
// not a pointer), and the cross-resource fact that every imported id is a
// sibling Texture (0x0) resource in the same bundle.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseAptData,
	writeAptData,
	aptDataImportTable,
	countAptTextureImports,
	APT_TEXTURE_MODE_VECTOR,
	APT_UNTEXTURED_TEXTURE_ID,
} from '../aptData';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const APT_DATA_TYPE_ID = 0x1e;
const TEXTURE_TYPE_ID = 0x0;

type Loaded = {
	raw: Uint8Array;
	importOffset: number;
	importCount: number;
	siblingTextureIds: Set<string>;
};

function loadApt(bundleFile: string): Loaded {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const apt = bundle.resources.find((r) => r.resourceTypeId === APT_DATA_TYPE_ID);
	if (!apt) throw new Error(`${bundleFile}: no 0x1E resource`);
	const siblingTextureIds = new Set(
		bundle.resources
			.filter((r) => r.resourceTypeId === TEXTURE_TYPE_ID)
			.map((r) => ((BigInt(r.resourceId.high) << 32n) | BigInt(r.resourceId.low)).toString(16)),
	);
	return {
		raw: extractResourceRaw(buffer, bundle, apt),
		importOffset: apt.importOffset,
		importCount: apt.importCount,
		siblingTextureIds,
	};
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const FIXTURES = [
	'example/GUIAPT/B5ACHIEVEMENTICONS.BUNDLE',
	'example/GUIAPT/B5ACHIEVEMENTPOPUPCOMPONENT.BUNDLE',
	'example/GUIAPT/B5ALWAYSAVAILABLECONTAINER.BUNDLE',
	'example/GUIAPT/B5BIKEICONS.BUNDLE',
];

describe('AptData gold values (example/GUIAPT/B5BIKEICONS.BUNDLE)', () => {
	const { raw } = loadApt('example/GUIAPT/B5BIKEICONS.BUNDLE');
	const m = parseAptData(raw);

	it('decodes both component names — the only fixture where they differ', () => {
		expect(m.movieName).toBe('B5BikeIcons');
		// The base component this movie was authored from; stored FIRST in the
		// file even though mpacMovieName is the header's first pointer.
		expect(m.baseName).toBe('B5CarsIcon');
	});

	it('decodes the header scalars', () => {
		expect(m.meCurrentState).toBe(0); // Loading — runtime advances it
		expect(m._pad1C).toBe(0);
		expect(m.pMainCharacter).toBe(0x1bc); // apt-blob-relative
	});

	it('keeps the Apt movie verbatim, tagged "Apt Data:1:7:4"', () => {
		expect(m._aptData.length).toBe(2208);
		expect(new TextDecoder().decode(m._aptData.subarray(0, 14))).toBe('Apt Data:1:7:4');
		expect(m._aptData[14]).toBe(0x1a);
	});

	it('decodes the geometry tree: 5 files with odd shape-character ids', () => {
		expect(m.geometryFiles.map((f) => f.muID)).toEqual([5, 7, 9, 11, 13]);
		expect(m.geometryFiles.every((f) => f.meshes.length === 1)).toBe(true);
		expect(m.muNumberOfTexturePages).toBe(1);
	});

	it('decodes the vector mesh: mode 0, sentinel texture id 6969, no import', () => {
		const mesh = m.geometryFiles[0].meshes[0];
		expect(mesh.miMeshType).toBe(0); // triangle list
		expect(mesh.miTextureMode).toBe(APT_TEXTURE_MODE_VECTOR);
		expect(mesh.miTextureId).toBe(APT_UNTEXTURED_TEXTURE_ID);
		expect(mesh.textureResourceId).toBeNull();
		expect(mesh._mpTexture).toBe(0);
	});

	it('decodes vertices: 2D pos, RGBA8 colour, UV', () => {
		const v = m.geometryFiles[0].meshes[0].vertices[0];
		expect(m.geometryFiles[0].meshes[0].vertices.length).toBe(6);
		expect(v.mv2Pos).toEqual({ x: -80, y: 50 });
		expect(v.mColour).toBe(0xff0000ff);
		expect(v.mv2Tex0UV).toEqual({ x: 0, y: 0 });
	});

	it('binds all four textured meshes to the single sibling texture', () => {
		const textured = m.geometryFiles.flatMap((f) => f.meshes).filter((x) => x.miTextureMode !== APT_TEXTURE_MODE_VECTOR);
		expect(textured.length).toBe(4);
		for (const mesh of textured) expect(mesh.textureResourceId).toBe(0xa118c370n);
		// Wiki divergence: miTextureId is documented as a 1-based import index,
		// but walk order here carries ids 4,3,2,1 against entries 0,1,2,3 — it
		// is the bitmap character id, not an index into the import table.
		expect(textured.map((x) => x.miTextureId)).toEqual([4, 3, 2, 1]);
		// mpTexture cookie is 1 (single texture page), not a pointer.
		for (const mesh of textured) expect(mesh._mpTexture).toBe(1);
	});

	it('retail stores zero Apt constants', () => {
		expect(m.nConstants).toBe(0);
		expect(m._constTail.length).toBe(0);
	});
});

describe('AptData gold values (example/GUIAPT/B5ACHIEVEMENTICONS.BUNDLE)', () => {
	const { raw, siblingTextureIds } = loadApt('example/GUIAPT/B5ACHIEVEMENTICONS.BUNDLE');
	const m = parseAptData(raw);

	it('decodes the large movie: 64 files, 3 texture pages, 64 imports', () => {
		expect(m.movieName).toBe('B5AchievementIcons');
		expect(m.baseName).toBe('B5AchievementIcons');
		expect(m.geometryFiles.length).toBe(64);
		expect(m.muNumberOfTexturePages).toBe(3);
		expect(countAptTextureImports(m)).toBe(64);
		expect(m.pMainCharacter).toBe(0x1614);
		expect(m._aptData.length).toBe(26176);
	});

	it('pins the first mesh of the first geometry file', () => {
		const f0 = m.geometryFiles[0];
		expect(f0.muID).toBe(65);
		const mesh = f0.meshes[0];
		expect(mesh.miTextureMode).toBe(1); // textured, clamp
		expect(mesh.miTextureId).toBe(37);
		expect(mesh._mpTexture).toBe(2);
		expect(mesh.textureResourceId).toBe(0x7edf591fn);
		const v = mesh.vertices[0];
		expect(v.mv2Pos).toEqual({ x: -31, y: 30 });
		expect(v.mColour).toBe(0xffffffff);
		expect(v.mv2Tex0UV).toEqual({ x: 0.1796875, y: 0.720703125 });
	});

	it('every imported texture id is a sibling Texture resource of this bundle', () => {
		const imported = new Set<string>();
		for (const f of m.geometryFiles) {
			for (const mesh of f.meshes) {
				if (mesh.textureResourceId != null) imported.add(mesh.textureResourceId.toString(16));
			}
		}
		// Distinct page count matches muNumberOfTexturePages.
		expect(imported.size).toBe(m.muNumberOfTexturePages);
		for (const id of imported) expect(siblingTextureIds.has(id)).toBe(true);
	});
});

describe('AptData gold values (example/GUIAPT/B5ALWAYSAVAILABLECONTAINER.BUNDLE)', () => {
	const { raw } = loadApt('example/GUIAPT/B5ALWAYSAVAILABLECONTAINER.BUNDLE');

	it('parses the geometry-less shape: 0 files, 0 imports, 256-byte payload', () => {
		expect(raw.byteLength).toBe(256);
		const m = parseAptData(raw);
		expect(m.movieName).toBe('B5AlwaysAvailableContainer');
		expect(m.geometryFiles.length).toBe(0);
		expect(m.muNumberOfTexturePages).toBe(0);
		expect(countAptTextureImports(m)).toBe(0);
		expect(m._aptData.length).toBe(112);
		expect(m.pMainCharacter).toBe(0x14);
	});
});

describe('AptData round-trip', () => {
	for (const fixture of FIXTURES) {
		it(`round-trips ${fixture} byte-for-byte, idempotently`, () => {
			const { raw } = loadApt(fixture);
			const out = writeAptData(parseAptData(raw));
			expect(out.byteLength).toBe(raw.byteLength);
			expect(bytesEqual(out, raw)).toBe(true);
			const out2 = writeAptData(parseAptData(out));
			expect(bytesEqual(out2, out)).toBe(true);
		});
	}

	it('survives renaming the movie longer AND shorter — all later sections shift', () => {
		const { raw } = loadApt('example/GUIAPT/B5ACHIEVEMENTPOPUPCOMPONENT.BUNDLE');
		const m = parseAptData(raw);
		for (const name of ['B5AchievementPopupComponentWithAMuchLongerName', 'B5X']) {
			const re = parseAptData(writeAptData({ ...m, movieName: name }));
			expect(re.movieName).toBe(name);
			expect(re.baseName).toBe(m.baseName);
			expect(re.geometryFiles.length).toBe(m.geometryFiles.length);
			expect(countAptTextureImports(re)).toBe(countAptTextureImports(m));
			expect(bytesEqual(re._aptData, m._aptData)).toBe(true);
		}
	});

	it('survives a vertex append — counts, pointers, and the import table all recompute', () => {
		const { raw } = loadApt('example/GUIAPT/B5BIKEICONS.BUNDLE');
		const m = parseAptData(raw);
		const mesh = m.geometryFiles[1].meshes[0];
		mesh.vertices.push({ mv2Pos: { x: 1, y: 2 }, mColour: 0xdeadbeef, mv2Tex0UV: { x: 0.5, y: 0.25 } });
		const re = parseAptData(writeAptData(m));
		const reMesh = re.geometryFiles[1].meshes[0];
		expect(reMesh.vertices.length).toBe(7);
		expect(reMesh.vertices[6].mColour).toBe(0xdeadbeef);
		expect(reMesh.textureResourceId).toBe(0xa118c370n);
	});
});

describe('AptData writer validation', () => {
	const { raw } = loadApt('example/GUIAPT/B5BIKEICONS.BUNDLE');

	it('rejects a textured mesh with no textureResourceId', () => {
		const m = parseAptData(raw);
		m.geometryFiles[1].meshes[0].textureResourceId = null;
		expect(() => writeAptData(m)).toThrow(/textured mesh/);
	});

	it('rejects a vector mesh carrying a textureResourceId', () => {
		const m = parseAptData(raw);
		m.geometryFiles[0].meshes[0].textureResourceId = 0x1234n;
		expect(() => writeAptData(m)).toThrow(/vector mesh/);
	});

	it('rejects a mangled Apt movie blob', () => {
		const m = parseAptData(raw);
		m._aptData = m._aptData.slice(16); // tag gone
		expect(() => writeAptData(m)).toThrow(/Apt Data:1:7:4/);
	});
});

describe('AptData inline import table (envelope metadata)', () => {
	for (const fixture of FIXTURES) {
		it(`importTable() matches the bundle envelope for ${fixture}`, () => {
			const { raw, importOffset, importCount } = loadApt(fixture);
			expect(aptDataImportTable(raw)).toEqual({ offset: importOffset, count: importCount });
		});
	}

	it('tracks the moved table after a payload-resizing edit', () => {
		const { raw } = loadApt('example/GUIAPT/B5BIKEICONS.BUNDLE');
		const m = parseAptData(raw);
		const out = writeAptData({ ...m, movieName: m.movieName + '_LONGER_NAME' });
		const t = aptDataImportTable(out);
		expect(t.count).toBe(4);
		expect(t.offset).toBeGreaterThan(aptDataImportTable(raw).offset);
		expect(t.offset + t.count * 16).toBe(out.byteLength);
	});
});

describe('AptData parser rigidity', () => {
	it('throws on a corrupted geometry pointer instead of mis-parsing', () => {
		const { raw } = loadApt('example/GUIAPT/B5BIKEICONS.BUNDLE');
		const broken = new Uint8Array(raw);
		const view = new DataView(broken.buffer);
		view.setUint32(0x910, 0x12345678, true); // file[0] pointer
		expect(() => parseAptData(broken)).toThrow(/file\[0\] pointer/);
	});

	it('throws on a truncated import table', () => {
		const { raw } = loadApt('example/GUIAPT/B5BIKEICONS.BUNDLE');
		expect(() => parseAptData(raw.subarray(0, raw.byteLength - 16))).toThrow(/import/);
	});
});

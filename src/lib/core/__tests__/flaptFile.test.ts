// Gold coverage for parseFlaptFile / writeFlaptFile (resource type 0x10020).
//
// Pins hand-verified decoded values from FLAPTHUD.BUNDLE (the only retail
// Flapt resource), the byte-exact round-trip + writer idempotence bar, the
// fixture facts the wiki does not state (0xB0 garbage fill, index cookies in
// the texture pointer array, import fixups targeting mpapTextures slots in
// slot order, the un-imported "special" slot), and the cross-resource fact
// that every imported id is a sibling Texture (0x0) resource.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseFlaptFile,
	writeFlaptFile,
	flaptFileImportTable,
	countFlaptTextureImports,
	FLAPT_VERSION,
} from '../flaptFile';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FLAPT_TYPE_ID = 0x10020;
const TEXTURE_TYPE_ID = 0x0;
const FIXTURE = 'example/FLAPTHUD.BUNDLE';

type Loaded = {
	raw: Uint8Array;
	importOffset: number;
	importCount: number;
	siblingTextureIds: Set<string>;
};

function loadFlapt(): Loaded {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, FIXTURE));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const res = bundle.resources.find((r) => r.resourceTypeId === FLAPT_TYPE_ID);
	if (!res) throw new Error(`${FIXTURE}: no 0x10020 resource`);
	const siblingTextureIds = new Set(
		bundle.resources
			.filter((r) => r.resourceTypeId === TEXTURE_TYPE_ID)
			.map((r) => ((BigInt(r.resourceId.high) << 32n) | BigInt(r.resourceId.low)).toString(16)),
	);
	return {
		raw: extractResourceRaw(buffer, bundle, res),
		importOffset: res.importOffset,
		importCount: res.importCount,
		siblingTextureIds,
	};
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const loaded = loadFlapt();
const m = parseFlaptFile(loaded.raw);

describe('FlaptFile gold values (example/FLAPTHUD.BUNDLE)', () => {
	it('decodes the header: version 12, 30 fps frame time', () => {
		expect(m.muVersion).toBe(FLAPT_VERSION);
		expect(m.mfTimePerFrame).toBe(Math.fround(1 / 30));
	});

	it('decodes every section count', () => {
		expect(loaded.raw.byteLength).toBe(1330160);
		expect(m.movieClips.length).toBe(560);
		expect(m.textures.length).toBe(53);
		expect(m.vertices.length).toBe(1650);
		expect(m.fontStyles.length).toBe(65);
		expect(m.components.length).toBe(429);
		expect(m.triggerParameters.length).toBe(75);
		expect(m.strings.length).toBe(356);
		expect(m.specialTextureNames.length).toBe(1);
		expect(m.debugStringCount).toBe(1582);
	});

	it('keeps the payload verbatim — garbage fill is 0xB0, not 0xCD', () => {
		expect(m._payload.byteLength).toBe(1330160);
		// Header pad after the u8 version byte.
		expect([m._payload[1], m._payload[2], m._payload[3]]).toEqual([0xb0, 0xb0, 0xb0]);
		// MovieClip[0] pad byte at +0x7 (clips start at 0x58).
		expect(m._payload[0x58 + 7]).toBe(0xb0);
	});

	it('pins HUD strings — the table is the on-screen text pool', () => {
		expect(m.strings[0]).toBe('');
		expect(m.strings[1]).toBe('$100');
		expect(m.strings[100]).toBe('Achievement Awarded (12 of 49)');
		expect(m.strings[355]).toBe('x');
	});

	it('pins font styles (name read-only, colour/height patchable)', () => {
		expect(m.fontStyles[0]).toEqual({ fontName: 'B5EAConDisSDrop', muColour: 0xffffffff, mfFontHeight: 20 });
		expect(m.fontStyles[5].fontName).toBe('MachineStd-BoldDrop');
		expect(m.fontStyles[5].mfFontHeight).toBe(55);
	});

	it('pins components: language hash + debug name + index path', () => {
		expect(m.components[0].muHash).toBe(0xe78ad201);
		expect(m.components[0].debugName).toBe('FriendListChange_mc');
		expect(m.components[0].pathIndices).toEqual([0, 0]);
		expect(m.components[2].debugName).toBe('SatNavIcon0_Icon');
		expect(m.components[2].pathIndices).toEqual([0, 1, 17]);
	});

	it('pins trigger parameters — EasyDrive lives here', () => {
		expect(m.triggerParameters[3]).toEqual({
			parameter0: 'RaceMainHUD',
			parameter1: 'ON_ENTER',
			parameter2: 'EasyDriveEntry',
			parameter3: null,
		});
	});

	it('decodes movie clip scalars and the rare component names', () => {
		const c0 = m.movieClips[0];
		expect(c0.componentName).toBeNull();
		expect(c0.muNumChildren).toBe(4);
		expect(c0.muNumFramesInTimeline).toBe(1);
		const c2 = m.movieClips[2];
		expect(c2.componentName).toBe('B5FriendListChangeIconComponent');
		expect(c2.mxFlags).toBe(1);
		expect(c2.muNumChildren).toBe(1);
		expect(c2.muNumMeshes).toBe(4);
		expect(c2.muNumRenderLayers).toBe(2);
		expect(c2.muNumLabelledFrames).toBe(4);
		expect(c2.muNumFScriptCommands).toBe(4);
		expect(c2.muNumFramesInTimeline).toBe(39);
		expect(c2.muNumKeyFrames).toBe(20);
		expect(m.movieClips.filter((c) => c.componentName != null).length).toBe(50);
	});

	it('pins vertices: 2D pos, RGBA8 colour, UV', () => {
		expect(m.vertices[0].mv2Pos).toEqual({ x: -30.5, y: -30.5 });
		expect(m.vertices[0].mColour).toBe(0xffffffff);
		expect(m.vertices[0].mv2Tex0UV).toEqual({ x: 0.5419921875, y: 0.1806640625 });
		expect(m.vertices[1649].mColour).toBe(0xff11b5f1);
	});

	it('binds import entries to texture slots in slot order; slot 52 is the special texture', () => {
		expect(countFlaptTextureImports(m)).toBe(52);
		expect(m.textures[0].resourceId).toBe(0xf2247a5an);
		expect(m.textures[51].resourceId).toBe(0x6ef569fen);
		expect(m.textures[52].resourceId).toBeNull();
		expect(m.specialTextureNames[0]).toBe('CustomComponentTexture.tif');
	});

	it('every imported texture id is a sibling Texture resource of this bundle', () => {
		let checked = 0;
		for (const t of m.textures) {
			if (t.resourceId == null) continue;
			expect(loaded.siblingTextureIds.has(t.resourceId.toString(16))).toBe(true);
			checked++;
		}
		expect(checked).toBe(52);
		expect(loaded.siblingTextureIds.size).toBe(52);
	});
});

describe('FlaptFile round-trip', () => {
	it('round-trips byte-for-byte, idempotently', () => {
		const out = writeFlaptFile(parseFlaptFile(loaded.raw));
		expect(out.byteLength).toBe(loaded.raw.byteLength);
		expect(bytesEqual(out, loaded.raw)).toBe(true);
		const out2 = writeFlaptFile(parseFlaptFile(out));
		expect(bytesEqual(out2, out)).toBe(true);
	});

	it('patches edits in place without disturbing un-decoded bytes', () => {
		const edited = parseFlaptFile(loaded.raw);
		edited.mfTimePerFrame = Math.fround(1 / 60);
		edited.vertices[0].mv2Pos = { x: 100, y: -200 };
		edited.vertices[0].mColour = 0x12345678;
		edited.fontStyles[3].muColour = 0xdeadbeef;
		edited.fontStyles[3].mfFontHeight = 99;
		edited.textures[7].resourceId = 0xcafef00dn;
		const out = writeFlaptFile(edited);
		expect(out.byteLength).toBe(loaded.raw.byteLength);

		const re = parseFlaptFile(out);
		expect(re.mfTimePerFrame).toBe(Math.fround(1 / 60));
		expect(re.vertices[0].mv2Pos).toEqual({ x: 100, y: -200 });
		expect(re.vertices[0].mColour).toBe(0x12345678);
		expect(re.fontStyles[3].muColour).toBe(0xdeadbeef);
		expect(re.fontStyles[3].mfFontHeight).toBe(99);
		expect(re.textures[7].resourceId).toBe(0xcafef00dn);

		// The 1.2 MB timeline region (after the texture pointer slot array,
		// before the import table) must be untouched by any of these edits.
		const view = new DataView(loaded.raw.buffer, loaded.raw.byteOffset, loaded.raw.byteLength);
		const ppTextures = view.getUint32(0x18, true);
		const timelineStart = ppTextures + 53 * 4 + 0x2000; // clear of the nearby string pools
		const muSize = view.getUint32(0x04, true);
		expect(bytesEqual(out.subarray(timelineStart, muSize), loaded.raw.subarray(timelineStart, muSize))).toBe(true);
		// Strings and clip structs also untouched.
		expect(re.strings[100]).toBe(m.strings[100]);
		expect(re.movieClips[2]).toEqual(m.movieClips[2]);
	});

	it('writer is pure — the input model\'s _payload is not mutated', () => {
		const model = parseFlaptFile(loaded.raw);
		const before = new Uint8Array(model._payload);
		model.mfTimePerFrame = 1;
		writeFlaptFile(model);
		expect(bytesEqual(model._payload, before)).toBe(true);
	});
});

describe('FlaptFile writer validation (counts are fixed — patch-only writes)', () => {
	it('rejects a changed vertex count', () => {
		const model = parseFlaptFile(loaded.raw);
		model.vertices.pop();
		expect(() => writeFlaptFile(model)).toThrow(/vertices length/);
	});

	it('rejects a resourceId on the special (un-imported) texture slot', () => {
		const model = parseFlaptFile(loaded.raw);
		model.textures[52].resourceId = 0x1234n;
		expect(() => writeFlaptFile(model)).toThrow(/special/);
	});

	it('rejects a null resourceId on an imported slot', () => {
		const model = parseFlaptFile(loaded.raw);
		model.textures[0].resourceId = null;
		expect(() => writeFlaptFile(model)).toThrow(/resourceId is null/);
	});
});

describe('FlaptFile inline import table (envelope metadata)', () => {
	it('importTable() matches the bundle envelope', () => {
		expect(flaptFileImportTable(loaded.raw)).toEqual({
			offset: loaded.importOffset,
			count: loaded.importCount,
		});
		expect(loaded.importCount).toBe(52);
		// muSizeInBytes excludes the import table, exactly like AptData.
		expect(loaded.importOffset + 52 * 16).toBe(loaded.raw.byteLength);
	});
});

describe('FlaptFile parser rigidity', () => {
	it('rejects an unsupported version byte', () => {
		const broken = new Uint8Array(loaded.raw);
		broken[0] = 11;
		expect(() => parseFlaptFile(broken)).toThrow(/muVersion 11/);
	});

	it('rejects a ragged import tail', () => {
		expect(() => parseFlaptFile(loaded.raw.subarray(0, loaded.raw.byteLength - 8))).toThrow(/import tail/);
	});

	it('rejects an import fixup that does not target a texture slot', () => {
		const broken = new Uint8Array(loaded.raw);
		const view = new DataView(broken.buffer);
		const importOffset = loaded.importOffset;
		view.setUint32(importOffset + 8, 0x10, true); // points at the header instead
		expect(() => parseFlaptFile(broken)).toThrow(/does not target a texture slot/);
	});

	it('rejects a corrupted section pointer instead of mis-parsing', () => {
		const broken = new Uint8Array(loaded.raw);
		const view = new DataView(broken.buffer);
		view.setUint32(0x20, 0xfef9e400, true); // mpaVerts -> stale-heap-style garbage
		expect(() => parseFlaptFile(broken)).toThrow(/vertices region/);
	});
});

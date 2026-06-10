// Gold coverage for parseVFXPropCollection / writeVFXPropCollection.
//
// One retail instance exists (vfx_props_collection in PARTICLES.BUNDLE). This
// suite pins hand-verified decoded values and the data facts the wiki does not
// document: nested references are element indices (not pointers), runs are
// strictly cumulative, and "no entries" is the 0xFFFFFFFF sentinel.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseVFXPropCollection, writeVFXPropCollection, VFX_NULL_INDEX, VFX_MATERIAL_TYPES } from '../vfxPropCollection';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const VFX_PROP_COLLECTION_TYPE_ID = 0x1001b;

function loadRaw(): Uint8Array {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, 'example/PARTICLES.BUNDLE'));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const resources = bundle.resources.filter((r) => r.resourceTypeId === VFX_PROP_COLLECTION_TYPE_ID);
	expect(resources.length).toBe(1);
	return new Uint8Array(extractResourceRaw(buffer, bundle, resources[0]));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const raw = loadRaw();
const model = parseVFXPropCollection(raw);

describe('VFXPropCollection gold values (example/PARTICLES.BUNDLE)', () => {
	it('decodes the header: version 3, six sequentially packed tables', () => {
		expect(model.muVersion).toBe(3);
		expect(model.props.length).toBe(247);
		expect(model.propStates.length).toBe(324);
		expect(model.materials.length).toBe(324);
		expect(model.locators.length).toBe(149);
		expect(model.coronas.length).toBe(13);
		expect(model.coronaTypeData.length).toBe(9);
		expect(model._headerPad.byteLength).toBe(0x0c);
		expect(model._headerPad.every((b) => b === 0)).toBe(true);
	});

	it('decodes props: GameDB ids with cumulative state runs of 1–2', () => {
		expect(model.props[0]).toEqual({ mPropID: 0xdee01c66n, mpPropStates: 0, muNumPropStates: 2 });
		expect(model.props[246]).toEqual({ mPropID: 0xbe67b5acn, mpPropStates: 322, muNumPropStates: 2 });
		let cum = 0;
		const histogram = new Map<number, number>();
		for (const p of model.props) {
			// mpPropStates is an ELEMENT INDEX into propStates (the wiki types it
			// as a pointer) and runs are grouped contiguously in owner order.
			expect(p.mpPropStates).toBe(cum);
			cum += p.muNumPropStates;
			histogram.set(p.muNumPropStates, (histogram.get(p.muNumPropStates) ?? 0) + 1);
			expect(p.mPropID >> 32n).toBe(0n);
		}
		expect(cum).toBe(model.propStates.length);
		expect(histogram.get(1)).toBe(170);
		expect(histogram.get(2)).toBe(77);
	});

	it('decodes states: exactly one material each; coronas use the null sentinel', () => {
		let cumMat = 0;
		let cumCor = 0;
		let coronaless = 0;
		for (const s of model.propStates) {
			expect(s.muNumVFXMaterials).toBe(1);
			expect(s.mpVFXMaterial).toBe(cumMat);
			cumMat += s.muNumVFXMaterials;
			if (s.muNumCoronas === 0) {
				expect(s.mpCoronaType).toBe(VFX_NULL_INDEX);
				coronaless++;
			} else {
				expect(s.mpCoronaType).toBe(cumCor);
				cumCor += s.muNumCoronas;
			}
		}
		expect(cumMat).toBe(model.materials.length);
		expect(cumCor).toBe(model.coronas.length);
		expect(coronaless).toBe(317);
	});

	it('decodes materials: retail uses 7 of the 16 eVFXMaterialType values', () => {
		let cumLoc = 0;
		const histogram = new Map<number, number>();
		for (const m of model.materials) {
			histogram.set(m.mType, (histogram.get(m.mType) ?? 0) + 1);
			if (m.muNumLocators === 0) {
				expect(m.mpLocators).toBe(VFX_NULL_INDEX);
			} else {
				expect(m.mpLocators).toBe(cumLoc);
				cumLoc += m.muNumLocators;
			}
		}
		expect(cumLoc).toBe(model.locators.length);
		expect([...histogram.entries()].sort((a, b) => a[0] - b[0])).toEqual([
			[1, 3],   // Foliage
			[2, 31],  // Metal
			[3, 3],   // Plastic
			[5, 13],  // Wood
			[6, 2],   // Water
			[9, 2],   // Billboard
			[14, 270], // None
		]);
		expect(VFX_MATERIAL_TYPES[14]).toBe('None');
	});

	it('decodes locators: prop-local positions and left-truncated .lef debug paths', () => {
		const l = model.locators[0];
		expect(l.mPosition.x).toBeCloseTo(0, 2);
		expect(l.mPosition.y).toBeCloseTo(-0.5, 2);
		expect(l.mPosition.z).toBeCloseTo(0.19, 2);
		expect(l.mHashedName).toBe(0xeaca55e3);
		// 59 chars — fills char[60] with exactly one terminating NUL.
		expect(l.macDebugLefName).toBe('Effects/PropGenericFx.lef.BurnoutFXLionEffectFile?ID=425809');
		// The truncation is FROM THE LEFT: this name lost its leading directories.
		expect(model.locators[1].macDebugLefName.startsWith('ut/Effects/')).toBe(true);
		for (const loc of model.locators) {
			expect(loc._posW).toBe(0);
			expect(new TextEncoder().encode(loc.macDebugLefName).length).toBeLessThanOrEqual(59);
		}
	});

	it('decodes coronas: presets referenced by element index, phase offsets 0 / 0.5', () => {
		const used = new Set<number>();
		for (const c of model.coronas) {
			expect(c.mTransform.length).toBe(16);
			expect(c.mpTypeData).toBeLessThan(model.coronaTypeData.length);
			used.add(c.mpTypeData);
			expect([0, 0.5]).toContain(c.mrTimeOffset);
			expect(c._pad48).toEqual([0, 0]);
		}
		expect([...used].sort((a, b) => a - b)).toEqual([0, 1, 7, 8]);
	});

	it('decodes corona type data: GameDB-id\'d flash presets, never synchronised in retail', () => {
		expect(model.coronaTypeData[0]).toMatchObject({ mnID: 558937, mType: 10, mrTimeOn: 0.5, mrTimeOff: 0.5 });
		expect(model.coronaTypeData[0].mrSizeMin).toBeCloseTo(0.4, 5);
		expect(model.coronaTypeData[0].mrSizeMax).toBeCloseTo(1.7, 5);
		expect(model.coronaTypeData[8]).toMatchObject({ mnID: 798815, mType: 2, mrSizeMin: 3, mrSizeMax: 3.5 });
		for (const d of model.coronaTypeData) {
			expect(d.mbSynchronised).toBe(false);
			expect(d.mrMasterTime).toBe(0);
			expect(d.mType).toBeLessThan(17);
			expect(d._pad1D).toEqual([0, 0, 0]);
		}
	});
});

describe('VFXPropCollection round-trip', () => {
	it('round-trips byte-for-byte', () => {
		const rewritten = writeVFXPropCollection(model);
		expect(rewritten.byteLength).toBe(raw.byteLength);
		expect(bytesEqual(rewritten, raw)).toBe(true);
	});

	it('writer is idempotent', () => {
		const first = writeVFXPropCollection(model);
		const second = writeVFXPropCollection(parseVFXPropCollection(first));
		expect(bytesEqual(first, second)).toBe(true);
	});

	it('a count-changing edit (dropping the last prop) re-packs all six table offsets', () => {
		const reparsed = parseVFXPropCollection(writeVFXPropCollection({ ...model, props: model.props.slice(0, -1) }));
		expect(reparsed.props.length).toBe(246);
		expect(reparsed.propStates.length).toBe(324);
		expect(reparsed.locators[0]).toEqual(model.locators[0]);
		expect(reparsed.coronaTypeData).toEqual(model.coronaTypeData);
	});

	it('writer rejects an oversized locator debug name', () => {
		const locators = model.locators.slice();
		locators[0] = { ...locators[0], macDebugLefName: 'x'.repeat(60) };
		expect(() => writeVFXPropCollection({ ...model, locators })).toThrow(/locator name/);
	});

	it('writer rejects a corona transform that is not 16 floats', () => {
		const coronas = model.coronas.slice();
		coronas[0] = { ...coronas[0], mTransform: coronas[0].mTransform.slice(0, 12) };
		expect(() => writeVFXPropCollection({ ...model, coronas })).toThrow(/transform/);
	});

	it('parser rejects a header whose tables are not sequentially packed', () => {
		const corrupted = new Uint8Array(raw);
		corrupted[0x08] = 0xb4; // mpPropStateTable 0xFB0 → 0xFB4
		expect(() => parseVFXPropCollection(corrupted)).toThrow(/propStates/);
	});
});

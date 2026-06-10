// Gold coverage for parseAemsBank / writeAemsBank.
//
// The registry fixture suite exercises five representative banks; this suite
// sweeps ALL 23 retail banks in example/SOUND/AEMS (every .BUNDLE except
// CSIS.BUNDLE carries exactly one 0xA022), pins hand-verified decoded values
// from the smallest bank (GEARWHINEPATCHBANK), pins the two-module INAIR
// shape the wiki says cannot exist, and asserts the retail constants the
// parser preserves verbatim instead of validating ('AKH' pads, S10A banks).
// The bank↔Csis CrcAndKey links are pinned in csis.test.ts.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseAemsBank, writeAemsBank, aemsSfxBankInfo, type ParsedAemsBank } from '../aemsBank';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const AEMS_DIR = path.resolve(REPO_ROOT, 'example/SOUND/AEMS');
const AEMS_BANK_TYPE_ID = 0xa022;

function loadBanks(bundleFile: string): Uint8Array[] {
	const buf = fs.readFileSync(path.resolve(AEMS_DIR, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	return bundle.resources
		.filter((r) => r.resourceTypeId === AEMS_BANK_TYPE_ID)
		.map((r) => new Uint8Array(extractResourceRaw(buffer, bundle, r)));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const allBundles = fs.readdirSync(AEMS_DIR).filter((f) => f.toUpperCase().endsWith('.BUNDLE'));
const bankBundles = allBundles.filter((f) => f.toUpperCase() !== 'CSIS.BUNDLE');

describe('AemsBank gold values (example/SOUND/AEMS/GEARWHINEPATCHBANK.BUNDLE)', () => {
	const raw = loadBanks('GEARWHINEPATCHBANK.BUNDLE')[0];
	const m = parseAemsBank(raw);

	it('decodes the envelope and header', () => {
		expect(raw.byteLength).toBe(9536);
		expect(m.platform).toBe(0); // PC
		expect(m.targetType).toBe(3); // SND10
		expect(m.numModules).toBe(1);
		expect(m._envelopePad.byteLength).toBe(8);
	});

	it('splits the interior blobs at the derived offsets', () => {
		// sfxbankoffset 0xA80 − header 0x5C; sfxbanksizepadded 0x1A54.
		expect(m._moduleData.byteLength).toBe(0xa24);
		expect(m._sfxBank.byteLength).toBe(0x1a54);
		expect(aemsSfxBankInfo(m)).toEqual({ id: 'S10A', version: 0, serialNumber: 0, numSamples: 1 });
	});

	it('decodes the fixup tables', () => {
		expect(m.funcFixups).toEqual([0xa3, 0xb2, 0x102, 0x119, 0x125, 0x131, 0x13d, 0x146]);
		expect(m.staticDataFixups).toEqual([0x1e0, 0x200]);
	});

	it('decodes the CSIS subscription', () => {
		expect(m.interfaceRefs).toEqual([{
			handleOffset: 0x60,
			type: 1, // class
			idCrc: 0x419c, // GearWhineCsis system crc
			idKey: 0x419c, // GearWhineClass entry crc
			idName: 'GearWhineClass',
			_pad: [0x41, 0x4b, 0x48], // uninit 'AKH'
		}]);
	});
});

describe('AemsBank INAIR shape (wiki divergence: nummodules > 1)', () => {
	const m = parseAemsBank(loadBanks('INAIR.BUNDLE')[0]);

	it('has two modules and two subscriptions', () => {
		expect(m.numModules).toBe(2);
		expect(m.interfaceRefs.map((r) => [r.idName, r.handleOffset, r.idCrc, r.idKey])).toEqual([
			['PlayTakeOff', 0x60, 0x0ed7, 0x1641],
			['PlayInAir', 0xa4, 0x0ed7, 0x7896],
		]);
	});
});

describe('AemsBank retail sweep (all 23 banks)', () => {
	it('every non-CSIS bundle in the directory carries exactly one bank', () => {
		expect(allBundles.length).toBe(24);
		expect(bankBundles.length).toBe(23);
		expect(loadBanks('CSIS.BUNDLE')).toHaveLength(0);
	});

	const models = new Map<string, { raw: Uint8Array; model: ParsedAemsBank }>();
	for (const file of bankBundles) {
		const banks = loadBanks(file);
		models.set(file, { raw: banks[0], model: parseAemsBank(banks[0]) });
	}

	it('round-trips every bank byte-for-byte, idempotently', () => {
		for (const [file, { raw }] of models) {
			const write1 = writeAemsBank(parseAemsBank(raw));
			expect(write1.byteLength, file).toBe(raw.byteLength);
			expect(bytesEqual(write1, raw), file).toBe(true);
			const write2 = writeAemsBank(parseAemsBank(write1));
			expect(bytesEqual(write2, write1), `${file} idempotence`).toBe(true);
		}
	});

	it('pins the constants preserved verbatim rather than asserted', () => {
		for (const [file, { model }] of models) {
			// Every retail bank is a PC SND10 bank with ≥1 class subscription.
			expect(model.platform, file).toBe(0);
			expect(model.targetType, file).toBe(3);
			expect(model.interfaceRefs.length, file).toBeGreaterThan(0);
			for (const ref of model.interfaceRefs) {
				expect(ref.type, `${file}/${ref.idName}`).toBe(1); // class
				expect(ref._pad, `${file}/${ref.idName}`).toEqual([0x41, 0x4b, 0x48]); // 'AKH'
			}
			// SND10 header: 'S10A', version 0, serial 0; numSamples is stored
			// big-endian and lands in a sane 1–309 range across retail.
			const sfx = aemsSfxBankInfo(model)!;
			expect(sfx.id, file).toBe('S10A');
			expect(sfx.version, file).toBe(0);
			expect(sfx.serialNumber, file).toBe(0);
			expect(sfx.numSamples, file).toBeGreaterThanOrEqual(1);
			expect(sfx.numSamples, file).toBeLessThanOrEqual(309);
		}
	});

	it('only INAIR carries more than one module', () => {
		for (const [file, { model }] of models) {
			expect(model.numModules, file).toBe(file === 'INAIR.BUNDLE' ? 2 : 1);
		}
	});
});

describe('AemsBank writer validation', () => {
	const m = parseAemsBank(loadBanks('GEARWHINEPATCHBANK.BUNDLE')[0]);

	it('rejects an SFX bank whose size is not a multiple of 4', () => {
		expect(() => writeAemsBank({ ...m, _sfxBank: m._sfxBank.slice(0, m._sfxBank.byteLength - 1) }))
			.toThrow(/multiple of 4/);
	});

	it('rejects a malformed envelope pad', () => {
		expect(() => writeAemsBank({ ...m, _envelopePad: new Uint8Array(0) })).toThrow(/_envelopePad/);
	});

	it('rejects byte-unrepresentable interface names', () => {
		const interfaceRefs = [{ ...m.interfaceRefs[0], idName: 'badĀname' }];
		expect(() => writeAemsBank({ ...m, interfaceRefs })).toThrow(/unrepresentable/);
	});
});

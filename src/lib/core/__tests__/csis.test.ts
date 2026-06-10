// Gold coverage for parseCsis / writeCsis.
//
// All ten retail Csis resources live in one bundle (SOUND/AEMS/CSIS.BUNDLE,
// alongside 30 Registry resources this suite ignores), but the auto-generated
// registry fixture suite only exercises the first resource of the type — so
// this suite walks ALL ten, pins hand-verified decoded values, pins the
// system-crc derivation, and pins the cross-resource CrcAndKey links from
// every AEMS bank (0xA022) interface reference back to its Csis class.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseCsis, writeCsis, csisSystemCrc, type ParsedCsis } from '../csis';
import { parseAemsBank } from '../aemsBank';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { extractResourceRaw } from '../registry';
import { shortCsisName } from '../registry/handlers/csis';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const AEMS_DIR = path.resolve(REPO_ROOT, 'example/SOUND/AEMS');
const CSIS_TYPE_ID = 0xa023;
const AEMS_BANK_TYPE_ID = 0xa022;

type Extracted = { name: string; raw: Uint8Array };

function loadResources(bundleFile: string, typeId: number): Extracted[] {
	const buf = fs.readFileSync(path.resolve(AEMS_DIR, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const debugResources = typeof bundle.debugData === 'string'
		? parseDebugDataFromXml(bundle.debugData)
		: [];
	return bundle.resources
		.filter((r) => r.resourceTypeId === typeId)
		.map((r) => ({
			name: findDebugResourceById(debugResources, r.resourceId.low.toString(16))?.name ?? '?',
			raw: new Uint8Array(extractResourceRaw(buffer, bundle, r)),
		}));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const resources = loadResources('CSIS.BUNDLE', CSIS_TYPE_ID);
const byShortName = new Map<string, { raw: Uint8Array; model: ParsedCsis }>(
	resources.map(({ name, raw }) => [shortCsisName(name), { raw, model: parseCsis(raw) }]),
);

describe('Csis gold values (example/SOUND/AEMS/CSIS.BUNDLE)', () => {
	it('the bundle carries exactly the ten retail module descriptors', () => {
		expect([...byShortName.keys()].sort()).toEqual([
			'BoostCsis', 'CrumpleCsis', 'GearWhineCsis', 'HornsCsis', 'InAirCsis',
			'ScrapesCsis', 'SkidsCsis', 'SurfaceCsis', 'TrafficCsis', 'TurboCsis',
		]);
	});

	it('decodes TrafficCsis (single-class shape)', () => {
		const { raw, model } = byShortName.get('TrafficCsis')!;
		expect(raw.byteLength).toBe(96);
		expect(model.platform).toBe(0);
		expect(model.resolved).toBe(0);
		expect(model.functions).toEqual([]);
		expect(model.classes).toEqual([
			{ name: 'TrafficEngineClass', crc: 0x73c8, _key: 0, _clients: 0 },
		]);
		expect(model.globalVariables).toEqual([]);
		expect(csisSystemCrc(model)).toBe(0x73c8);
	});

	it('decodes BoostCsis (the only resource with functions)', () => {
		const { model } = byShortName.get('BoostCsis')!;
		expect(model.functions.map((e) => [e.name, e.crc])).toEqual([
			['Message_1', 0x21e1],
			['Message', 0x6e72],
		]);
		expect(model.classes.map((e) => [e.name, e.crc])).toEqual([['Class', 0x540e]]);
		// The header crc is the entry-crc sum folded to 15 bits:
		// 0x21E1 + 0x6E72 + 0x540E = 0xE461 → & 0x7FFF = 0x6461.
		expect(csisSystemCrc(model)).toBe(0x6461);
	});

	it('decodes the two-class modules (Skids, InAir)', () => {
		const skids = byShortName.get('SkidsCsis')!.model;
		expect(skids.classes.map((e) => [e.name, e.crc])).toEqual([
			['Skids', 0x3a2b],
			['Skids_Traffic', 0x5719],
		]);
		expect(csisSystemCrc(skids)).toBe(0x1144); // 0x9144 & 0x7FFF

		const inAir = byShortName.get('InAirCsis')!.model;
		expect(inAir.classes.map((e) => [e.name, e.crc])).toEqual([
			['PlayTakeOff', 0x1641],
			['PlayInAir', 0x7896],
		]);
		expect(csisSystemCrc(inAir)).toBe(0x0ed7); // 0x8ED7 & 0x7FFF
	});

	it('no retail resource uses global variables or runtime fields', () => {
		for (const [name, { model }] of byShortName) {
			expect(model.globalVariables, name).toEqual([]);
			expect(model.platform, name).toBe(0);
			expect(model.resolved, name).toBe(0);
			for (const e of [...model.functions, ...model.classes]) {
				expect(e._key, `${name}/${e.name}`).toBe(0);
				expect(e._clients, `${name}/${e.name}`).toBe(0);
			}
		}
	});
});

describe('Csis round-trip', () => {
	it('round-trips all ten resources byte-for-byte, idempotently', () => {
		for (const [name, { raw }] of byShortName) {
			const write1 = writeCsis(parseCsis(raw));
			expect(write1.byteLength, name).toBe(raw.byteLength);
			expect(bytesEqual(write1, raw), name).toBe(true);
			const write2 = writeCsis(parseCsis(write1));
			expect(bytesEqual(write2, write1), `${name} idempotence`).toBe(true);
		}
	});

	it('writer rejects a malformed envelope pad', () => {
		const { model } = byShortName.get('TrafficCsis')!;
		expect(() => writeCsis({ ...model, _envelopePad: new Uint8Array(4) })).toThrow(/_envelopePad/);
	});

	it('writer rejects byte-unrepresentable entry names', () => {
		const { model } = byShortName.get('TrafficCsis')!;
		const classes = [{ ...model.classes[0], name: 'badĀname' }];
		expect(() => writeCsis({ ...model, classes })).toThrow(/unrepresentable/);
	});

	it('parser rejects a corrupted system crc (derivation is asserted)', () => {
		const { raw } = byShortName.get('TrafficCsis')!;
		const corrupted = new Uint8Array(raw);
		corrupted[0x20] ^= 0xff; // crc lives at payload+0x10 = raw 0x20
		expect(() => parseCsis(corrupted)).toThrow(/crc/);
	});
});

describe('Csis ↔ AEMS bank CrcAndKey links', () => {
	// Every interface reference in every retail bank must resolve against one
	// of the ten Csis resources: idCrc == that resource's system crc, and
	// (idKey, idName) == one of its class entries. This is the load-time
	// subscription contract the two types share.
	const bankFiles = fs.readdirSync(AEMS_DIR)
		.filter((f) => f.toUpperCase().endsWith('.BUNDLE') && f.toUpperCase() !== 'CSIS.BUNDLE');

	it('every bank interface reference resolves to a Csis class', () => {
		expect(bankFiles.length).toBe(23);
		const models = [...byShortName.values()].map((v) => v.model);
		for (const file of bankFiles) {
			const banks = loadResources(file, AEMS_BANK_TYPE_ID);
			expect(banks.length, file).toBe(1);
			const bank = parseAemsBank(banks[0].raw);
			expect(bank.interfaceRefs.length, file).toBeGreaterThan(0);
			for (const ref of bank.interfaceRefs) {
				const target = models.find((m) => csisSystemCrc(m) === ref.idCrc);
				expect(target, `${file}: no Csis with system crc 0x${ref.idCrc.toString(16)}`).toBeDefined();
				const entry = target!.classes.find((e) => e.name === ref.idName);
				expect(entry, `${file}: '${ref.idName}' not a class of the crc-matched Csis`).toBeDefined();
				expect(entry!.crc, `${file}: ${ref.idName} entry crc`).toBe(ref.idKey);
			}
		}
	});

	it('pins the GearWhine pair end to end', () => {
		const bank = parseAemsBank(loadResources('GEARWHINEPATCHBANK.BUNDLE', AEMS_BANK_TYPE_ID)[0].raw);
		const csis = byShortName.get('GearWhineCsis')!.model;
		expect(bank.interfaceRefs).toHaveLength(1);
		expect(bank.interfaceRefs[0].idName).toBe('GearWhineClass');
		expect(bank.interfaceRefs[0].idCrc).toBe(csisSystemCrc(csis));
		expect(bank.interfaceRefs[0].idKey).toBe(csis.classes[0].crc);
	});
});

// End-to-end coverage for the editable PropGraphicsList (0x10010): adding a prop
// entry in the editor and exporting the bundle must produce a valid bundle whose
// inline import table — and the envelope's importOffset/importCount — grow with
// the new Model reference. This is the real "catalogue a newly-placed prop type"
// workflow, exercised through writeBundleFresh's importTable() hook.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle, writeBundleFresh } from '../index';
import { getImportsByPtrOffset } from '../bundleEntry';
import { extractResourceRaw, resourceCtxFromBundle } from '../../registry/index';
import {
	parsePropGraphicsList,
	PROP_GRAPHICS_LIST_TYPE_ID,
	type ParsedPropGraphicsList,
} from '../../propGraphicsList';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const TRK9 = 'example/TRK_UNIT9_GR.BNDL';

function loadBundle(name: string): ArrayBuffer {
	const raw = fs.readFileSync(path.resolve(REPO_ROOT, name));
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return bytes.buffer as ArrayBuffer;
}

const NEW_TYPE = 0xfe;
const NEW_MODEL = 0xDEADBEEFCAFEn;
const NEW_PART_MODEL = 0xABCDEF012345n;

const hasTrk9 = fs.existsSync(path.resolve(REPO_ROOT, TRK9));
const describeTrk9 = hasTrk9 ? describe : describe.skip;

describeTrk9('add a PropGraphics entry and export (example/TRK_UNIT9_GR.BNDL)', () => {
	it('grows the import table + envelope metadata and wires the new Model id', () => {
		const original = loadBundle(TRK9);
		const bundle = parseBundle(original);
		const ctx = resourceCtxFromBundle(bundle);
		const entry = bundle.resources.find((r) => r.resourceTypeId === PROP_GRAPHICS_LIST_TYPE_ID)!;
		const model = parsePropGraphicsList(extractResourceRaw(original, bundle, entry), ctx.littleEndian);
		const beforeImports = entry.importCount; // 62 = 10 props + 52 parts

		const mutated: ParsedPropGraphicsList = {
			...model,
			props: [...model.props, { muTypeId: NEW_TYPE, mpModelId: NEW_MODEL, parts: [], _mpPartsRaw: 0 }],
		};
		const repacked = writeBundleFresh(bundle, original, {
			overrides: { resources: { [PROP_GRAPHICS_LIST_TYPE_ID]: mutated } },
		});

		const reparsed = parseBundle(repacked);
		const reIdx = reparsed.resources.findIndex((r) => r.resourceTypeId === PROP_GRAPHICS_LIST_TYPE_ID);
		const reEntry = reparsed.resources[reIdx];
		const payload = extractResourceRaw(repacked, reparsed, reEntry);
		const reModel = parsePropGraphicsList(payload, ctx.littleEndian);

		// The new prop survived round-trip.
		expect(reModel.props.length).toBe(model.props.length + 1);
		const added = reModel.props[reModel.props.length - 1];
		expect(added.muTypeId).toBe(NEW_TYPE);
		expect(added.mpModelId).toBe(NEW_MODEL);

		// Envelope import metadata grew by one and points at the rebuilt tail table.
		expect(reEntry.importCount).toBe(beforeImports + 1);
		expect(reEntry.importOffset).toBe(payload.byteLength - reEntry.importCount * 16);

		// The new Model id is resolvable through the bundle import index at the new
		// prop's mpPropModel field offset (0x20 + propIndex*0x0C + 0x04).
		const newPropIndex = reModel.props.length - 1;
		const fieldOffset = 0x20 + newPropIndex * 0x0c + 0x04;
		const imports = getImportsByPtrOffset(reparsed.imports, reparsed.resources, reIdx);
		expect(imports.get(fieldOffset)).toBe(NEW_MODEL);

		// Existing prop Model ids are still resolvable (table fully rebuilt).
		const firstFieldOffset = 0x20 + 0x04;
		expect(imports.get(firstFieldOffset)).toBe(model.props[0].mpModelId);
	});

	it('adds a PART to a prop and exports it with a wired-up Model id', () => {
		const original = loadBundle(TRK9);
		const bundle = parseBundle(original);
		const ctx = resourceCtxFromBundle(bundle);
		const entry = bundle.resources.find((r) => r.resourceTypeId === PROP_GRAPHICS_LIST_TYPE_ID)!;
		const model = parsePropGraphicsList(extractResourceRaw(original, bundle, entry), ctx.littleEndian);
		const beforeImports = entry.importCount;
		const beforeParts = model.props.reduce((n, p) => n + p.parts.length, 0);

		// Append a part to the first prop that already owns parts (extends its run).
		const targetIdx = model.props.findIndex((p) => p.parts.length > 0);
		expect(targetIdx).toBeGreaterThanOrEqual(0);
		const props = model.props.map((p) => ({ ...p, parts: p.parts.slice() }));
		props[targetIdx].parts.push({ muPartId: 99, mpModelId: NEW_PART_MODEL });
		const mutated: ParsedPropGraphicsList = { ...model, props };

		const repacked = writeBundleFresh(bundle, original, {
			overrides: { resources: { [PROP_GRAPHICS_LIST_TYPE_ID]: mutated } },
		});

		const reparsed = parseBundle(repacked);
		const reIdx = reparsed.resources.findIndex((r) => r.resourceTypeId === PROP_GRAPHICS_LIST_TYPE_ID);
		const reEntry = reparsed.resources[reIdx];
		const payload = extractResourceRaw(repacked, reparsed, reEntry);
		const reModel = parsePropGraphicsList(payload, ctx.littleEndian);

		// One more part overall, on the same prop, with the new Model id.
		expect(reModel.props.reduce((n, p) => n + p.parts.length, 0)).toBe(beforeParts + 1);
		const added = reModel.props[targetIdx].parts.find((p) => p.muPartId === 99);
		expect(added?.mpModelId).toBe(NEW_PART_MODEL);

		// Envelope import metadata grew by one (one Model import per part).
		expect(reEntry.importCount).toBe(beforeImports + 1);
		expect(reEntry.importOffset).toBe(payload.byteLength - reEntry.importCount * 16);

		// The new part's Model id is resolvable through the bundle import index.
		const imports = getImportsByPtrOffset(reparsed.imports, reparsed.resources, reIdx);
		expect([...imports.values()]).toContain(NEW_PART_MODEL);
	});
});

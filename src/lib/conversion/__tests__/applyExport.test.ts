// End-to-end test for the "Export to game version..." pipeline.
//
// Loads the V4 X360 BND1 fixture, runs the export through
// `paradise-pc-retail`, parses the output bytes back as a bundle, and
// asserts the result is a valid V12 BND2 PC bundle. This is the
// acceptance-criteria test from issue #37 ("Test: end-to-end — load V4
// fixture, pick preset, write to a temp file, parse output, assert it's
// a valid V12 bundle").

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { makeEditableBundle } from '@/context/WorkspaceContext.bundle';
import { parseBundle } from '@/lib/core/bundle';
import { parseAllBundleResourcesViaRegistry } from '@/lib/core/registry/bundleOps';
import { RESOURCE_TYPE_IDS } from '@/lib/core/types';
import {
	analyzeExport,
	runMigrations,
} from '../exportPlan';
import {
	applyExport,
	defaultExportFilename,
} from '../applyExport';
import { getTargetPreset } from '../targets';
import type { ParsedAISectionsV12 } from '@/lib/core/aiSections';

const V4_FIXTURE = path.resolve(__dirname, '../../../../example/older builds/AI.dat');

function loadEditableBundle(fixturePath: string) {
	const raw = fs.readFileSync(fixturePath);
	const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	return makeEditableBundle(buffer, path.basename(fixturePath));
}

describe('applyExport — V4 X360 BND1 → paradise-pc-retail (V12 PC BND2)', () => {
	it('produces a parseable V12 PC BND2 bundle with the migrated AI Sections', () => {
		const sourceBundle = loadEditableBundle(V4_FIXTURE);
		const preset = getTargetPreset('paradise-pc-retail')!;

		// Sanity: the source IS a V4 BND1 X360 BE bundle.
		expect(sourceBundle.parsed.bundle1Extras).toBeDefined();
		const sourceAi = sourceBundle.parsedResourcesAll.get('aiSections')?.[0] as { kind: string };
		expect(sourceAi.kind).toBe('v4');

		const analysis = analyzeExport(sourceBundle, preset);
		expect(analysis.blockers).toEqual([]);
		expect(analysis.migrations).toHaveLength(1);

		const result = runMigrations(analysis.migrations);
		const outputBuffer = applyExport(sourceBundle, preset, result.runs);

		// Re-parse the output. The result should be a BND2 ('bnd2' magic)
		// bundle on platform 1 (PC), with bundle1Extras absent.
		const outBundle = parseBundle(outputBuffer);
		expect(outBundle.bundle1Extras).toBeUndefined();
		expect(outBundle.header.platform).toBe(1);

		// And the AI Sections inside it should now be V12.
		const allResources = parseAllBundleResourcesViaRegistry(outputBuffer, outBundle);
		const aiList = allResources.get('aiSections') ?? [];
		expect(aiList.length).toBe(1);
		const aiModel = aiList[0] as ParsedAISectionsV12;
		expect(aiModel.kind).toBe('v12');
		expect(aiModel.version).toBe(12);

		// Section count is preserved across the migration — V4 has 2,442
		// sections in this fixture; that should survive verbatim.
		expect(aiModel.sections.length).toBe(
			(sourceAi as unknown as { legacy: { sections: unknown[] } }).legacy.sections
				.length,
		);

		// Source bundle remains untouched in memory — the export pipeline
		// mutates nothing on the input EditableBundle.
		expect(sourceBundle.parsed.bundle1Extras).toBeDefined();
		expect(sourceBundle.parsed.header.platform).toBe(2);
	});

	it('verifies the AI Sections resource still lives at typeId 0x10001 in the output', () => {
		const sourceBundle = loadEditableBundle(V4_FIXTURE);
		const preset = getTargetPreset('paradise-pc-retail')!;
		const analysis = analyzeExport(sourceBundle, preset);
		const result = runMigrations(analysis.migrations);
		const outputBuffer = applyExport(sourceBundle, preset, result.runs);

		const outBundle = parseBundle(outputBuffer);
		const aiResource = outBundle.resources.find(
			(r) => r.resourceTypeId === RESOURCE_TYPE_IDS.AI_SECTIONS,
		);
		expect(aiResource).toBeDefined();
	});
});

describe('defaultExportFilename', () => {
	it('inserts the preset id between basename and extension', () => {
		const preset = getTargetPreset('paradise-pc-retail')!;
		expect(defaultExportFilename('AI.DAT', preset)).toBe(
			'AI.paradise-pc-retail.DAT',
		);
		expect(defaultExportFilename('TRK_UNIT100_GR.BNDL', preset)).toBe(
			'TRK_UNIT100_GR.paradise-pc-retail.BNDL',
		);
	});

	it('preserves multi-dot names by splitting on the last dot only', () => {
		const preset = getTargetPreset('paradise-pc-retail')!;
		expect(defaultExportFilename('FOO.BAR.BIN', preset)).toBe(
			'FOO.BAR.paradise-pc-retail.BIN',
		);
	});

	it('appends to extensionless filenames', () => {
		const preset = getTargetPreset('paradise-pc-retail')!;
		expect(defaultExportFilename('AI', preset)).toBe('AI.paradise-pc-retail');
	});
});

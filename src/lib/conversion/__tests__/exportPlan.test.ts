// Analyzer tests for the "Export to game version..." flow. The analyzer
// is pure — these tests build EditableBundle values from real fixtures
// and assert the right migrations / blockers come back.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { makeEditableBundle } from '@/context/WorkspaceContext.bundle';
import {
	analyzeExport,
	runMigrations,
	buildMigrationOverridesByResourceId,
} from '../exportPlan';
import { getTargetPreset } from '../targets';

const V4_FIXTURE = path.resolve(__dirname, '../../../../example/older builds/AI.dat');
const V12_PC_FIXTURE = path.resolve(__dirname, '../../../../example/AI.DAT');

function loadEditableBundle(fixturePath: string) {
	const raw = fs.readFileSync(fixturePath);
	const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	return makeEditableBundle(buffer, path.basename(fixturePath));
}

describe('analyzeExport — V4 bundle against paradise-pc-retail', () => {
	it('plans exactly one V4 → V12 AI Sections migration with no blockers', () => {
		const bundle = loadEditableBundle(V4_FIXTURE);
		const preset = getTargetPreset('paradise-pc-retail')!;
		const analysis = analyzeExport(bundle, preset);

		expect(analysis.blockers).toEqual([]);
		expect(analysis.migrations).toHaveLength(1);
		expect(analysis.migrations[0]).toMatchObject({
			resourceKey: 'aiSections',
			currentKind: 'v4',
			targetKind: 'v12',
		});
	});
});

describe('analyzeExport — V12 PC bundle against paradise-pc-retail', () => {
	it('skips already-on-target resources — no migrations or blockers', () => {
		const bundle = loadEditableBundle(V12_PC_FIXTURE);
		const preset = getTargetPreset('paradise-pc-retail')!;
		const analysis = analyzeExport(bundle, preset);

		expect(analysis.blockers).toEqual([]);
		expect(analysis.migrations).toEqual([]);
	});
});

describe('runMigrations — V4 bundle migrations execute and aggregate', () => {
	it('produces a deduped + prefixed defaulted/lossy report', () => {
		const bundle = loadEditableBundle(V4_FIXTURE);
		const preset = getTargetPreset('paradise-pc-retail')!;
		const analysis = analyzeExport(bundle, preset);
		const result = runMigrations(analysis.migrations);

		expect(result.runs).toHaveLength(1);
		expect(result.runs[0].migration.resourceKey).toBe('aiSections');
		// The V4→V12 migrate function emits non-empty defaulted and lossy
		// arrays (per issue #36 documentation). The aggregation prefixes
		// each entry with the resourceKey for cross-resource readability.
		expect(result.defaulted.length).toBeGreaterThan(0);
		expect(result.lossy.length).toBeGreaterThan(0);
		for (const entry of result.defaulted) {
			expect(entry.startsWith('aiSections: ')).toBe(true);
		}
		for (const entry of result.lossy) {
			expect(entry.startsWith('aiSections: ')).toBe(true);
		}
	});
});

describe('buildMigrationOverridesByResourceId', () => {
	it('maps each migration run back to a resourceId hex key', () => {
		const bundle = loadEditableBundle(V4_FIXTURE);
		const preset = getTargetPreset('paradise-pc-retail')!;
		const analysis = analyzeExport(bundle, preset);
		const result = runMigrations(analysis.migrations);
		const overrides = buildMigrationOverridesByResourceId(bundle, result.runs);

		// One AI Sections resource → one override entry.
		expect(Object.keys(overrides)).toHaveLength(1);
		const idHex = Object.keys(overrides)[0];
		// 0x-prefixed 16-hex-char zero-padded uppercase id.
		expect(idHex).toMatch(/^0x[0-9A-F]{16}$/);
		// The override value is the migrated V12 model object, not bytes.
		const value = overrides[idHex] as { kind: string; version: number };
		expect(value.kind).toBe('v12');
		expect(value.version).toBe(12);
	});

	it('returns an empty record when there are no runs', () => {
		const bundle = loadEditableBundle(V12_PC_FIXTURE);
		const overrides = buildMigrationOverridesByResourceId(bundle, []);
		expect(overrides).toEqual({});
	});
});

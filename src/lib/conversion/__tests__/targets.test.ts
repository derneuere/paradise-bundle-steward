// Sanity tests on the target preset registry. The registry itself is data,
// so the tests are mostly "is the data well-formed" — unique ids, valid
// platform values, and the launch preset matches the issue spec.

import { describe, expect, it } from 'vitest';
import { listRegisteredTypes } from '@/lib/editor/registry';
import { TARGET_PRESETS, getTargetPreset } from '../targets';

const hex = (typeId: number) => `0x${typeId.toString(16)}`;

describe('TARGET_PRESETS', () => {
	it('has at least one preset', () => {
		expect(TARGET_PRESETS.length).toBeGreaterThan(0);
	});

	it('every preset has a unique id', () => {
		const ids = TARGET_PRESETS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('every preset names a known platform', () => {
		for (const p of TARGET_PRESETS) {
			expect([1, 2, 3]).toContain(p.platform);
		}
	});

	it('every preset names a known container', () => {
		for (const p of TARGET_PRESETS) {
			expect(['bnd1', 'bnd2']).toContain(p.container);
		}
	});

	it('ships with paradise-pc-retail (V12, BND2, PC) at launch', () => {
		const preset = getTargetPreset('paradise-pc-retail');
		expect(preset).toBeDefined();
		expect(preset?.container).toBe('bnd2');
		expect(preset?.platform).toBe(1);
		// AI Sections (typeId 0x10001) → v12.
		expect(preset?.kinds[0x10001]).toBe('v12');
	});

	it('returns undefined for unknown preset ids', () => {
		expect(getTargetPreset('unknown-preset-id')).toBeUndefined();
	});
});

// The two key tables — the editor registry's conversions and this preset's
// `kinds` — are parallel and hand-maintained, and their disagreement is
// SILENT: `analyzeExport` skips any typeId a preset leaves unconstrained, so
// a registered-but-unreachable migration means the resource exports as its
// source variant with no warning. These tests make that a red build instead.
describe('TARGET_PRESETS ↔ editor registry conversions', () => {
	it('every typeId with a registered conversion is constrained by every preset', () => {
		const withConversions = listRegisteredTypes().filter(
			(t) => t.conversionTargets.length > 0,
		);
		// Guard the guard: an empty list would make the loop below vacuous.
		expect(withConversions.length).toBeGreaterThan(0);

		for (const type of withConversions) {
			for (const preset of TARGET_PRESETS) {
				expect(
					preset.kinds[type.typeId],
					`preset "${preset.id}" has no kinds entry for ${type.key} (${hex(type.typeId)}), ` +
						`which registers conversions to [${type.conversionTargets.join(', ')}] — ` +
						`exports of that type would silently skip migration`,
				).toBeDefined();
			}
		}
	});

	it('every preset kind names a variant some registered profile claims', () => {
		const byTypeId = new Map(listRegisteredTypes().map((t) => [t.typeId, t]));
		for (const preset of TARGET_PRESETS) {
			for (const [typeIdKey, kind] of Object.entries(preset.kinds)) {
				const typeId = Number(typeIdKey);
				const type = byTypeId.get(typeId);
				expect(
					type,
					`preset "${preset.id}" constrains ${hex(typeId)}, which has no editor profile`,
				).toBeDefined();
				expect(
					type!.kinds,
					`preset "${preset.id}" targets kind "${kind}" for ${type!.key}`,
				).toContain(kind);
			}
		}
	});
});

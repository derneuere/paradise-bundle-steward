// Coverage for the bulk-transfer JSON envelope (Slice 2).

import { describe, it, expect } from 'vitest';
import {
	encodeBulkEnvelope,
	decodeBulkEnvelope,
	type BulkEnvelope,
} from '../bulkEnvelope';

describe('encodeBulkEnvelope', () => {
	it('produces a valid JSON document with all required fields', () => {
		const raw = encodeBulkEnvelope({
			resourceKey: 'aiSections',
			profile: 'v12',
			items: [{ x: 1 }, { x: 2 }],
			sourceBundle: 'AI.DAT',
		});
		const parsed = JSON.parse(raw) as BulkEnvelope;
		expect(parsed.kind).toBe('steward.bulk');
		expect(parsed.version).toBe(1);
		expect(parsed.resourceKey).toBe('aiSections');
		expect(parsed.profile).toBe('v12');
		expect(parsed.sourceBundle).toBe('AI.DAT');
		expect(parsed.items).toHaveLength(2);
		expect(typeof parsed.exportedAt).toBe('string');
		// ISO 8601: at minimum has a 'T' separator.
		expect(parsed.exportedAt).toMatch(/T/);
	});

	it('omits sourceBundle when not provided', () => {
		const raw = encodeBulkEnvelope({
			resourceKey: 'aiSections',
			profile: 'v12',
			items: [],
		});
		const parsed = JSON.parse(raw) as BulkEnvelope & { sourceBundle?: string };
		expect(parsed.sourceBundle).toBeUndefined();
	});

	it('pretty-prints (multi-line output)', () => {
		const raw = encodeBulkEnvelope({
			resourceKey: 'aiSections',
			profile: 'v12',
			items: [],
		});
		expect(raw).toContain('\n');
		// Two-space indent.
		expect(raw).toMatch(/\n  "kind":/);
	});
});

describe('decodeBulkEnvelope', () => {
	it('round-trips a freshly-encoded envelope', () => {
		const raw = encodeBulkEnvelope({
			resourceKey: 'aiSections',
			profile: 'v12',
			items: [{ a: 1 }],
			sourceBundle: 'AI.DAT',
		});
		const result = decodeBulkEnvelope(raw);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.envelope.kind).toBe('steward.bulk');
			expect(result.envelope.version).toBe(1);
			expect(result.envelope.resourceKey).toBe('aiSections');
			expect(result.envelope.profile).toBe('v12');
			expect(result.envelope.sourceBundle).toBe('AI.DAT');
			expect(result.envelope.items).toEqual([{ a: 1 }]);
		}
	});

	it('preserves an empty items array', () => {
		const raw = encodeBulkEnvelope({
			resourceKey: 'aiSections',
			profile: 'v12',
			items: [],
		});
		const result = decodeBulkEnvelope(raw);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.envelope.items).toEqual([]);
		}
	});

	it('rejects malformed JSON', () => {
		const result = decodeBulkEnvelope('{not valid json');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/JSON/i);
	});

	it('rejects a non-object document', () => {
		const result = decodeBulkEnvelope('"a string"');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/object/i);
	});

	it('rejects an array document', () => {
		// Arrays are objects too in JS, so we need an explicit non-object check.
		// JSON.parse of '[]' returns an array; we treat the kind discriminator as
		// the gate.
		const result = decodeBulkEnvelope('[]');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/kind|Not a Steward/i);
	});

	it('rejects wrong kind', () => {
		const result = decodeBulkEnvelope(
			JSON.stringify({ kind: 'something-else', version: 1, resourceKey: 'x', profile: 'v12', exportedAt: '', items: [] }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/kind|Steward bulk/i);
	});

	it('rejects unsupported version', () => {
		const result = decodeBulkEnvelope(
			JSON.stringify({ kind: 'steward.bulk', version: 2, resourceKey: 'x', profile: 'v12', exportedAt: '', items: [] }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/version/i);
	});

	it('rejects missing resourceKey', () => {
		const result = decodeBulkEnvelope(
			JSON.stringify({ kind: 'steward.bulk', version: 1, profile: 'v12', exportedAt: '', items: [] }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/resourceKey/i);
	});

	it('rejects empty resourceKey', () => {
		const result = decodeBulkEnvelope(
			JSON.stringify({ kind: 'steward.bulk', version: 1, resourceKey: '', profile: 'v12', exportedAt: '', items: [] }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/resourceKey/i);
	});

	it('rejects non-string resourceKey', () => {
		const result = decodeBulkEnvelope(
			JSON.stringify({ kind: 'steward.bulk', version: 1, resourceKey: 42, profile: 'v12', exportedAt: '', items: [] }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/resourceKey/i);
	});

	it('rejects missing profile', () => {
		const result = decodeBulkEnvelope(
			JSON.stringify({ kind: 'steward.bulk', version: 1, resourceKey: 'x', exportedAt: '', items: [] }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/profile/i);
	});

	it('rejects missing exportedAt', () => {
		const result = decodeBulkEnvelope(
			JSON.stringify({ kind: 'steward.bulk', version: 1, resourceKey: 'x', profile: 'v12', items: [] }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/exportedAt/i);
	});

	it('rejects non-array items', () => {
		const result = decodeBulkEnvelope(
			JSON.stringify({ kind: 'steward.bulk', version: 1, resourceKey: 'x', profile: 'v12', exportedAt: '', items: 'not-array' }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/items/i);
	});

	it('rejects sourceBundle that is not a string when present', () => {
		const result = decodeBulkEnvelope(
			JSON.stringify({
				kind: 'steward.bulk',
				version: 1,
				resourceKey: 'x',
				profile: 'v12',
				exportedAt: '',
				items: [],
				sourceBundle: 42,
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/sourceBundle/i);
	});

	it('accepts an envelope without sourceBundle', () => {
		const result = decodeBulkEnvelope(
			JSON.stringify({
				kind: 'steward.bulk',
				version: 1,
				resourceKey: 'aiSections',
				profile: 'v12',
				exportedAt: '2026-05-05T00:00:00Z',
				items: [],
			}),
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.envelope.sourceBundle).toBeUndefined();
	});
});

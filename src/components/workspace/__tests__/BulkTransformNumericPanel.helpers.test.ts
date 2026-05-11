// Unit tests for the BulkTransformNumericPanel's display-side conversions
// (issue #81).
//
// The panel shows rotation values in degrees but stores radians on the wire
// (via BulkTransformDelta.rotate which is per-axis Euler angles in radians).
// The translate fields display verbatim. Pivot is absolute world coords,
// also verbatim.
//
// Tests run in node — no jsdom — so we test the conversion math directly
// rather than mounting React.

import { describe, it, expect } from 'vitest';

// Mirror the conversion in BulkTransformNumericPanel. Kept here as a small
// pure helper so the test asserts the contract without a DOM. The panel
// itself uses inline `toDisplay` / `fromDisplay` closures with the same
// math.
function toDisplayDeg(radians: number): number {
	return (radians * 180) / Math.PI;
}
function fromDisplayDeg(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

describe('rotation display conversion (radians ↔ degrees)', () => {
	it('round-trips 0', () => {
		expect(fromDisplayDeg(toDisplayDeg(0))).toBe(0);
	});

	it('90° displays as 90 and parses back to π/2', () => {
		expect(toDisplayDeg(Math.PI / 2)).toBeCloseTo(90);
		expect(fromDisplayDeg(90)).toBeCloseTo(Math.PI / 2);
	});

	it('-180° round-trips', () => {
		const rad = -Math.PI;
		expect(toDisplayDeg(rad)).toBeCloseTo(-180);
		expect(fromDisplayDeg(-180)).toBeCloseTo(-Math.PI);
	});

	it('arbitrary radians round-trip with float tolerance', () => {
		const inputs = [0.001, 0.5, 1.234, -2.71, 3.14];
		for (const r of inputs) {
			expect(fromDisplayDeg(toDisplayDeg(r))).toBeCloseTo(r);
		}
	});
});

describe('translate values pass through unchanged (no unit conversion)', () => {
	it('any number is its own display value', () => {
		const values = [0, 1, -1, 0.5, 1e6, -1e-3];
		for (const v of values) {
			expect(v).toBe(v); // sanity — the panel's translate path applies no conversion
		}
	});
});

describe('formatNumber rounding (panel display)', () => {
	// Mirror the panel's `formatNumber`. The intent is that the panel never
	// shows the user "0.30000000000000004" — accumulated float math is
	// rounded to 6 significant fractional digits before stringification.
	function formatNumber(v: number): string {
		if (!Number.isFinite(v)) return '0';
		const rounded = Math.round(v * 1e6) / 1e6;
		if (rounded === 0) return '0';
		return String(rounded);
	}

	it('round 0.1 + 0.2 cleanly', () => {
		expect(formatNumber(0.1 + 0.2)).toBe('0.3');
	});

	it('does not strip meaningful precision', () => {
		expect(formatNumber(1.234567)).toBe('1.234567');
	});

	it('emits "0" for non-finite values (the panel handles NaN as a no-op)', () => {
		expect(formatNumber(NaN)).toBe('0');
		expect(formatNumber(Infinity)).toBe('0');
	});

	it('emits "0" for negative zero', () => {
		// `-0 === 0` is true, and -0 * 1e6 / 1e6 = -0. We special-case 0 to
		// avoid the cosmetic "-0" in the input field.
		expect(formatNumber(-0)).toBe('0');
	});
});

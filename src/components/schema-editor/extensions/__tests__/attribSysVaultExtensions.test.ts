import { describe, it, expect } from 'vitest';
import { decodeBytes8, encodeBytes8 } from '../attribSysVaultExtensions';

// bytes8 fields carry short ASCII names (VehicleID="CARBRWDS", etc.). The
// AttribSys fields extension decodes them for display and re-encodes on edit;
// round-tripping must keep the fixed 8-byte width and null-terminate short
// strings.
describe('attribSys bytes8 codec', () => {
	it('decodes a printable ASCII name up to the first null', () => {
		const bytes = [0x43, 0x41, 0x52, 0x42, 0x52, 0x57, 0x44, 0x53]; // "CARBRWDS"
		expect(decodeBytes8(bytes).ascii).toBe('CARBRWDS');
	});

	it('decodes a short name and stops at the null terminator', () => {
		expect(decodeBytes8([0x41, 0x42, 0x43, 0, 0, 0, 0, 0]).ascii).toBe('ABC');
	});

	it('reports null ascii for non-printable payloads (hex fallback)', () => {
		const { ascii, hex } = decodeBytes8([0xff, 0x01, 0x80, 0, 0, 0, 0, 0]);
		expect(ascii).toBeNull();
		expect(hex).toBe('FF 01 80 00 00 00 00 00');
	});

	it('encodes to a fixed 8-byte width, truncating past 8 chars', () => {
		expect(encodeBytes8('ABC')).toEqual([0x41, 0x42, 0x43, 0, 0, 0, 0, 0]);
		expect(encodeBytes8('TOOLONGNAME')).toEqual([0x54, 0x4f, 0x4f, 0x4c, 0x4f, 0x4e, 0x47, 0x4e]);
	});

	it('round-trips a name through encode -> decode', () => {
		expect(decodeBytes8(encodeBytes8('CARBRWDS')).ascii).toBe('CARBRWDS');
	});
});

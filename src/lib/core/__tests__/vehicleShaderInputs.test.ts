import { describe, it, expect } from 'vitest';
import { bindVertexStreams, techniqueProgramOffset, verletRange, writeVerletOffsets } from '../vehicleShaderInputs';
import type { ParsedDxbc } from '../dxbc';

const VEHICLE_TECHNIQUES = [{ name: 'Damaged' }, { name: 'Default' }, { name: 'ZOnlyOpaqueSingleSided' }, { name: 'ZOnlyVehicleSkinnedOpaqueSingleSided' }];

describe('techniqueProgramOffset', () => {
	it('picks the Damaged pair when programs come two per technique', () => {
		expect(techniqueProgramOffset(VEHICLE_TECHNIQUES, 8)).toBe(0);
		expect(techniqueProgramOffset([{ name: 'Default' }, { name: 'Damaged' }], 4)).toBe(2);
	});

	it('falls back to the first programs otherwise', () => {
		expect(techniqueProgramOffset([{ name: 'Default' }, { name: 'Damaged' }], 3)).toBe(0);
		expect(techniqueProgramOffset([{ name: 'Default' }], 2)).toBe(0);
		expect(techniqueProgramOffset([], 2)).toBe(0);
	});
});

// The stub block the translator emits for a damaged vehicle vertex program.
const VS = [
	'#define a_POSITION0 position',
	'#define a_TANGENT0 vec3(0.0)',
	'#define a_TEXCOORD0 uv',
	'#define a_TEXCOORD1 vec2(0.0)',
	'#define a_BLENDINDICES0 vec4(0.0)',
	'#define a_BLENDWEIGHT0 vec3(1.0, 0.0, 0.0)',
	'void main() { gl_Position = vec4(a_BLENDWEIGHT0, 0.0); }',
].join('\n');

describe('bindVertexStreams', () => {
	it('binds every stream the geometry carries, shaped to the input width', () => {
		const out = bindVertexStreams(VS, new Set(['skinIndex', 'skinWeight', 'tangent', 'uv1']));
		expect(out).toContain('#ifndef USE_SKINNING\nattribute vec4 skinIndex;\n#endif\n#define a_BLENDINDICES0 skinIndex');
		expect(out).toContain('attribute vec4 skinWeight;\n#endif\n#define a_BLENDWEIGHT0 skinWeight.xyz');
		expect(out).toContain('#ifndef USE_TANGENT\nattribute vec4 tangent;\n#endif\n#define a_TANGENT0 tangent.xyz');
		expect(out).toContain('#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\n#define a_TEXCOORD1 uv1');
		expect(out).toContain('#define a_POSITION0 position');
		expect(out).toContain('void main()');
	});

	it('keeps the stub of a stream the geometry lacks', () => {
		const out = bindVertexStreams(VS, new Set(['skinIndex', 'skinWeight']));
		expect(out).toContain('#define a_TANGENT0 vec3(0.0)');
		expect(out).toContain('#define a_TEXCOORD1 vec2(0.0)');
		expect(out).not.toContain('attribute vec4 tangent');
	});

	it('pads a narrow attribute out to a wider input', () => {
		expect(bindVertexStreams('#define a_TEXCOORD1 vec4(0.0)', new Set(['uv1']))).toContain('#define a_TEXCOORD1 vec4(uv1, 0.0, 0.0)');
	});
});

function parsedWith(vars: { name: string; slot: number; slots: number }[]): ParsedDxbc {
	return {
		reflection: { constantBuffers: [{ variables: vars.map((v) => ({ name: v.name, startOffset: v.slot * 16, size: v.slots * 16 })) }], resourceBindings: [] },
	} as unknown as ParsedDxbc;
}

describe('verletRange', () => {
	it('reads the deformation array slots from either program', () => {
		expect(verletRange([undefined, parsedWith([{ name: 'world', slot: 44, slots: 4 }, { name: 'g_verletOffsets', slot: 48, slots: 128 }])]))
			.toEqual({ slot: 48, count: 128 });
		expect(verletRange([parsedWith([{ name: 'world', slot: 44, slots: 4 }])])).toBeNull();
	});
});

describe('writeVerletOffsets', () => {
	const slots = () => Array.from({ length: 8 }, () => ({ v: [9, 9, 9, 9], set(x: number, y: number, z: number, w: number) { this.v = [x, y, z, w]; } }));

	it('copies rows (xyz offset, w scratch) into their slots', () => {
		const cb = slots();
		const rows = new Float32Array([1, 2, 3, 0.5, 4, 5, 6, 0.75]);
		writeVerletOffsets(cb, { slot: 2, count: 2 }, rows);
		expect(cb[2].v).toEqual([1, 2, 3, 0.5]);
		expect(cb[3].v).toEqual([4, 5, 6, 0.75]);
		expect(cb[1].v).toEqual([9, 9, 9, 9]);
		expect(cb[4].v).toEqual([9, 9, 9, 9]);
	});

	it('zeroes the slots for a car at rest and stops at the array end', () => {
		const cb = slots();
		writeVerletOffsets(cb, { slot: 6, count: 4 }, null);
		expect(cb[6].v).toEqual([0, 0, 0, 0]);
		expect(cb[7].v).toEqual([0, 0, 0, 0]);
		expect(cb[5].v).toEqual([9, 9, 9, 9]);
	});
});

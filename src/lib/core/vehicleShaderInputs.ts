// What the game's vehicle shaders need from the draw beyond a static
// material: the right technique, the mesh's own vertex streams and the car's
// deformation rows.
//
// - Technique: a Shader imports its programs in technique order, a vertex
//   and a pixel program per technique. Vehicle shaders list 'Damaged' first
//   (then 'Default' and Z-only passes). The game draws every player car with
//   'Damaged': it is the one that reads the deformation rows, and at rest
//   (zero rows) it looks exactly like 'Default'.
// - Vertex streams: the translator stubs every input three.js does not name
//   (blend indices / weights, tangent, second UV set) to a constant. The
//   damaged programs read the blend pair to pick their rows, the tangent for
//   the crumple bump and the second UV set for the scratch and crumple maps,
//   so those stubs are swapped for the geometry's real attributes.
// - Deformation rows: g_verletOffsets, 128 x vec4 in cb0. xyz moves a vertex
//   (blend-weighted by its two indices), w is the scratch amount the pixel
//   program turns into bare-metal scratches through the scratch map.

import type { ParsedDxbc } from './dxbc';

export const DAMAGED_TECHNIQUE = 'Damaged';

/** Offset of the first program (the vertex one) of the technique to draw. */
export function techniqueProgramOffset(techniques: readonly { name: string }[], programCount: number): number {
	if (techniques.length === 0 || programCount !== techniques.length * 2) return 0;
	const i = techniques.findIndex((t) => t.name === DAMAGED_TECHNIQUE);
	return i > 0 ? i * 2 : 0;
}

// DXBC input -> three.js geometry attribute. The guard is the define three.js
// sets when its own prefix already declares the attribute.
const STREAMS: Record<string, { attr: string; type: 'vec2' | 'vec4'; guard: string }> = {
	BLENDINDICES0: { attr: 'skinIndex', type: 'vec4', guard: 'USE_SKINNING' },
	BLENDWEIGHT0: { attr: 'skinWeight', type: 'vec4', guard: 'USE_SKINNING' },
	TANGENT0: { attr: 'tangent', type: 'vec4', guard: 'USE_TANGENT' },
	TEXCOORD1: { attr: 'uv1', type: 'vec2', guard: 'USE_UV1' },
};

/** Geometry attributes the vertex streams can bind to. */
export const VEHICLE_STREAM_ATTRIBUTES = Object.values(STREAMS).map((s) => s.attr);

const stubComponents = (stub: string) => {
	const m = /^vec(\d)/.exec(stub);
	return m ? Number(m[1]) : 1;
};

function shaped(attr: string, have: number, want: number): string {
	if (want === have) return attr;
	if (want < have) return `${attr}.${'xyzw'.slice(0, want)}`;
	return `vec${want}(${attr}${', 0.0'.repeat(want - have)})`;
}

/**
 * Swap the translator's constant stubs (`#define a_BLENDWEIGHT0 vec3(1.0, 0.0, 0.0)`)
 * for the geometry attributes the mesh really carries. Inputs whose attribute
 * is missing keep their stub.
 */
export function bindVertexStreams(vs: string, available: ReadonlySet<string>): string {
	return vs.replace(/^#define a_([A-Z]+\d) (.+)$/gm, (line, input: string, stub: string) => {
		const s = STREAMS[input];
		if (!s || !available.has(s.attr)) return line;
		const have = s.type === 'vec2' ? 2 : 4;
		return [
			`#ifndef ${s.guard}`,
			`attribute ${s.type} ${s.attr};`,
			'#endif',
			`#define a_${input} ${shaped(s.attr, have, stubComponents(stub))}`,
		].join('\n');
	});
}

export type CbRange = { slot: number; count: number };

/** cb0 slots of g_verletOffsets in either program, or null. */
export function verletRange(programs: readonly (ParsedDxbc | undefined)[]): CbRange | null {
	for (const p of programs) {
		for (const cb of p?.reflection.constantBuffers ?? []) {
			const v = cb.variables.find((x) => x.name === 'g_verletOffsets');
			if (v) return { slot: Math.floor(v.startOffset / 16), count: Math.floor(v.size / 16) };
		}
	}
	return null;
}

type Vec4Slot = { set(x: number, y: number, z: number, w: number): unknown };

/** Copy the deformation rows into their cb0 slots; null rows = the car at rest. */
export function writeVerletOffsets(cb: readonly Vec4Slot[], range: CbRange, rows: Float32Array | null): void {
	for (let i = 0; i < range.count; i++) {
		const slot = cb[range.slot + i];
		if (!slot) return;
		const k = i * 4;
		if (rows && k + 3 < rows.length) slot.set(rows[k], rows[k + 1], rows[k + 2], rows[k + 3]);
		else slot.set(0, 0, 0, 0);
	}
}

// Operand rendering for the DXBC -> GLSL emitter: the emit context, source
// reads (swizzle, modifiers, immediates, indexed register files) and masked
// destination writes. Shared by the instruction emitter (glsl.ts) and the
// texture-sampling emitter (glslTexture.ts).
//
// Value model: every DXBC register is a vec4 of floats. DXBC registers are
// untyped 32-bit lanes, and the game's shaders keep integers small (indices,
// loop counters, cascade selectors), so an integer is carried as the float
// with the same value and comparisons produce 1.0 / 0.0 instead of the
// 0xFFFFFFFF / 0 masks. Ops that only make sense on bit patterns are emitted
// under that model (see `and` in glsl.ts).

import type { DxbcOperand, DxbcOperandIndex } from './ops';

/** Signature semantic+index -> GLSL varying / attribute name. */
export type VaryingBinding = {
	/** GLSL identifier used as the varying (without "v_" prefix). */
	name: string;
	/** Number of components declared by ISGN/OSGN mask. */
	components: number;
	/** Source register number in the relevant signature. */
	register: number;
};

/** Texture shape of a t register, from its dcl_resource. */
export type ResourceKind = '2D' | 'Cube';

export type EmitCtx = {
	programType: 'vertex' | 'pixel';
	/** Per input-register varying name + component count, populated from ISGN
	 *  and dcl_input_ps declarations. */
	inputBindings: Record<number, VaryingBinding>;
	/** Per output-register binding; SV_POSITION special-cased. */
	outputBindings: Record<number, VaryingBinding>;
	/** Resource (SRV) bindings: key=bindPoint, value=name. */
	resources: Record<number, string>;
	/** Texture shape per resource register (2D unless declared a cube). */
	resourceKinds: Record<number, ResourceKind>;
	/** Sampler bindings: key=bindPoint, value=name. */
	samplers: Record<number, string>;
	/** Constant-buffer bindings: key=register, value={ size, variables[] }. */
	cbuffers: Record<number, { size: number; name: string }>;
	/** Temp-register count declared via dcl_temps. */
	tempCount: number;
	/** Indent level for emitted lines. */
	indent: number;
	/** Saturate flag of the instruction being emitted. */
	saturate: boolean;
	/** Everything the emitter could not translate: op names and `src:` /
	 *  `dst:` operand kinds. translateDxbc reports it. */
	unsupported: Set<string>;
	/** Vertex stage: the oN -> varying / gl_Position copy that must run
	 *  before any return from main. */
	outputCopy: string[];
};

export function swizzleToStr(sw: number): string {
	const c = ['x', 'y', 'z', 'w'];
	return c[(sw >> 0) & 3] + c[(sw >> 2) & 3] + c[(sw >> 4) & 3] + c[(sw >> 6) & 3];
}

function maskToStr(mask: number): string {
	let s = '';
	if (mask & 1) s += 'x';
	if (mask & 2) s += 'y';
	if (mask & 4) s += 'z';
	if (mask & 8) s += 'w';
	return s;
}

export function maskBits(mask: number): number {
	let n = 0;
	if (mask & 1) n++;
	if (mask & 2) n++;
	if (mask & 4) n++;
	if (mask & 8) n++;
	return n;
}

export function idxVal(o: DxbcOperand, i: number): number {
	const idx = o.indices[i];
	return idx && idx.kind === 'immediate' ? idx.value : 0;
}

// Register-file index: `[3]` or `[int(r0.x) + 3]`. The base may already be
// a scalar selection, so `vec4(...)` broadcasts it before taking `.x`.
function indexExpr(idx: DxbcOperandIndex | undefined, ctx: EmitCtx): string {
	if (!idx) return '0';
	if (idx.kind === 'immediate') return String(idx.value);
	return `int(vec4(${readExpr(idx.base, ctx)}).x) + ${idx.offset}`;
}

/** Value of an untyped 32-bit immediate under the float value model. fxc
 *  writes integer immediates (`l(4)`, `l(-1)`) as raw integer bits; read as
 *  float those are denormals (positive) or NaNs (negative), which no shader
 *  means as a float, so those two patterns are taken as the integer. */
export function immediateValue(bits: number): number {
	const u = bits >>> 0;
	const exponent = u & 0x7F800000;
	const negative = (u & 0x80000000) !== 0;
	if (exponent === 0 && !negative && u !== 0) return u;
	if (exponent === 0x7F800000 && negative && (u & 0x007FFFFF) !== 0) return u | 0;
	const buf = new ArrayBuffer(4);
	new Uint32Array(buf)[0] = u;
	return new Float32Array(buf)[0];
}

export function fmtFloat(v: number): string {
	// GLSL ES has no NaN / infinity literals; build them from their bits.
	if (Number.isNaN(v)) return 'uintBitsToFloat(0x7fc00000u)';
	if (v === Infinity) return 'uintBitsToFloat(0x7f800000u)';
	if (v === -Infinity) return 'uintBitsToFloat(0xff800000u)';
	if (Object.is(v, -0)) return '-0.0';
	if (Number.isInteger(v)) return v.toFixed(1);
	return v.toString();
}

/** A vec4 literal of one ICB row / immediate: scalars broadcast. */
export function vec4Literal(values: readonly number[]): string {
	// Scalar DXBC immediates broadcast when read through any component
	// swizzle, not zero-extend: `l(1.0)` written to `.w` must land as 1.0.
	if (values.length === 1) return `vec4(${fmtFloat(values[0])})`;
	const v = values.slice();
	while (v.length < 4) v.push(0);
	return `vec4(${v.map(fmtFloat).join(', ')})`;
}

export function padToVec4(name: string, components: number): string {
	if (components >= 4) return name;
	if (components === 3) return `vec4(${name}, 0.0)`;
	if (components === 2) return `vec4(${name}, 0.0, 0.0)`;
	return `vec4(${name}, 0.0, 0.0, 0.0)`;
}

// Render an operand as a GLSL expression, already swizzled and modifier-
// applied. Works on either source operands (swizzle) or destinations (mask
// is handled separately by writeDest).
export function readExpr(o: DxbcOperand, ctx: EmitCtx): string {
	let core = '';
	switch (o.type) {
		case 'temp':
			core = `r${idxVal(o, 0)}`;
			break;
		case 'input': {
			const r = idxVal(o, 0);
			const b = ctx.inputBindings[r];
			if (!b) { core = `vec4(0.0) /* unbound v${r} */`; break; }
			if (b.name === '_SV_POSITION') {
				core = `gl_FragCoord`;
				break;
			}
			// Expand to vec4 by padding with zeros for missing components so
			// swizzles read cleanly even if the varying is vec2/vec3.
			core = padToVec4(b.name, b.components);
			break;
		}
		case 'output':
			core = `o${idxVal(o, 0)}`;
			break;
		case 'indexable_temp':
			core = `x${idxVal(o, 0)}[${indexExpr(o.indices[1], ctx)}]`;
			break;
		case 'immediate32':
			core = vec4Literal(o.immediateBits ? o.immediateBits.map(immediateValue) : o.immediates);
			break;
		case 'constant_buffer':
			core = `cb${idxVal(o, 0)}[${indexExpr(o.indices[1], ctx)}]`;
			break;
		case 'immediate_constant_buffer':
			core = `icb[${indexExpr(o.indices[0], ctx)}]`;
			break;
		case 'sampler':
		case 'resource':
			// Sample instructions consume these directly, not via readExpr.
			core = `/* ${o.type} ${idxVal(o, 0)} */`;
			break;
		case 'null':
			core = `vec4(0.0)`;
			break;
		default:
			ctx.unsupported.add(`src:${o.type}`);
			core = `/* ? ${o.type} */ vec4(0.0)`;
	}

	// Swizzle (source mode == 1) or select1 (mode == 2) or already-masked
	// (mode == 0 with compCount==2 — destination, not a source read).
	let expr = core;
	if (o.selectionMode === 1) {
		expr = `${expr}.${swizzleToStr(o.swizzle)}`;
	} else if (o.selectionMode === 2) {
		expr = `${expr}.${['x', 'y', 'z', 'w'][o.select1]}`;
	}

	// Modifier: bit 0 = negate, bit 1 = abs.
	if (o.modifier & 2) expr = `abs(${expr})`;
	if (o.modifier & 1) expr = `-(${expr})`;
	return expr;
}

// Destination operand: the masked assignment of `rhs`. DXBC writes are
// component-masked; for a partial mask the rhs is cast to vec4 first so the
// mask is always a valid selection, whatever the rhs's own width. A `null`
// destination (e.g. the unused half of sincos) writes nothing.
export function writeDest(o: DxbcOperand, rhs: string, ctx: EmitCtx): string {
	let lvalue: string;
	if (o.type === 'temp') {
		lvalue = `r${idxVal(o, 0)}`;
	} else if (o.type === 'output') {
		const r = idxVal(o, 0);
		// Vertex shaders always route through oN scratch and copy out at
		// main-exit so the two writers (direct + copy-back) don't race on
		// gl_Position. Pixel shaders have no post-pass, so o0 writes the
		// fragment colour directly.
		if (ctx.programType === 'pixel') {
			lvalue = r === 0 ? `gl_FragColor` : `gl_FragData[${r}]`;
		} else {
			lvalue = `o${r}`;
		}
	} else if (o.type === 'indexable_temp') {
		lvalue = `x${idxVal(o, 0)}[${indexExpr(o.indices[1], ctx)}]`;
	} else if (o.type === 'output_depth') {
		return `gl_FragDepth = ${wrapSat(`vec4(${rhs})`, ctx)}.x;`;
	} else if (o.type === 'null') {
		return '';
	} else {
		ctx.unsupported.add(`dst:${o.type}`);
		return `/* unhandled dst type ${o.type} */`;
	}

	const mask = o.mask || 0xF;
	if (mask === 0xF) {
		return `${lvalue} = ${wrapSat(`vec4(${rhs})`, ctx)};`;
	}
	const maskStr = maskToStr(mask);
	return `${lvalue}.${maskStr} = ${wrapSat(`vec4(${rhs}).${maskStr}`, ctx)};`;
}

// `_sat` instructions clamp their result to [0, 1] before the masked write.
// The vehicle shaders lean on it (e.g. the scratch blend factor), so
// dropping it lets factors run negative or past 1.
function wrapSat(rhs: string, ctx: EmitCtx): string {
	return ctx.saturate ? `clamp(${rhs}, 0.0, 1.0)` : rhs;
}

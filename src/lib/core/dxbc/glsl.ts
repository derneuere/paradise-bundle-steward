// DXBC SM5 → GLSL ES emitter.
//
// Translates decoded SHEX instructions + RDEF/ISGN/OSGN reflection into a
// GLSL ES string suitable for a three.js ShaderMaterial. Scope is
// deliberately the subset that Burnout Paradise Remastered's 242 shaders
// actually use (see scripts/survey-dxbc.ts): 42 opcodes, mostly ALU + a
// handful of sample / flow-control / mov-conditional ops.
//
// Design:
//   - Every dxbc temp register rN becomes a GLSL vec4.
//   - Input registers vN map to a named varying derived from the ISGN
//     element that declares them (semantic + index).
//   - Output registers oN map to varyings for vs / to gl_FragData[N] for ps.
//     SV_POSITION → gl_Position. Pixel outputs o0 → gl_FragColor.
//   - Constant buffers cbN[i] become `uniform vec4 cbN[size];` on declaration;
//     emitted as `cbN[i].xyzw` at use sites.
//   - Each sample t_k, s_k → texture2D(_t{k}, uv.xy). Separate-sampler state
//     isn't representable in GLSL, so sampler declarations are tracked for
//     pairing but only the texture slot is exposed.
//   - Flow-control emits `if (a) { ... } else { ... }`, `while (true)`
//     for `loop/endloop`, `if (c) break;` for `breakc`.
//   - `movc dst, cond, a, b` becomes `dst = mix(b, a, notEqual(cond, ivec4(0)))`
//     on the declared mask.
//
// The emitter is intentionally literal. It doesn't try to produce pretty
// HLSL-shaped GLSL; it preserves the SHEX register flow one-to-one so the
// output is easy to diff against an `fxc /dumpbin` listing when debugging.

import type {
	DxbcInstruction,
	DxbcOperand,
	DecodedShader,
} from './ops';
import type { ParsedDxbc } from './parser';

// Map from ISGN/OSGN signature semantic+index → a GLSL identifier usable
// as a varying name, and a GLSL component count that matches the declared
// mask bits. Keeping these stable across vs/ps is what makes the linker
// accept our output at all.
type VaryingBinding = {
	/** GLSL identifier used as the varying (without "v_" prefix). */
	name: string;
	/** Number of components declared by ISGN/OSGN mask. */
	components: number;
	/** Source register number in the relevant signature. */
	register: number;
};

function swizzleToStr(sw: number): string {
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

function maskBits(mask: number): number {
	let n = 0;
	if (mask & 1) n++;
	if (mask & 2) n++;
	if (mask & 4) n++;
	if (mask & 8) n++;
	return n;
}

function bindingVarying(name: string, index: number): string {
	// "v_TEXCOORD3" style — stable, unambiguous, and shader-linker-friendly.
	// SV_POSITION maps to gl_Position and never needs a varying name, so this
	// returns a sentinel that callers special-case.
	if (name === 'SV_POSITION' || name === 'SV_Position') return '_SV_POSITION';
	const clean = name.replace(/[^A-Za-z0-9_]/g, '_');
	return `v_${clean}${index}`;
}

/** Map semantic+index to the three.js ShaderMaterial built-in attribute when
 *  there is one. When not null, the emitter aliases the DXBC-named attribute
 *  to the built-in via `#define` and skips the redundant `attribute`
 *  declaration (three.js already injects those). */
function threeBuiltinAttribute(sem: string, idx: number): string | null {
	const up = sem.toUpperCase();
	if (up === 'POSITION' && idx === 0) return 'position';
	if (up === 'NORMAL' && idx === 0) return 'normal';
	if (up === 'TEXCOORD' && idx === 0) return 'uv';
	return null;
}

function declareTemps(count: number): string {
	if (count === 0) return '';
	const lines: string[] = [];
	for (let i = 0; i < count; i++) lines.push(`vec4 r${i} = vec4(0.0);`);
	return lines.join('\n\t');
}

// Render an operand as a GLSL expression, already swizzled and modifier-
// applied. Works on either source operands (swizzle) or destinations (mask
// is handled separately by writeDest).
function readExpr(
	o: DxbcOperand,
	ctx: EmitCtx,
): string {
	let core = '';
	switch (o.type) {
		case 'temp': {
			const r = idxVal(o, 0);
			core = `r${r}`;
			break;
		}
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
		case 'output': {
			const r = idxVal(o, 0);
			core = `o${r}`;
			break;
		}
		case 'immediate32': {
			const v = o.immediates.slice();
			if (v.length === 1) {
				// Scalar DXBC immediates broadcast when read through any
				// component swizzle — not zero-extend. Writing `l(1.0)` to
				// a `.w` destination must land as 1.0, not 0.0 (which is
				// what `vec4(1.0, 0.0, 0.0, 0.0).w` would give).
				core = `vec4(${fmtFloat(v[0])})`;
			} else {
				while (v.length < 4) v.push(0);
				core = `vec4(${v.map(fmtFloat).join(', ')})`;
			}
			break;
		}
		case 'constant_buffer': {
			const cb = idxVal(o, 0);
			const slotIdx = o.indices[1];
			let slotExpr: string;
			if (slotIdx?.kind === 'immediate') {
				slotExpr = String(slotIdx.value);
			} else if (slotIdx?.kind === 'relative') {
				// The base operand may already be a scalar (when DXBC encoded
				// a `.x` select on the index source), so naive `.x` appending
				// would produce `r0.x.x` which is invalid GLSL. `vec4(scalar)`
				// broadcasts transparently; on a real vec4 it's a no-op.
				const baseExpr = readExpr(slotIdx.base, ctx);
				slotExpr = `int(vec4(${baseExpr}).x) + ${slotIdx.offset}`;
			} else {
				slotExpr = '0';
			}
			core = `cb${cb}[${slotExpr}]`;
			break;
		}
		case 'sampler':
		case 'resource':
			// Sample instructions consume these directly, not via readExpr.
			// Returning a reference is still useful for debug display.
			core = `/* ${o.type} ${idxVal(o, 0)} */`;
			break;
		case 'null':
			core = `vec4(0.0)`;
			break;
		case 'special_v':
			core = `gl_FragCoord`;
			break;
		default:
			core = `/* ? ${o.type} */ vec4(0.0)`;
	}

	// Swizzle (source mode == 1) or select1 (mode == 2) or already-masked
	// (mode == 0 with compCount==2 — destination, not a source read).
	let expr = core;
	if (o.selectionMode === 1) {
		expr = `${expr}.${swizzleToStr(o.swizzle)}`;
	} else if (o.selectionMode === 2) {
		expr = `${expr}.${['x','y','z','w'][o.select1]}`;
	}

	// Modifier: bit 0 = negate, bit 1 = abs.
	if (o.modifier & 2) expr = `abs(${expr})`;
	if (o.modifier & 1) expr = `-(${expr})`;
	return expr;
}

function idxVal(o: DxbcOperand, i: number): number {
	const idx = o.indices[i];
	return idx && idx.kind === 'immediate' ? idx.value : 0;
}

function fmtFloat(v: number): string {
	if (!isFinite(v)) return '0.0';
	if (Number.isInteger(v)) return v.toFixed(1);
	return v.toString();
}

// Destination operand: returns the "lvalue" string and a fixup that wraps
// the RHS to match the write mask. DXBC destinations are always `rN`-style
// (temp) or `oN`-style (output). Writes are component-masked; if the mask
// isn't xyzw, we splat the rhs and copy only the masked components.
function writeDest(
	o: DxbcOperand,
	rhs: string,
	ctx: EmitCtx,
): string {
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
		// x0[i] — flatten to x0_<idx> (we don't have a GLSL array decl for it)
		const reg = idxVal(o, 0);
		const idx = o.indices[1];
		const slot = idx?.kind === 'immediate' ? idx.value : 0;
		lvalue = `x${reg}_${slot}`;
	} else {
		return `/* unhandled dst type ${o.type} */`;
	}

	const mask = o.mask || 0xF;
	if (mask === 0xF) {
		return `${lvalue} = ${wrapSat(`vec4(${rhs})`, o, ctx)};`;
	}
	// Partial write: cast rhs up to vec4 first so `.xy` / `.z` / `.w` etc.
	// are always valid component selections regardless of whether the
	// underlying expression produced a float (scalar sample, `vec4(dot())`,
	// single-component immediate, ...) or a real vector.
	const maskStr = maskToStr(mask);
	return `${lvalue}.${maskStr} = ${wrapSat(`vec4(${rhs}).${maskStr}`, o, ctx)};`;
}

function wrapSat(rhs: string, _o: DxbcOperand, _ctx: EmitCtx): string { return rhs; }

// ---------------------------------------------------------------------------
// Emitter context
// ---------------------------------------------------------------------------

type EmitCtx = {
	programType: 'vertex' | 'pixel';
	/** Per input-register varying name + component count, populated from ISGN
	 *  and dcl_input_ps declarations. */
	inputBindings: Record<number, VaryingBinding>;
	/** Per output-register binding; SV_POSITION special-cased. */
	outputBindings: Record<number, VaryingBinding>;
	/** Resource (SRV) bindings: key=bindPoint, value=name. */
	resources: Record<number, string>;
	/** Sampler bindings: key=bindPoint, value=name. */
	samplers: Record<number, string>;
	/** Constant-buffer bindings: key=register, value={ size, variables[] }. */
	cbuffers: Record<number, { size: number; name: string }>;
	/** Temp-register count declared via dcl_temps. */
	tempCount: number;
	/** Indent level for emitted lines. */
	indent: number;
};

function makeCtx(p: ParsedDxbc): EmitCtx {
	const ctx: EmitCtx = {
		programType: p.programType === 'vertex' ? 'vertex' : 'pixel',
		inputBindings: {},
		outputBindings: {},
		resources: {},
		samplers: {},
		cbuffers: {},
		tempCount: 0,
		indent: 0,
	};
	// Seed input/output bindings from ISGN/OSGN reflection. Components is
	// pinned to 4 for non-SV bindings because varyings are always declared
	// vec4 (see the `declaredVarying` block in emitHeader).
	for (const el of p.inputs) {
		const isSv = el.systemValue === 1;
		ctx.inputBindings[el.register] = {
			name: isSv ? '_SV_POSITION' : bindingVarying(el.semanticName, el.semanticIndex),
			components: isSv ? maskBits(el.mask) : 4,
			register: el.register,
		};
	}
	for (const el of p.outputs) {
		const isSv = el.systemValue === 1;
		ctx.outputBindings[el.register] = {
			name: isSv ? '_SV_POSITION' : bindingVarying(el.semanticName, el.semanticIndex),
			components: isSv ? maskBits(el.mask) : 4,
			register: el.register,
		};
	}
	for (const b of p.reflection.resourceBindings) {
		if (b.type === 2) ctx.resources[b.bindPoint] = b.name.replace(/[^A-Za-z0-9_]/g, '_');
		else if (b.type === 3) ctx.samplers[b.bindPoint] = b.name.replace(/[^A-Za-z0-9_]/g, '_');
	}
	// Some shaders sample from resources RDEF didn't emit a binding for (the
	// names are in the string table but the binding record is absent). Fall
	// back to `_t<register>` for any unbound resource so `sample` still has
	// a GLSL uniform to name.
	// RDEF coverage gets extended from decls in emitHeader below, so just
	// guarantee every subsequent `sample` has a target by the time the body
	// gets emitted — done during the decl walk.
	for (const cb of p.reflection.constantBuffers) {
		// SM5 constant buffers declare their register via the resource binding
		// with the same name. If we don't find one, fall back to slot 0.
		const rb = p.reflection.resourceBindings.find((r) => r.type === 0 && r.name === cb.name);
		const reg = rb?.bindPoint ?? 0;
		ctx.cbuffers[reg] = { size: Math.max(1, (cb.size + 15) >> 4), name: cb.name.replace(/[^A-Za-z0-9_]/g, '_') };
	}
	return ctx;
}

function indentStr(ctx: EmitCtx): string { return '\t' + '\t'.repeat(ctx.indent); }

// ---------------------------------------------------------------------------
// Instruction emission
// ---------------------------------------------------------------------------

function emitInstruction(ins: DxbcInstruction, ctx: EmitCtx, lines: string[]): void {
	const push = (s: string) => lines.push(indentStr(ctx) + s);

	switch (ins.name) {
		case 'mov': {
			push(writeDest(ins.operands[0], readExpr(ins.operands[1], ctx), ctx));
			return;
		}
		case 'mad': {
			const a = readExpr(ins.operands[1], ctx);
			const b = readExpr(ins.operands[2], ctx);
			const c = readExpr(ins.operands[3], ctx);
			push(writeDest(ins.operands[0], `${a} * ${b} + ${c}`, ctx));
			return;
		}
		case 'mul': {
			push(writeDest(ins.operands[0], `${readExpr(ins.operands[1], ctx)} * ${readExpr(ins.operands[2], ctx)}`, ctx));
			return;
		}
		case 'add': {
			push(writeDest(ins.operands[0], `${readExpr(ins.operands[1], ctx)} + ${readExpr(ins.operands[2], ctx)}`, ctx));
			return;
		}
		case 'div': {
			push(writeDest(ins.operands[0], `${readExpr(ins.operands[1], ctx)} / ${readExpr(ins.operands[2], ctx)}`, ctx));
			return;
		}
		case 'min': case 'max': case 'sqrt': case 'exp': case 'log': case 'frc': case 'rsq': {
			// Promote every source to vec4 so two-arg built-ins like min/max
			// don't hit `min(float, vec4)` type mismatches when the DXBC
			// operands had asymmetric swizzles (one scalar-selected, the
			// other a splatted vec4 literal).
			const fn: Record<string, string> = {
				min: 'min', max: 'max', sqrt: 'sqrt', exp: 'exp2', log: 'log2', frc: 'fract', rsq: 'inversesqrt',
			};
			// log2/sqrt/inversesqrt of a negative or zero value produces NaN
			// or Inf. Original HLSL often relies on the source already being
			// non-negative (saturate before the call) but fxc may inline that
			// guard away. Without a clamp here, NaN/Inf propagates through
			// every downstream multiply and turns the whole frame black.
			// Clamp the source to a tiny positive value — mathematically a
			// no-op for valid inputs.
			const guard = (ins.name === 'log' || ins.name === 'sqrt' || ins.name === 'rsq')
				? (s: string) => `max(vec4(${s}), vec4(1e-30))`
				: (s: string) => `vec4(${s})`;
			const args = ins.operands.slice(1).map((o) => guard(readExpr(o, ctx))).join(', ');
			push(writeDest(ins.operands[0], `${fn[ins.name]}(${args})`, ctx));
			return;
		}
		case 'dp2': {
			const a = readExpr(ins.operands[1], ctx);
			const b = readExpr(ins.operands[2], ctx);
			push(writeDest(ins.operands[0], `vec4(dot(${a}.xy, ${b}.xy))`, ctx));
			return;
		}
		case 'dp3': {
			const a = readExpr(ins.operands[1], ctx);
			const b = readExpr(ins.operands[2], ctx);
			push(writeDest(ins.operands[0], `vec4(dot(${a}.xyz, ${b}.xyz))`, ctx));
			return;
		}
		case 'dp4': {
			const a = readExpr(ins.operands[1], ctx);
			const b = readExpr(ins.operands[2], ctx);
			push(writeDest(ins.operands[0], `vec4(dot(${a}, ${b}))`, ctx));
			return;
		}
		case 'movc': {
			// dst = cond ? a : b  →  mix(b, a, notEqual(cond, vec4(0))).
			// Promote all three sources to vec4 first — movc is legal on
			// single-component writes whose sources are scalar swizzles,
			// and mix/notEqual insist on matching vector types.
			const cond = readExpr(ins.operands[1], ctx);
			const a = readExpr(ins.operands[2], ctx);
			const b = readExpr(ins.operands[3], ctx);
			push(writeDest(ins.operands[0], `mix(vec4(${b}), vec4(${a}), bvec4(notEqual(vec4(${cond}), vec4(0.0))))`, ctx));
			return;
		}
		case 'lt': case 'ge': case 'eq': case 'ne': {
			// GLSL's lessThan/etc. only accept vecN on both sides. DXBC source
			// swizzles may project to scalar (selectionMode=2) so we promote
			// to vec4 first. The `vec4(bvec4)` cast turns the componentwise
			// boolean result into the -1.0/0.0 pattern DXBC semantics want.
			const cmp: Record<string, string> = { lt: 'lessThan', ge: 'greaterThanEqual', eq: 'equal', ne: 'notEqual' };
			const a = readExpr(ins.operands[1], ctx);
			const b = readExpr(ins.operands[2], ctx);
			push(writeDest(ins.operands[0], `vec4(${cmp[ins.name]}(vec4(${a}), vec4(${b})))`, ctx));
			return;
		}
		case 'sample':
		case 'sample_l':
		case 'sample_b':
		case 'sample_c_lz':
		case 'sample_c': {
			// sample dst, uv, tN, sN[, cmpOrLod]
			const uv = readExpr(ins.operands[1], ctx);
			const tOp = ins.operands[2];
			const reg = idxVal(tOp, 0);
			const tex = ctx.resources[reg] ?? `_t${reg}`;
			// 2D sample by default; cube/3D left for a future pass.
			push(writeDest(ins.operands[0], `texture2D(${tex}, ${uv}.xy)`, ctx));
			return;
		}
		case 'if': {
			// The source may already be a scalar selection (e.g. `r0.w`);
			// promote to vec4 first so `.x` is always a valid component.
			push(`if (vec4(${readExpr(ins.operands[0], ctx)}).x != 0.0) {`);
			ctx.indent++;
			return;
		}
		case 'else': {
			ctx.indent--;
			push(`} else {`);
			ctx.indent++;
			return;
		}
		case 'endif': {
			ctx.indent--;
			push(`}`);
			return;
		}
		case 'loop': {
			push(`for (int _i = 0; _i < 1024; _i++) {`);
			ctx.indent++;
			return;
		}
		case 'endloop': {
			ctx.indent--;
			push(`}`);
			return;
		}
		case 'breakc': {
			// breakc_nz src → if (src != 0) break; — same scalar-promotion
			// dance as `if`. DXBC also has breakc_z (bit 18 = 1) but that's
			// rare in our fixture; treating all breakc as _nz matches fxc's
			// default and the handful of SHEX encodings we see.
			push(`if (vec4(${readExpr(ins.operands[0], ctx)}).x != 0.0) break;`);
			return;
		}
		case 'ret': {
			// Implicit in GLSL main-return.
			return;
		}
		case 'discard': {
			push(`if (vec4(${readExpr(ins.operands[0], ctx)}).x != 0.0) discard;`);
			return;
		}
		default:
			push(`// unsupported op: ${ins.name}`);
	}
}

// ---------------------------------------------------------------------------
// Top-level emit
// ---------------------------------------------------------------------------

function emitHeader(ctx: EmitCtx, p: ParsedDxbc, decoded: DecodedShader): string[] {
	const lines: string[] = [];
	lines.push('// Auto-translated from DXBC SM' + p.programMajor + '.' + p.programMinor + ' by steward.');
	lines.push('// Stage: ' + ctx.programType);
	lines.push('precision highp float;');

	// Walk the body to compute the highest index actually used per cb
	// register. DXBC shaders routinely declare huge cb arrays (256 vec4s+)
	// but only touch the low slots. Declaring the full size blows WebGL1's
	// per-stage uniform budget; capping at `maxIndex + 1` keeps the shader
	// inside the driver limits and still compiles against the real slots.
	const cbMax: Record<number, number> = {};
	for (const ins of decoded.body) {
		for (const op of ins.operands) {
			if (op.type !== 'constant_buffer') continue;
			const reg = op.indices[0]?.kind === 'immediate' ? op.indices[0].value : 0;
			const slot = op.indices[1];
			let idx = 0;
			if (slot?.kind === 'immediate') idx = slot.value;
			else if (slot?.kind === 'relative') idx = Math.max(slot.offset, 0) + 16; // guess upper bound
			cbMax[reg] = Math.max(cbMax[reg] ?? 0, idx);
		}
	}
	// Constant buffers → `uniform vec4 cbN[size];`, sized to the actual
	// high-water mark observed in the body. RDEF's declared cb size is in
	// *bytes* and often smaller than the logical float4-slot range the
	// shader addresses (Burnout frequently reaches cb0[47] from a RDEF
	// record that reports `size=16`, i.e. one slot, because the named
	// variable itself is one vec4 but the shader indexes past it into
	// runtime-filled slots). Trust the body scan over RDEF.
	for (const regStr of Object.keys(ctx.cbuffers)) {
		const reg = Number(regStr);
		const cb = ctx.cbuffers[reg];
		const used = (cbMax[reg] ?? 0) + 1;
		const size = Math.max(1, used);
		cb.size = size;
		lines.push(`uniform vec4 cb${reg}[${size}]; // ${cb.name}`);
	}
	// dcl_constantbuffer from the SHEX stream: covers cbuffers that RDEF
	// didn't name explicitly.
	for (const d of decoded.decls) {
		if (d.decl?.kind === 'constantBuffer' && ctx.cbuffers[d.decl.register] === undefined) {
			const used = (cbMax[d.decl.register] ?? 0) + 1;
			const size = Math.max(1, used);
			ctx.cbuffers[d.decl.register] = { size, name: `cb${d.decl.register}` };
			lines.push(`uniform vec4 cb${d.decl.register}[${size}];`);
		}
	}
	// dcl_resource: register every sampled texture even when RDEF was terse.
	for (const d of decoded.decls) {
		if (d.decl?.kind === 'resource' && ctx.resources[d.decl.register] === undefined) {
			ctx.resources[d.decl.register] = `_t${d.decl.register}`;
		}
	}
	// Belt-and-braces: any `sample*` op in the body names a texture register
	// via operand[2]. If that register still isn't declared by the time we
	// get here (some bundles' RDEF + dcl_resource pair miss entries), the
	// emitter would reference an undeclared sampler. Walk the body once,
	// harvest every sampled register, and ensure `_tN` exists.
	for (const ins of decoded.body) {
		if (/^sample/.test(ins.name)) {
			const tOp = ins.operands[2];
			if (tOp && tOp.indices[0]?.kind === 'immediate') {
				const reg = tOp.indices[0].value;
				if (ctx.resources[reg] === undefined) {
					ctx.resources[reg] = `_t${reg}`;
				}
			}
		}
	}
	// Resources + samplers → combined GLSL sampler2D. We can't model
	// separate sampler state, so the emitted names match the resource bindings.
	for (const regStr of Object.keys(ctx.resources)) {
		const reg = Number(regStr);
		lines.push(`uniform sampler2D ${ctx.resources[reg]}; // t${reg}`);
	}

	// Varyings — from ISGN for pixel shaders, OSGN for vertex shaders.
	// We always declare varyings as vec4 regardless of how many components
	// the signature actually used. vs-side OSGN masks and ps-side ISGN
	// masks frequently disagree (ps reads more components than vs wrote);
	// GLSL links on name + type, so matching component counts between
	// the two stages is what matters.
	//
	// DX11 System-Value semantics (systemValue != 0) don't flow through a
	// shader-stage-to-stage varying — they come from the rasteriser / GPU.
	// We skip their varying declaration and `#define` the emitted name to
	// the matching GLSL built-in so shader bodies that read `v_SV_*`
	// expressions still compile. SV_POSITION on the ps side maps to
	// `gl_FragCoord`; SV_IsFrontFace to `gl_FrontFacing` (as a signed
	// vec4 so swizzles still work).
	const bindingSource = ctx.programType === 'pixel' ? p.inputs : p.outputs;
	const declaredVarying = new Set<string>();
	for (const el of bindingSource) {
		if (el.systemValue === 1) continue;
		const name = bindingVarying(el.semanticName, el.semanticIndex);
		// SV_IsFrontFace lives in systemValue slot 9 (D3D_NAME_IS_FRONT_FACE).
		// The exact numeric code varies, but the semantic name is stable, so
		// match on that. fxc emits it with semanticName 'SV_IsFrontFace'.
		if (/^SV_IsFrontFace$/i.test(el.semanticName)) {
			if (ctx.programType === 'pixel') {
				lines.push(`#define ${name} vec4(gl_FrontFacing ? 1.0 : -1.0)`);
			}
			// on vs-side (very unusual) skip both declaration and define;
			// the binding just goes unused.
			continue;
		}
		// Any other SV_* we don't understand: skip the varying declaration
		// and stub the name to zero so compilation at least succeeds.
		if (el.systemValue !== 0 && /^SV_/i.test(el.semanticName)) {
			if (ctx.programType === 'pixel') {
				lines.push(`#define ${name} vec4(0.0)`);
			}
			continue;
		}
		if (declaredVarying.has(name)) continue;
		declaredVarying.add(name);
		lines.push(`varying vec4 ${name};`);
	}
	// Vertex shaders also need their inputs as GLSL `attribute`s. When a
	// semantic matches a three.js ShaderMaterial built-in (position / normal
	// / uv), we alias via `#define` and skip the declaration so three.js's
	// auto-prepended `attribute` line is the sole declaration.
	//
	// For everything else (TANGENT, BLENDINDICES, BLENDWEIGHT, TEXCOORDn>=1
	// …) our SphereGeometry has no corresponding BufferAttribute. three.js
	// detects missing attribute data and silently skips the whole draw call
	// (observed: translated VS with a declared `attribute vec3 a_TANGENT0;`
	// produced zero draw calls even though the shader compiled clean).
	// Work around by stubbing those attributes to constant zero vectors via
	// `#define` so the shader body still compiles against the expected
	// names but the geometry layer doesn't need to supply anything.
	if (ctx.programType === 'vertex') {
		const seenName = new Set<string>();
		for (const el of p.inputs) {
			if (el.systemValue === 1) continue;
			const dxName = 'a_' + el.semanticName.replace(/[^A-Za-z0-9_]/g, '_') + el.semanticIndex;
			const builtin = threeBuiltinAttribute(el.semanticName, el.semanticIndex);
			const exposedName = builtin ?? dxName;
			ctx.inputBindings[el.register] = {
				name: exposedName,
				components: maskBits(el.mask),
				register: el.register,
			};
			if (seenName.has(dxName)) continue;
			seenName.add(dxName);
			if (builtin) {
				lines.push(`#define ${dxName} ${builtin}`);
			} else {
				const comps = maskBits(el.mask);
				const zero = comps === 1 ? '0.0'
					: comps === 2 ? 'vec2(0.0)'
					: comps === 3 ? 'vec3(0.0)'
					: 'vec4(0.0)';
				lines.push(`#define ${dxName} ${zero}`);
			}
		}
	}

	// dcl_temps declares N temps.
	for (const d of decoded.decls) {
		if (d.decl?.kind === 'temps') ctx.tempCount = d.decl.count;
		if (d.decl?.kind === 'indexableTemp') {
			for (let i = 0; i < d.decl.size; i++) {
				lines.push(`vec4 x${d.decl.register}_${i} = vec4(0.0);`);
			}
		}
	}
	return lines;
}

function padToVec4(name: string, components: number): string {
	if (components >= 4) return name;
	if (components === 3) return `vec4(${name}, 0.0)`;
	if (components === 2) return `vec4(${name}, 0.0, 0.0)`;
	return `vec4(${name}, 0.0, 0.0, 0.0)`;
}

export function emitGlsl(p: ParsedDxbc, decoded: DecodedShader): string {
	const ctx = makeCtx(p);
	const header = emitHeader(ctx, p, decoded);

	const body: string[] = [];
	body.push('void main() {');
	if (ctx.tempCount > 0) body.push('\t' + declareTemps(ctx.tempCount));
	// Vertex output scratch: each oN referenced in decls gets a vec4; at end
	// we copy into varyings / gl_Position. Dedup on register so multiple
	// sub-declarations for the same register (mask-split dcl_output) don't
	// emit duplicate `vec4 oN` lines.
	if (ctx.programType === 'vertex') {
		const declared = new Set<number>();
		for (const d of decoded.decls) {
			if (d.decl?.kind === 'output' || d.decl?.kind === 'outputSv') {
				if (declared.has(d.decl.register)) continue;
				declared.add(d.decl.register);
				body.push(`\tvec4 o${d.decl.register} = vec4(0.0);`);
			}
		}
	}
	for (const ins of decoded.body) emitInstruction(ins, ctx, body);

	// Copy vertex-shader o* into varyings / gl_Position at main-exit.
	if (ctx.programType === 'vertex') {
		const copied = new Set<number>();
		for (const d of decoded.decls) {
			if (d.decl?.kind === 'output' || d.decl?.kind === 'outputSv') {
				const reg = d.decl.register;
				if (copied.has(reg)) continue;
				copied.add(reg);
				const ob = ctx.outputBindings[reg];
				if (!ob) continue;
				if (ob.name === '_SV_POSITION') {
					body.push(`\tgl_Position = o${reg};`);
				} else {
					const comps = ob.components;
					const proj = comps === 1 ? '.x' : comps === 2 ? '.xy' : comps === 3 ? '.xyz' : '';
					body.push(`\t${ob.name} = o${reg}${proj};`);
				}
			}
		}
	}
	body.push('}');

	return header.join('\n') + '\n\n' + body.join('\n');
}

// DXBC SM5 → GLSL ES 3.00 emitter.
//
// Translates decoded SHEX instructions + RDEF/ISGN/OSGN reflection into a
// GLSL string for a three.js ShaderMaterial (WebGL2: three prepends
// `#version 300 es` and maps texture2D / gl_FragColor / attribute /
// varying). Scope is the opcode subset Burnout Paradise Remastered's 242
// shader programs use (see scripts/survey-dxbc.ts), plus the cheap
// neighbours of those ops; anything else is reported, never dropped
// silently (`translateDxbc(...).unsupported`).
//
// Design:
//   - Every dxbc temp register rN becomes a GLSL vec4; values follow the
//     float model in glslOperands.ts.
//   - Input registers vN map to a named varying derived from the ISGN
//     element that declares them (semantic + index).
//   - Output registers oN map to varyings for vs / to gl_FragColor for ps.
//     SV_POSITION → gl_Position.
//   - Constant buffers cbN[i] become `uniform vec4 cbN[size];`.
//   - Sampling lives in glslTexture.ts. Separate-sampler state isn't
//     representable in GLSL, so the uniform is named after the texture.
//   - Flow control emits `if`, a capped `for` for `loop/endloop`, and the
//     `_z` / `_nz` conditional forms of break / continue / return / discard.
//   - `movc dst, cond, a, b` becomes `mix(b, a, notEqual(cond, 0))`.
//
// The emitter is intentionally literal: it preserves the SHEX register flow
// one-to-one so the output diffs cleanly against an `fxc /dumpbin` listing.

import type { DxbcInstruction, DecodedShader } from './ops';
import type { ParsedDxbc } from './parser';
import {
	maskBits, readExpr, vec4Literal, immediateValue, writeDest,
	type EmitCtx, type VaryingBinding,
} from './glslOperands';
import { emitSample, samplerDeclarations, SAMPLE_OPS, DCL_RESOURCE_DIM_CUBE, RDEF_SRV_DIM_CUBE } from './glslTexture';

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

function makeCtx(p: ParsedDxbc): EmitCtx {
	const ctx: EmitCtx = {
		programType: p.programType === 'vertex' ? 'vertex' : 'pixel',
		inputBindings: {},
		outputBindings: {},
		resources: {},
		resourceKinds: {},
		samplers: {},
		cbuffers: {},
		tempCount: 0,
		indent: 0,
		saturate: false,
		unsupported: new Set(),
		outputCopy: [],
	};
	// Seed input/output bindings from ISGN/OSGN reflection. Components is
	// pinned to 4 for non-SV bindings because varyings are always declared
	// vec4 (see the `declaredVarying` block in emitHeader).
	const bind = (el: ParsedDxbc['inputs'][number]): VaryingBinding => {
		const isSv = el.systemValue === 1;
		return {
			name: isSv ? '_SV_POSITION' : bindingVarying(el.semanticName, el.semanticIndex),
			components: isSv ? maskBits(el.mask) : 4,
			register: el.register,
		};
	};
	for (const el of p.inputs) ctx.inputBindings[el.register] = bind(el);
	for (const el of p.outputs) ctx.outputBindings[el.register] = bind(el);
	for (const b of p.reflection.resourceBindings) {
		const name = b.name.replace(/[^A-Za-z0-9_]/g, '_');
		if (b.type === 2) {
			ctx.resources[b.bindPoint] = name;
			if (b.dimension === RDEF_SRV_DIM_CUBE) ctx.resourceKinds[b.bindPoint] = 'Cube';
		} else if (b.type === 3) ctx.samplers[b.bindPoint] = name;
	}
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

/** `if (cond)` test for the conditional ops; `_z` forms test for zero. */
function condition(ins: DxbcInstruction, ctx: EmitCtx): string {
	// The source may already be a scalar selection (e.g. `r0.w`); promote to
	// vec4 first so `.x` is always a valid component.
	return `vec4(${readExpr(ins.operands[0], ctx)}).x ${ins.testNonZero === false ? '==' : '!='} 0.0`;
}

/** Leave main: a vertex shader first copies its outputs out. */
function returnStatement(ctx: EmitCtx): string {
	return ctx.outputCopy.length ? `{ ${ctx.outputCopy.join(' ')} return; }` : 'return;';
}

function emitInstruction(ins: DxbcInstruction, ctx: EmitCtx, lines: string[]): void {
	const push = (s: string) => { if (s) lines.push(indentStr(ctx) + s); };
	ctx.saturate = ins.saturate;
	const ops = ins.operands;
	const src = (i: number) => readExpr(ops[i], ctx);

	if (SAMPLE_OPS.has(ins.name)) {
		push(emitSample(ins, ctx));
		return;
	}

	switch (ins.name) {
		case 'mov':
			push(writeDest(ops[0], src(1), ctx));
			return;
		case 'mad':
			push(writeDest(ops[0], `${src(1)} * ${src(2)} + ${src(3)}`, ctx));
			return;
		case 'mul':
			push(writeDest(ops[0], `${src(1)} * ${src(2)}`, ctx));
			return;
		case 'add':
			push(writeDest(ops[0], `${src(1)} + ${src(2)}`, ctx));
			return;
		case 'div':
			push(writeDest(ops[0], `${src(1)} / ${src(2)}`, ctx));
			return;
		case 'min': case 'max': case 'sqrt': case 'exp': case 'log': case 'frc': case 'rsq': {
			// Promote every source to vec4 so two-arg built-ins like min/max
			// don't hit `min(float, vec4)` type mismatches when the DXBC
			// operands had asymmetric swizzles.
			const fn: Record<string, string> = {
				min: 'min', max: 'max', sqrt: 'sqrt', exp: 'exp2', log: 'log2', frc: 'fract', rsq: 'inversesqrt',
			};
			// log2/sqrt/inversesqrt of a negative or zero value produces NaN
			// or Inf. Original HLSL often relies on the source already being
			// non-negative (saturate before the call) but fxc may inline that
			// guard away. Without a clamp here, NaN/Inf propagates through
			// every downstream multiply and turns the whole frame black.
			const guard = (ins.name === 'log' || ins.name === 'sqrt' || ins.name === 'rsq')
				? (s: string) => `max(vec4(${s}), vec4(1e-30))`
				: (s: string) => `vec4(${s})`;
			const args = ops.slice(1).map((o) => guard(readExpr(o, ctx))).join(', ');
			push(writeDest(ops[0], `${fn[ins.name]}(${args})`, ctx));
			return;
		}
		case 'dp2':
			push(writeDest(ops[0], `vec4(dot(${src(1)}.xy, ${src(2)}.xy))`, ctx));
			return;
		case 'dp3':
			push(writeDest(ops[0], `vec4(dot(${src(1)}.xyz, ${src(2)}.xyz))`, ctx));
			return;
		case 'dp4':
			push(writeDest(ops[0], `vec4(dot(${src(1)}, ${src(2)}))`, ctx));
			return;
		case 'movc':
			// Promote all three sources to vec4 first — movc is legal on
			// single-component writes whose sources are scalar swizzles.
			push(writeDest(ops[0], `mix(vec4(${src(3)}), vec4(${src(2)}), bvec4(notEqual(vec4(${src(1)}), vec4(0.0))))`, ctx));
			return;
		case 'lt': case 'ge': case 'eq': case 'ne': {
			// The `vec4(bvec4)` cast gives the 1.0/0.0 pattern of the float model.
			const cmp: Record<string, string> = { lt: 'lessThan', ge: 'greaterThanEqual', eq: 'equal', ne: 'notEqual' };
			push(writeDest(ops[0], `vec4(${cmp[ins.name]}(vec4(${src(1)}), vec4(${src(2)})))`, ctx));
			return;
		}
		case 'and':
			// The game's shaders `and` comparison masks together (`eq r.xyz,
			// v, 0` then two `and`s = "all components zero") or with
			// l(0x3f800000) to turn a mask into 1.0. Under the 1.0/0.0 model
			// both are "nonzero a selects b".
			push(writeDest(ops[0], `vec4(notEqual(vec4(${src(1)}), vec4(0.0))) * vec4(${src(2)})`, ctx));
			return;
		case 'imul': {
			// imul destHi, destLo, a, b: the skinned vertex shaders scale a
			// bone index by 3 (rows per bone matrix) in destLo.
			const product = `vec4(${src(2)}) * vec4(${src(3)})`;
			push(writeDest(ops[1], product, ctx));
			push(writeDest(ops[0], `floor((${product}) / 4294967296.0)`, ctx));
			return;
		}
		case 'sincos':
			// sincos destSin, destCos, src (either destination may be null).
			push(writeDest(ops[0], `sin(vec4(${src(2)}))`, ctx));
			push(writeDest(ops[1], `cos(vec4(${src(2)}))`, ctx));
			return;
		case 'if':
			push(`if (${condition(ins, ctx)}) {`);
			ctx.indent++;
			return;
		case 'else':
			ctx.indent--;
			push(`} else {`);
			ctx.indent++;
			return;
		case 'endif':
		case 'endloop':
			ctx.indent--;
			push(`}`);
			return;
		case 'loop':
			// Capped so a translation slip can't hang the GPU.
			push(`for (int _i = 0; _i < 1024; _i++) {`);
			ctx.indent++;
			return;
		case 'break':
			push('break;');
			return;
		case 'breakc':
			push(`if (${condition(ins, ctx)}) break;`);
			return;
		case 'continue':
			push('continue;');
			return;
		case 'continuec':
			push(`if (${condition(ins, ctx)}) continue;`);
			return;
		case 'ret':
			push(returnStatement(ctx));
			return;
		case 'retc':
			push(`if (${condition(ins, ctx)}) ${returnStatement(ctx)}`);
			return;
		case 'discard':
			push(`if (${condition(ins, ctx)}) discard;`);
			return;
		case 'nop':
			return;
		default:
			ctx.unsupported.add(ins.name);
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
	// but only touch the low slots. Declaring the full size blows the
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
			else if (slot?.kind === 'relative') idx = relativeUpperBound(p, reg, Math.max(slot.offset, 0));
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
		cb.size = Math.max(1, (cbMax[reg] ?? 0) + 1);
		lines.push(`uniform vec4 cb${reg}[${cb.size}]; // ${cb.name}`);
	}
	// dcl_constantbuffer from the SHEX stream: covers cbuffers that RDEF
	// didn't name explicitly.
	for (const d of decoded.decls) {
		if (d.decl?.kind === 'constantBuffer' && ctx.cbuffers[d.decl.register] === undefined) {
			const size = Math.max(1, (cbMax[d.decl.register] ?? 0) + 1);
			ctx.cbuffers[d.decl.register] = { size, name: `cb${d.decl.register}` };
			lines.push(`uniform vec4 cb${d.decl.register}[${size}];`);
		}
	}
	// dcl_resource: register every sampled texture even when RDEF was terse;
	// its dimension is authoritative for the sampler type.
	for (const d of decoded.decls) {
		if (d.decl?.kind !== 'resource') continue;
		if (ctx.resources[d.decl.register] === undefined) ctx.resources[d.decl.register] = `_t${d.decl.register}`;
		ctx.resourceKinds[d.decl.register] = d.decl.dim === DCL_RESOURCE_DIM_CUBE ? 'Cube' : '2D';
	}
	// Belt-and-braces: any `sample*` op in the body names a texture register
	// via operand[2]. If that register still isn't declared by the time we
	// get here, the emitter would reference an undeclared sampler.
	for (const ins of decoded.body) {
		if (!SAMPLE_OPS.has(ins.name)) continue;
		const tOp = ins.operands[2];
		if (tOp && tOp.indices[0]?.kind === 'immediate') {
			const reg = tOp.indices[0].value;
			if (ctx.resources[reg] === undefined) ctx.resources[reg] = `_t${reg}`;
		}
	}
	lines.push(...samplerDeclarations(ctx, decoded.body));

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
	// expressions still compile.
	const bindingSource = ctx.programType === 'pixel' ? p.inputs : p.outputs;
	const declaredVarying = new Set<string>();
	for (const el of bindingSource) {
		if (el.systemValue === 1) continue;
		const name = bindingVarying(el.semanticName, el.semanticIndex);
		if (/^SV_IsFrontFace$/i.test(el.semanticName)) {
			// vFace is a boolean: ~0 front, 0 back. The double-sided shaders
			// flip their normal with `movc n, vFace, n, -n`, so a back face
			// must read 0, not -1.
			if (ctx.programType === 'pixel') {
				lines.push(`#define ${name} vec4(gl_FrontFacing ? 1.0 : 0.0)`);
			}
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
	// Everything else (TANGENT, BLENDINDICES, BLENDWEIGHT, TEXCOORDn>=1 …)
	// is stubbed to a constant via `#define`: three.js skips the whole draw
	// when a declared attribute has no BufferAttribute. vehicleShaderInputs'
	// bindVertexStreams swaps the stubs for real streams the geometry has.
	if (ctx.programType === 'vertex') {
		const seenName = new Set<string>();
		for (const el of p.inputs) {
			if (el.systemValue === 1) continue;
			const dxName = 'a_' + el.semanticName.replace(/[^A-Za-z0-9_]/g, '_') + el.semanticIndex;
			const builtin = threeBuiltinAttribute(el.semanticName, el.semanticIndex);
			ctx.inputBindings[el.register] = {
				name: builtin ?? dxName,
				components: maskBits(el.mask),
				register: el.register,
			};
			if (seenName.has(dxName)) continue;
			seenName.add(dxName);
			if (builtin) {
				lines.push(`#define ${dxName} ${builtin}`);
			} else {
				const comps = maskBits(el.mask);
				// BLENDWEIGHT is the skin-blend weight vector. Stubbing it to zero
				// makes a skinned vertex collapse to the origin (pos = boneMatrix *
				// pos * 0). With the bone palette seeded to identity at rest (see
				// shaderEngineConstants), defaulting the dominant weight to 1 makes
				// the vertex resolve to its rest position instead.
				const isBlendWeight = /^BLENDWEIGHT$/i.test(el.semanticName);
				const one = isBlendWeight ? '1.0' : '0.0';
				const stub = comps === 1 ? one
					: comps === 2 ? (isBlendWeight ? 'vec2(1.0, 0.0)' : 'vec2(0.0)')
					: comps === 3 ? (isBlendWeight ? 'vec3(1.0, 0.0, 0.0)' : 'vec3(0.0)')
					: (isBlendWeight ? 'vec4(1.0, 0.0, 0.0, 0.0)' : 'vec4(0.0)');
				lines.push(`#define ${dxName} ${stub}`);
			}
		}
	}

	for (const d of decoded.decls) {
		if (d.decl?.kind === 'temps') ctx.tempCount = d.decl.count;
	}
	return lines;
}

// A dynamically indexed read (`cb0[r0.x + 48]`) can reach anywhere in the
// array variable it starts in, so the uniform must cover that variable's
// whole RDEF extent: the vehicle shaders index their 128-row deformation
// array this way, and a short uniform makes the rows past its end read
// nothing. Without a matching variable, guess 16 slots past the base.
function relativeUpperBound(p: ParsedDxbc, reg: number, baseSlot: number): number {
	const binding = p.reflection.resourceBindings.find((r) => r.type === 0 && r.bindPoint === reg);
	const cbs = p.reflection.constantBuffers.filter((cb) => (binding ? cb.name === binding.name : reg === 0));
	for (const cb of cbs) {
		for (const v of cb.variables) {
			const start = Math.floor(v.startOffset / 16);
			const end = Math.ceil((v.startOffset + v.size) / 16);
			if (baseSlot >= start && baseSlot < end) return end - 1;
		}
	}
	return baseSlot + 16;
}

/** Vertex stage: copy each declared oN into its varying / gl_Position. */
function vertexOutputCopy(ctx: EmitCtx, decoded: DecodedShader): string[] {
	const out: string[] = [];
	const copied = new Set<number>();
	for (const d of decoded.decls) {
		if (d.decl?.kind !== 'output' && d.decl?.kind !== 'outputSv') continue;
		const reg = d.decl.register;
		if (copied.has(reg)) continue;
		copied.add(reg);
		const ob = ctx.outputBindings[reg];
		if (!ob) continue;
		if (ob.name === '_SV_POSITION') {
			out.push(`gl_Position = o${reg};`);
		} else {
			const comps = ob.components;
			const proj = comps === 1 ? '.x' : comps === 2 ? '.xy' : comps === 3 ? '.xyz' : '';
			out.push(`${ob.name} = o${reg}${proj};`);
		}
	}
	return out;
}

/** Locals declared at the top of main: temps, vertex output scratch,
 *  indexable temp arrays and the immediate constant buffer. */
function mainLocals(ctx: EmitCtx, decoded: DecodedShader): string[] {
	const out: string[] = [];
	for (let i = 0; i < ctx.tempCount; i++) out.push(`vec4 r${i} = vec4(0.0);`);
	const declared = new Set<number>();
	for (const d of decoded.decls) {
		const decl = d.decl;
		if (!decl) continue;
		if (ctx.programType === 'vertex' && (decl.kind === 'output' || decl.kind === 'outputSv')) {
			// Mask-split dcl_output can declare one register twice.
			if (declared.has(decl.register)) continue;
			declared.add(decl.register);
			out.push(`vec4 o${decl.register} = vec4(0.0);`);
		} else if (decl.kind === 'indexableTemp') {
			out.push(`vec4 x${decl.register}[${Math.max(1, decl.size)}];`);
		} else if (decl.kind === 'immediateConstantBuffer') {
			const rows: string[] = [];
			for (let i = 0; i + 4 <= decl.bits.length; i += 4) rows.push(vec4Literal(decl.bits.slice(i, i + 4).map(immediateValue)));
			if (rows.length) out.push(`vec4 icb[${rows.length}] = vec4[${rows.length}](${rows.join(', ')});`);
		}
	}
	return out;
}

/** GLSL source plus everything the emitter could not translate. */
export function emitGlslWithReport(p: ParsedDxbc, decoded: DecodedShader): { source: string; unsupported: string[] } {
	const ctx = makeCtx(p);
	const header = emitHeader(ctx, p, decoded);
	if (ctx.programType === 'vertex') ctx.outputCopy = vertexOutputCopy(ctx, decoded);

	const body: string[] = ['void main() {'];
	for (const line of mainLocals(ctx, decoded)) body.push('\t' + line);
	decoded.body.forEach((ins, k) => {
		// The closing `ret` falls through to the output copy below.
		if (ins.name === 'ret' && ctx.indent === 0 && k === decoded.body.length - 1) return;
		emitInstruction(ins, ctx, body);
	});
	for (const line of ctx.outputCopy) body.push('\t' + line);
	body.push('}');

	return { source: header.join('\n') + '\n\n' + body.join('\n'), unsupported: Array.from(ctx.unsupported) };
}

export function emitGlsl(p: ParsedDxbc, decoded: DecodedShader): string {
	return emitGlslWithReport(p, decoded).source;
}


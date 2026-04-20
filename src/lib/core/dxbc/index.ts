// Public entry point for the DXBC → GLSL ES translator. Takes a block of
// bytes (typically block 1 of a ShaderProgramBuffer resource), parses the
// DXBC container + SHEX tokens, and emits a GLSL ES string.
//
// The emitter is a best-effort translator targeting the opcode subset that
// Burnout Paradise Remastered actually uses. Un-handled instructions are
// left as `// unsupported op: <name>` comments so the shader source stays
// readable even when compilation fails. Callers compile and display the
// error separately.

import { parseDxbc, isDxbc, type ParsedDxbc } from './parser';
import { decodeShex, type DecodedShader } from './ops';
import { emitGlsl } from './glsl';

export type TranslatedShader = {
	parsed: ParsedDxbc;
	decoded: DecodedShader;
	/** GLSL source; always returned even when the translator bailed. */
	source: string;
	/** List of opcodes that showed up but weren't fully translated. */
	unsupported: string[];
	/** Stage label (vs_5_0 / ps_5_0 / ...). */
	programLabel: string;
	/** Short textual summary for the UI: "ps_5_0 · 117 instr · 4 tex · 1 cb". */
	summary: string;
};

export function translateDxbc(bytes: Uint8Array): TranslatedShader {
	const parsed = parseDxbc(bytes);
	const decoded = decodeShex(parsed.shexTokens);
	const source = emitGlsl(parsed, decoded);
	const unsupported = Array.from(new Set(decoded.body.filter((i) => i.name.startsWith('OP_') || /unsupported/.test(i.name)).map((i) => i.name)));
	const programLabel =
		(parsed.programType === 'vertex' ? 'vs_' :
		 parsed.programType === 'pixel' ? 'ps_' :
		 parsed.programType === 'geometry' ? 'gs_' :
		 parsed.programType === 'hull' ? 'hs_' :
		 parsed.programType === 'domain' ? 'ds_' : 'cs_')
		+ parsed.programMajor + '_' + parsed.programMinor;
	const numTex = parsed.reflection.resourceBindings.filter((r) => r.type === 2).length;
	const numCb = parsed.reflection.resourceBindings.filter((r) => r.type === 0).length;
	const summary = `${programLabel} · ${decoded.body.length} instr · ${numTex} tex · ${numCb} cb`;
	return { parsed, decoded, source, unsupported, programLabel, summary };
}

export { parseDxbc, isDxbc, decodeShex, emitGlsl };
export type { ParsedDxbc } from './parser';
export type { DecodedShader, DxbcInstruction } from './ops';

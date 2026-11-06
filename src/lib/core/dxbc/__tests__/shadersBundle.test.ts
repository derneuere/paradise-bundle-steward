// Every program in the game's shader bundle translates without an
// unsupported op. Needs an untracked copy of SHADERS.BNDL; skipped without.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBundle } from '../../bundle';
import { getResourceBlocks } from '../../resourceManager';
import { SHADER_PROGRAM_BUFFER_TYPE_ID } from '../../shader';
import { translateDxbc } from '..';

const FIXTURE = ['.claude/sim-fixtures/SHADERS.BNDL', 'example/SHADERS.BNDL']
	.map((p) => path.resolve(p))
	.find((p) => fs.existsSync(p));

describe.skipIf(!FIXTURE)('SHADERS.BNDL translation', () => {
	const programs = (() => {
		if (!FIXTURE) return [];
		const buf = fs.readFileSync(FIXTURE);
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
		const bundle = parseBundle(ab);
		return bundle.resources
			.filter((r) => r.resourceTypeId === SHADER_PROGRAM_BUFFER_TYPE_ID)
			.map((r) => getResourceBlocks(ab, bundle, r)[1])
			.filter((b): b is Uint8Array => !!b)
			.map((b) => translateDxbc(b));
	})();

	it('translates all 242 programs', () => {
		expect(programs).toHaveLength(242);
	});

	it('emits no unsupported op or operand in any program', () => {
		const bad = programs.filter((t) => t.unsupported.length > 0 || /unsupported op|unhandled dst|\/\* \?/.test(t.source));
		expect(bad.map((t) => `${t.summary}: ${t.unsupported.join(', ')}`)).toEqual([]);
	});

	it('declares the reflection probe of the env-mapped programs as a cube', () => {
		const cubes = programs.filter((t) => /uniform samplerCube \w+;/.test(t.source));
		expect(cubes).toHaveLength(43);
		for (const t of cubes) {
			const name = /uniform samplerCube (\w+);/.exec(t.source)?.[1];
			const coords = [...t.source.matchAll(new RegExp(`texture\\(${name}, vec4\\([^()]+\\)\\.(\\w+)\\)`, 'g'))].map((m) => m[1]);
			expect(coords.length).toBeGreaterThan(0);
			expect(new Set(coords)).toEqual(new Set(['xyz']));
		}
	});
});

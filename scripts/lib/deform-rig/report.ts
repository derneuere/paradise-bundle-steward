import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ParsedDeformationSpec, Vec3 } from '../../../src/lib/core/deformationSpec';
import type { TargetBody } from './geometry';
import { readDeformationSpec } from './io';
import { crashBehaviour, partName } from './parts';
import { engineProblems, specSkinRows, toMeshSpace } from './spec';

// The target mesh reads skin rows by blend index. When the donor lays out a
// different number of rows, crashes still work but dent the wrong vertices.
export function reportSkinRows(donor: ParsedDeformationSpec, meshRows: number, vehDir?: string): void {
	const rows = specSkinRows(donor);
	if (meshRows === 0 || meshRows === rows) {
		console.log(`[skin] donor provides ${rows} rows, target mesh reads ${meshRows || 'none'}: OK`);
		return;
	}
	console.warn(`[skin] WARNING: target mesh reads ${meshRows} deformation rows, donor provides ${rows}. `
		+ 'Crashes will dent the wrong parts of the mesh. Prefer the car the mesh was built from as donor.');
	if (!vehDir) return;
	const matches = fs.readdirSync(vehDir).filter((f) => /_AT\.BIN$/i.test(f)).filter((f) => {
		try { return specSkinRows(readDeformationSpec(path.join(vehDir, f)).spec) === meshRows; } catch { return false; }
	});
	console.warn(`[skin] donors in ${vehDir} with ${meshRows} rows: ${matches.length ? matches.join(' ') : 'none'}`);
}

function inBox(p: Vec3, t: TargetBody): boolean {
	return [0, 1, 2].every((k) => {
		const m = Math.max(0.25, t.half[k] * 0.2);
		return p[k] >= t.min[k] - m && p[k] <= t.max[k] + m;
	});
}

// Re-reads the written bundle and fails loudly on anything the engine would
// trip over, plus the caller's rig-specific expectations.
export function checkRig(outPath: string, target: TargetBody, extra: (spec: ParsedDeformationSpec) => string[]): ParsedDeformationSpec {
	const spec = readDeformationSpec(outPath).spec;
	console.log('\n=== rig ===');
	spec.ikParts.forEach((p, i) => {
		console.log(`  ${String(i).padStart(2)}  ${partName(p.partType).padEnd(16)} gfx ${String(p.partGraphics).padStart(3)}  ${crashBehaviour(p, spec.tagPoints)}`);
	});
	const sensors = spec.sensors.slice(0, spec.numDeformationSensors).map((s) => toMeshSpace(spec, s.initialOffset));
	// Wheel tags sit on the axle centre, below the body meshes.
	const wheelTags = new Set(spec.wheels.map((w) => w.iValue));
	const bodyTags = spec.tagPoints.filter((_, i) => !wheelTags.has(i)).map((t) => toMeshSpace(spec, t.initialPosition));
	const fails = [
		...engineProblems(spec, target.parts.length),
		...extra(spec),
		...(sensors.every((p) => inBox(p, target)) ? [] : ['a sensor sits outside the target body']),
		...(bodyTags.every((p) => inBox(p, target)) ? [] : ['a tag point sits outside the target body']),
	];
	console.log(`\n${spec.ikParts.length} IK parts, ${spec.tagPoints.length} tags, ${specSkinRows(spec)} skin rows, `
		+ `${spec.glassPanes.length} glass, wheels at ${spec.wheels.map((w) => `[${w.position.slice(0, 3).map((v) => v.toFixed(2))}]`).join(' ')}`);
	if (fails.length) {
		for (const f of fails) console.error(`  FAIL ${f}`);
		throw new Error('rig verification failed');
	}
	console.log('all checks pass');
	return spec;
}

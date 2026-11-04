import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBundle, writeBundleFresh } from '../../../src/lib/core/bundle';
import { extractResourceRaw } from '../../../src/lib/core/registry';
import {
	parseDeformationSpecData, writeDeformationSpecData, DEFORMATION_SPEC_TYPE_ID, type ParsedDeformationSpec,
} from '../../../src/lib/core/deformationSpec';
import type { ParsedBundle } from '../../../src/lib/core/types';

export function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

export const hasFlag = (name: string) => process.argv.includes(`--${name}`);

export function readArrayBuffer(p: string): ArrayBuffer {
	const b = fs.readFileSync(p);
	// A Node Buffer views a shared pool, so copy out exactly this file's bytes.
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

export type SpecFile = { ab: ArrayBuffer; bundle: ParsedBundle; spec: ParsedDeformationSpec };

export function readDeformationSpec(atPath: string): SpecFile {
	const ab = readArrayBuffer(atPath);
	const bundle = parseBundle(ab);
	const res = bundle.resources.find((r) => r.resourceTypeId === DEFORMATION_SPEC_TYPE_ID);
	if (!res) throw new Error(`${atPath} has no DeformationSpec (0x1001C)`);
	return { ab, bundle, spec: parseDeformationSpecData(extractResourceRaw(ab, bundle, res)) };
}

export const cloneSpec = (s: ParsedDeformationSpec): ParsedDeformationSpec => JSON.parse(JSON.stringify(s));

// Writes `spec` into the target's own _AT bundle so its attribs and audio
// resources ride along unchanged.
export function writeRigBundle(target: SpecFile, spec: ParsedDeformationSpec, outPath: string): void {
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	const bytes = writeDeformationSpecData(spec);
	const out = writeBundleFresh(target.bundle, target.ab, { overrides: { resources: { [DEFORMATION_SPEC_TYPE_ID]: bytes } } });
	fs.writeFileSync(outPath, Buffer.from(out));
	console.log(`[write] spec ${bytes.length} B -> bundle ${out.byteLength} B -> ${outPath}`);
}

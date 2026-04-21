// Sweep every VEH_*_AT.BIN in example/, parse its AttribSys vault, and
// aggregate numeric/categorical ranges per class.field. Output is designed
// to inform sensible min/max hints in the editor UI.
//
// Usage (tsx wrapper in package.json):
//   npx tsx scripts/analyze-attribsys-ranges.ts
//
// The report highlights: f32 ranges (min, max, mean, stddev, distinct-count),
// int ranges + distinct values (for enum-like fields), bool ratios, and
// distinct bytes8 ASCII values. Refspec class-key counts reveal cross-vehicle
// variability for each reference slot.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBundle } from '../src/lib/core/bundle';
import { extractResourceRaw } from '../src/lib/core/registry/extract';
import { resourceCtxFromBundle } from '../src/lib/core/registry/handler';
import { parseAttribSys } from '../src/lib/core/attribSys';

const ATTRIB_SYS_TYPE_ID = 0x1C;

const dir = 'example';
const files = fs
	.readdirSync(dir)
	.filter((f) => /^VEH_.*_AT\.BIN$/i.test(f))
	.sort();

console.log(`scanning ${files.length} VEH_*_AT.BIN bundles...`);

// Unified numeric stats — we can't distinguish int from f32 at runtime
// reliably (an f32 of 1.0 round-trips through a number as an integer), so
// we track both behaviors on the same record.
type NumStats = {
	kind: 'num';
	count: number;
	min: number;
	max: number;
	sum: number;
	sumSq: number;
	allIntegral: boolean; // true iff every observed value has Number.isInteger
	distinct: Map<number, number>; // capped at 128 entries
};
// Legacy aliases so the rest of the code keeps working.
type FloatStats = NumStats;
type IntStats = NumStats;
type BoolStats = { kind: 'bool'; trueCount: number; falseCount: number };
type Vec4Stats = { kind: 'vec4'; comp: [FloatStats, FloatStats, FloatStats, FloatStats] };
type BytesStats = { kind: 'bytes8'; distinct: Map<string, number> };
type RefSpecStats = {
	kind: 'refspec';
	classKey: Map<string, number>;
	collectionKey: Map<string, number>;
};
type RefSpecArrStats = {
	kind: 'refspec_array';
	lengths: Map<number, number>;
	perSlotClassKey: Map<number, Map<string, number>>;
};
type IntArrStats = { kind: 'i32_array'; lengths: Map<number, number>; values: IntStats };
type BigIntStats = { kind: 'bigint'; distinct: Map<string, number> };

type FieldStats =
	| FloatStats | IntStats | BoolStats | Vec4Stats
	| BytesStats | RefSpecStats | RefSpecArrStats | IntArrStats | BigIntStats;

function newNumStats(): NumStats {
	return { kind: 'num', count: 0, min: Infinity, max: -Infinity, sum: 0, sumSq: 0, allIntegral: true, distinct: new Map() };
}
function addNum(s: NumStats, v: number): void {
	if (!Number.isFinite(v)) return;
	s.count++;
	if (v < s.min) s.min = v;
	if (v > s.max) s.max = v;
	s.sum += v;
	s.sumSq += v * v;
	if (!Number.isInteger(v)) s.allIntegral = false;
	if (s.distinct.size < 128) s.distinct.set(v, (s.distinct.get(v) ?? 0) + 1);
	else if (s.distinct.has(v)) s.distinct.set(v, s.distinct.get(v)! + 1);
}
// Legacy aliases.
const newFloatStats = newNumStats;
const newIntStats = newNumStats;
const addFloat = addNum;
const addInt = addNum;

// class → field → stats
const perClass = new Map<string, Map<string, FieldStats>>();

function getFieldStats(className: string, fieldName: string, kind: FieldStats['kind']): FieldStats {
	let cls = perClass.get(className);
	if (!cls) {
		cls = new Map();
		perClass.set(className, cls);
	}
	let stats = cls.get(fieldName);
	if (!stats) {
		switch (kind) {
			case 'num': stats = newNumStats(); break;
			case 'bool': stats = { kind: 'bool', trueCount: 0, falseCount: 0 }; break;
			case 'vec4':
				stats = { kind: 'vec4', comp: [newNumStats(), newNumStats(), newNumStats(), newNumStats()] };
				break;
			case 'bytes8': stats = { kind: 'bytes8', distinct: new Map() }; break;
			case 'refspec': stats = { kind: 'refspec', classKey: new Map(), collectionKey: new Map() }; break;
			case 'refspec_array':
				stats = { kind: 'refspec_array', lengths: new Map(), perSlotClassKey: new Map() };
				break;
			case 'i32_array': stats = { kind: 'i32_array', lengths: new Map(), values: newNumStats() }; break;
			case 'bigint': stats = { kind: 'bigint', distinct: new Map() }; break;
		}
		cls.set(fieldName, stats!);
	}
	return stats!;
}

function decodeBytes8Ascii(bytes: number[]): string | null {
	const out: number[] = [];
	for (const b of bytes) {
		if (b === 0) break;
		if (b < 0x20 || b >= 0x7F) return null;
		out.push(b);
	}
	return String.fromCharCode(...out);
}

let processed = 0;
let failed = 0;

for (const file of files) {
	const full = path.join(dir, file);
	try {
		const buf = fs.readFileSync(full);
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		const bundle = parseBundle(ab);
		const resource = bundle.resources.find((r) => r.resourceTypeId === ATTRIB_SYS_TYPE_ID);
		if (!resource) continue;
		const raw = extractResourceRaw(ab, bundle, resource);
		const ctx = resourceCtxFromBundle(bundle);
		const parsed = parseAttribSys(raw, ctx.littleEndian);

		for (const attr of parsed.attributes) {
			for (const [fieldName, value] of Object.entries(attr.fields)) {
				if (typeof value === 'number') {
					addNum(getFieldStats(attr.className, fieldName, 'num') as NumStats, value);
				} else if (typeof value === 'boolean') {
					const s = getFieldStats(attr.className, fieldName, 'bool') as BoolStats;
					if (value) s.trueCount++;
					else s.falseCount++;
				} else if (typeof value === 'bigint') {
					const s = getFieldStats(attr.className, fieldName, 'bigint') as BigIntStats;
					const k = BigInt.asUintN(64, value).toString(16);
					s.distinct.set(k, (s.distinct.get(k) ?? 0) + 1);
				} else if (Array.isArray(value)) {
					if (value.length === 4 && value.every((x) => typeof x === 'number' && !Number.isInteger(x) || Math.abs(x as number) > 2 ** 24)) {
						// vec4 — heuristic: length 4 with fractional bits or large magnitude
						const s = getFieldStats(attr.className, fieldName, 'vec4') as Vec4Stats;
						for (let i = 0; i < 4; i++) addFloat(s.comp[i], value[i] as number);
					} else if (value.length === 4 && value.every((x) => typeof x === 'number' && Number.isFinite(x) && !Number.isInteger(x))) {
						const s = getFieldStats(attr.className, fieldName, 'vec4') as Vec4Stats;
						for (let i = 0; i < 4; i++) addFloat(s.comp[i], value[i] as number);
					} else if (value.length === 8 && value.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 255)) {
						// bytes8
						const s = getFieldStats(attr.className, fieldName, 'bytes8') as BytesStats;
						const ascii = decodeBytes8Ascii(value as number[]);
						const key = ascii !== null ? `"${ascii}"` : (value as number[]).map((b) => b.toString(16).padStart(2, '0')).join('');
						s.distinct.set(key, (s.distinct.get(key) ?? 0) + 1);
					} else if (value.every((x) => typeof x === 'number')) {
						// Generic numeric array — treat as i32_array
						const s = getFieldStats(attr.className, fieldName, 'i32_array') as IntArrStats;
						s.lengths.set(value.length, (s.lengths.get(value.length) ?? 0) + 1);
						for (const n of value as number[]) addInt(s.values, n);
					} else if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null && 'classKey' in (value[0] as object)) {
						// refspec_array
						const s = getFieldStats(attr.className, fieldName, 'refspec_array') as RefSpecArrStats;
						s.lengths.set(value.length, (s.lengths.get(value.length) ?? 0) + 1);
						for (let i = 0; i < value.length; i++) {
							const rs = value[i] as { classKey: bigint; collectionKey: bigint };
							let slot = s.perSlotClassKey.get(i);
							if (!slot) {
								slot = new Map();
								s.perSlotClassKey.set(i, slot);
							}
							const key = BigInt.asUintN(64, rs.classKey).toString(16);
							slot.set(key, (slot.get(key) ?? 0) + 1);
						}
					}
				} else if (value && typeof value === 'object' && 'classKey' in (value as object)) {
					// refspec
					const rs = value as { classKey: bigint; collectionKey: bigint };
					const s = getFieldStats(attr.className, fieldName, 'refspec') as RefSpecStats;
					const ck = BigInt.asUintN(64, rs.classKey).toString(16);
					const kk = BigInt.asUintN(64, rs.collectionKey).toString(16);
					s.classKey.set(ck, (s.classKey.get(ck) ?? 0) + 1);
					s.collectionKey.set(kk, (s.collectionKey.get(kk) ?? 0) + 1);
				}
			}
		}
		processed++;
	} catch (err) {
		failed++;
		console.warn(`  [skip] ${file}: ${(err as Error).message}`);
	}
}

console.log(`processed ${processed}, skipped ${failed}\n`);

// ---- Reporting ----

function fmt(n: number, digits = 4): string {
	if (!Number.isFinite(n)) return '∞';
	if (n === 0) return '0';
	const abs = Math.abs(n);
	if (abs < 0.001 || abs > 1e6) return n.toExponential(2);
	return n.toFixed(digits);
}

function summarizeFloat(s: NumStats): string {
	if (s.count === 0) return '—';
	const mean = s.sum / s.count;
	const variance = Math.max(0, s.sumSq / s.count - mean * mean);
	const std = Math.sqrt(variance);
	const uTag = s.distinct.size === 128 ? '128+' : `${s.distinct.size}`;
	return `[${fmt(s.min)}, ${fmt(s.max)}] μ=${fmt(mean)} σ=${fmt(std)} n=${s.count} (${uTag}u)`;
}

function summarizeInt(s: NumStats): string {
	if (s.count === 0) return '—';
	const values = [...s.distinct.keys()].sort((a, b) => a - b);
	const preview = values.length <= 8
		? values.map((v) => `${v}`).join(',')
		: `${values.slice(0, 4).join(',')}…${values.slice(-2).join(',')}`;
	return `[${s.min}, ${s.max}] n=${s.count} (${values.length}u: ${preview})`;
}

function classify(s: FieldStats): 'numeric-wide' | 'numeric-narrow' | 'numeric-const' | 'categorical' | 'other' {
	if (s.kind === 'num') {
		if (s.distinct.size <= 1) return 'numeric-const';
		if (!s.allIntegral && s.max - s.min < 1e-6) return 'numeric-const';
		if (s.allIntegral && s.distinct.size <= 8) return 'categorical';
		return s.distinct.size < 8 ? 'numeric-narrow' : 'numeric-wide';
	}
	return 'other';
}

const classList = [...perClass.keys()].sort();

console.log('═'.repeat(80));
console.log('PER-CLASS FIELD RANGES');
console.log('═'.repeat(80));

for (const className of classList) {
	const fields = perClass.get(className)!;
	console.log(`\n## ${className}  (${fields.size} fields)`);
	console.log('─'.repeat(80));
	const rows: string[] = [];
	for (const [fieldName, s] of fields) {
		let line = '';
		if (s.kind === 'num') {
			const tag = s.allIntegral ? 'int' : 'f32';
			line = `${fieldName.padEnd(40)} ${tag}    ${s.allIntegral ? summarizeInt(s) : summarizeFloat(s)}`;
		} else if (s.kind === 'bool') {
			const total = s.trueCount + s.falseCount;
			line = `${fieldName.padEnd(40)} bool   true=${s.trueCount}/${total}`;
		} else if (s.kind === 'vec4') {
			line = `${fieldName.padEnd(40)} vec4\n` + s.comp.map((c, i) => `   [${i}] ${summarizeFloat(c)}`).join('\n');
		} else if (s.kind === 'bytes8') {
			const entries = [...s.distinct.entries()].sort((a, b) => b[1] - a[1]);
			const preview = entries.slice(0, 4).map(([k, n]) => `${k}(${n})`).join(', ');
			line = `${fieldName.padEnd(40)} bytes8 (${entries.length}u: ${preview}${entries.length > 4 ? '…' : ''})`;
		} else if (s.kind === 'refspec') {
			const cks = [...s.classKey.keys()];
			line = `${fieldName.padEnd(40)} ref    class=${cks.length}u key=${s.collectionKey.size}u`;
		} else if (s.kind === 'refspec_array') {
			const lens = [...s.lengths.entries()].map(([l, n]) => `${l}×${n}`).join(', ');
			line = `${fieldName.padEnd(40)} ref[]  lens={${lens}} slots=${s.perSlotClassKey.size}`;
		} else if (s.kind === 'i32_array') {
			const lens = [...s.lengths.entries()].map(([l, n]) => `${l}×${n}`).join(', ');
			line = `${fieldName.padEnd(40)} int[]  lens={${lens}} vals=${summarizeInt(s.values)}`;
		} else if (s.kind === 'bigint') {
			line = `${fieldName.padEnd(40)} u64    ${s.distinct.size}u distinct`;
		}
		rows.push(line);
	}
	for (const row of rows) console.log(row);
}

// ---- Pattern summary: fields that look like categoricals / constants / narrow ranges ----

console.log('\n' + '═'.repeat(80));
console.log('SENSITIVITY / BOUND SUGGESTIONS');
console.log('═'.repeat(80));
console.log('\nFields flagged as constant across all vehicles (safe defaults):');
for (const [className, fields] of perClass) {
	for (const [fieldName, s] of fields) {
		if (classify(s) === 'numeric-const' && s.kind === 'num') {
			console.log(`  ${className}.${fieldName} = ${s.allIntegral ? s.min : fmt(s.min)}`);
		}
	}
}

console.log('\nFields flagged as categorical (small set of distinct int values):');
for (const [className, fields] of perClass) {
	for (const [fieldName, s] of fields) {
		if (s.kind === 'num' && s.allIntegral && classify(s) === 'categorical') {
			const vs = [...s.distinct.keys()].sort((a, b) => a - b);
			console.log(`  ${className}.${fieldName}: {${vs.join(', ')}}`);
		}
	}
}

console.log('\nHigh-variance f32 fields (σ > |μ|/2, suggesting wide editing range):');
for (const [className, fields] of perClass) {
	for (const [fieldName, s] of fields) {
		if (s.kind === 'num' && !s.allIntegral && s.count > 4) {
			const mean = s.sum / s.count;
			const std = Math.sqrt(Math.max(0, s.sumSq / s.count - mean * mean));
			if (Math.abs(mean) > 0 && std / Math.abs(mean) > 0.5) {
				console.log(`  ${className}.${fieldName}: ${summarizeFloat(s)}`);
			}
		}
	}
}

console.log('\nLow-variance f32 fields (σ / μ < 5%, sensitive to small edits):');
for (const [className, fields] of perClass) {
	for (const [fieldName, s] of fields) {
		if (s.kind === 'num' && !s.allIntegral && s.count > 4 && s.distinct.size > 1) {
			const mean = s.sum / s.count;
			const std = Math.sqrt(Math.max(0, s.sumSq / s.count - mean * mean));
			if (Math.abs(mean) > 1e-9 && std / Math.abs(mean) < 0.05) {
				console.log(`  ${className}.${fieldName}: ${summarizeFloat(s)}`);
			}
		}
	}
}

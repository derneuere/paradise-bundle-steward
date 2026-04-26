// Unified bundle CLI — dispatcher over the handler registry in
// src/lib/core/registry. Every registered resource type is usable through
// the same set of subcommands with no per-type code in this file.
//
// Usage (from the steward repo root):
//   npm run bundle -- list           <bundle>
//   npm run bundle -- parse          <bundle> [--type <key>]
//   npm run bundle -- dump           <bundle> <out.json> [--type <key>]
//   npm run bundle -- pack           <in.json> <out-bundle> [--type <key>]
//   npm run bundle -- roundtrip      <bundle> [--type <key>]
//   npm run bundle -- convert        <bundle> <out-bundle> --container <bndl|bnd2> --platform <pc|x360|ps3> [--allow-unknown]
//   npm run bundle -- export-gltf    <bundle> <out.gltf|out.glb>
//   npm run bundle -- import-gltf    <orig-bundle> <edited.gltf> <out-bundle>
//   npm run bundle -- roundtrip-gltf <bundle>
//
// The *-gltf subcommands operate on the worldlogic glTF representation of
// logical world data (StreetData for now; TrafficData / AISections / TriggerData
// to follow). See docs/worldlogic-gltf-roundtrip.md.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle, writeBundleFresh, convertBundle, type ConvertTarget } from '../src/lib/core/bundle';
import { extractResourceSize } from '../src/lib/core/resourceManager';
import {
	registry,
	getHandlerByKey,
	getHandlerByTypeId,
	extractResourceRaw,
	resourceCtxFromBundle,
	type ResourceHandler,
} from '../src/lib/core/registry';
import {
	exportWorldLogicToGltf,
	exportWorldLogicToGltfJson,
	importWorldLogicFromGltf,
	type WorldLogicPayload,
} from '../src/lib/core/gltf';
import {
	parseStreetDataData,
	writeStreetDataData,
} from '../src/lib/core/streetData';
import {
	parseTrafficDataData,
	writeTrafficDataData,
} from '../src/lib/core/trafficData';
import {
	parseAISectionsData,
	writeAISectionsData,
} from '../src/lib/core/aiSections';
import {
	parseTriggerDataData,
	writeTriggerDataData,
} from '../src/lib/core/triggerData';
import { RESOURCE_TYPE_IDS } from '../src/lib/core/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

function loadBundleBytes(p: string): { buffer: ArrayBuffer; bytes: Uint8Array } {
	const raw = fs.readFileSync(p);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return { buffer: bytes.buffer, bytes };
}

type CliArgs = {
	positional: string[];
	options: Map<string, string>;
};

function parseArgs(argv: string[]): CliArgs {
	const positional: string[] = [];
	const options = new Map<string, string>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith('--')) {
			const key = arg.slice(2);
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith('--')) {
				options.set(key, next);
				i++;
			} else {
				options.set(key, 'true');
			}
		} else {
			positional.push(arg);
		}
	}
	return { positional, options };
}

/**
 * Pick a specific resource of the handler's type out of the bundle. Defaults
 * to the first match; `--index N` (0-based) picks the N-th. Throws with a
 * helpful range message if N is out of bounds or no resources of that type
 * exist.
 *
 * This exists because some bundles (notably WORLDCOL.BIN) contain hundreds
 * of resources of the same type, and the first is often a degenerate stub —
 * for stress/fuzz to be meaningful you need to target a real one.
 */
function pickResource(
	bundle: ReturnType<typeof parseBundle>,
	handler: ResourceHandler,
	args: CliArgs,
) {
	const matching = bundle.resources.filter((r) => r.resourceTypeId === handler.typeId);
	if (matching.length === 0) {
		throw new Error(`Bundle has no resource of type ${handler.key} (0x${handler.typeId.toString(16)}).`);
	}
	const raw = args.options.get('index');
	if (raw === undefined) return { resource: matching[0], typedIndex: 0, typedCount: matching.length };
	const idx = Number(raw);
	if (!Number.isInteger(idx) || idx < 0 || idx >= matching.length) {
		throw new Error(
			`--index ${raw} out of range: ${handler.key} has ${matching.length} resource(s) (valid 0..${matching.length - 1}).`,
		);
	}
	return { resource: matching[idx], typedIndex: idx, typedCount: matching.length };
}

/**
 * Pick the handler for an operation. If --type is provided, look it up by key.
 * Otherwise fall back to the bundle's resources: if exactly one known handler
 * matches, use it; otherwise error with a helpful list.
 */
function pickHandler(bundle: ReturnType<typeof parseBundle>, args: CliArgs): ResourceHandler {
	const typeKey = args.options.get('type');
	if (typeKey) {
		const h = getHandlerByKey(typeKey);
		if (!h) {
			const known = registry.map((r) => r.key).join(', ');
			throw new Error(`Unknown --type ${typeKey}. Registered: ${known}`);
		}
		if (!bundle.resources.some((r) => r.resourceTypeId === h.typeId)) {
			throw new Error(`Bundle does not contain a resource of type ${h.key} (0x${h.typeId.toString(16)}).`);
		}
		return h;
	}
	const matched: ResourceHandler[] = [];
	for (const resource of bundle.resources) {
		const h = getHandlerByTypeId(resource.resourceTypeId);
		if (h && !matched.includes(h)) matched.push(h);
	}
	if (matched.length === 0) {
		throw new Error('No registered handler matches any resource in this bundle.');
	}
	if (matched.length > 1) {
		const keys = matched.map((h) => h.key).join(', ');
		throw new Error(`Bundle contains multiple handled resource types (${keys}). Pass --type to disambiguate.`);
	}
	return matched[0];
}

// JSON serialization with bigint-safe encoding so `dump` output survives
// `pack` round-tripping.
function jsonReplacer(_key: string, value: unknown): unknown {
	if (typeof value === 'bigint') return { __bigint: value.toString() };
	return value;
}
function jsonReviver(_key: string, value: unknown): unknown {
	if (value && typeof value === 'object' && '__bigint' in (value as Record<string, unknown>)) {
		return BigInt((value as { __bigint: string }).__bigint);
	}
	return value;
}

type DumpDocument = {
	sourceBundlePath: string;
	sourceBundleSize: number;
	sourceBundleSha1: string;
	resourceType: number;
	resourceKey: string;
	resourceRawSize: number;
	resourceRawSha1: string;
	data: unknown;
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdList(args: CliArgs) {
	const [bundlePath] = args.positional;
	if (!bundlePath) throw new Error('Usage: list <bundle>');
	const { buffer, bytes } = loadBundleBytes(bundlePath);
	const bundle = parseBundle(buffer);

	console.log(`bundle: ${path.resolve(bundlePath)}`);
	console.log(`  size: ${bytes.byteLength} bytes, sha1 ${sha1(bytes)}`);
	const containerLabel = bundle.bundle1Extras
		? `bndl/v${bundle.bundle1Extras.bndVersion} (Bundle 1 prototype)`
		: `bnd2/v${bundle.header.version} (Bundle 2)`;
	console.log(`  container: ${containerLabel}`);
	console.log(`  platform: ${bundle.header.platform}, flags: 0x${bundle.header.flags.toString(16)}, resources: ${bundle.resources.length}`);
	console.log(`  resourceDataOffsets: [${bundle.header.resourceDataOffsets.map((o) => '0x' + o.toString(16)).join(', ')}]`);
	console.log('');
	console.log('idx  typeId     handler         caps        size');
	console.log('---  ---------  --------------  ----------  ----');
	for (let i = 0; i < bundle.resources.length; i++) {
		const r = bundle.resources[i];
		const handler = getHandlerByTypeId(r.resourceTypeId);
		const key = handler ? handler.key : '-';
		const caps = handler ? `${handler.caps.read ? 'r' : '-'}${handler.caps.write ? 'w' : '-'}` : '--';
		let size = 0;
		for (let bi = 0; bi < 3; bi++) {
			const s = extractResourceSize(r.sizeAndAlignmentOnDisk[bi]);
			if (s > 0) { size = s; break; }
		}
		const idx = i.toString().padStart(3, ' ');
		const typeId = `0x${r.resourceTypeId.toString(16).padStart(5, '0')}  `;
		const keyPad = key.padEnd(14, ' ');
		const capsPad = caps.padEnd(10, ' ');
		console.log(`${idx}  ${typeId} ${keyPad}  ${capsPad}  ${size}`);
	}
}

function cmdParse(args: CliArgs) {
	const [bundlePath] = args.positional;
	if (!bundlePath) throw new Error('Usage: parse <bundle> [--type <key>] [--index <n>]');
	const { buffer } = loadBundleBytes(bundlePath);
	const bundle = parseBundle(buffer);
	const handler = pickHandler(bundle, args);
	const { resource, typedIndex, typedCount } = pickResource(bundle, handler, args);
	const ctx = resourceCtxFromBundle(bundle);
	const raw = extractResourceRaw(buffer, bundle, resource);
	const model = handler.parseRaw(raw, ctx);

	console.log(`${handler.name} [${handler.key}] (index ${typedIndex} / ${typedCount}): ${handler.describe(model)}`);
	console.log(`  raw: ${raw.byteLength} bytes, sha1 ${sha1(raw)}`);
}

function cmdDump(args: CliArgs) {
	const [bundlePath, outPath] = args.positional;
	if (!bundlePath || !outPath) throw new Error('Usage: dump <bundle> <out.json> [--type <key>] [--index <n>]');
	const { buffer, bytes } = loadBundleBytes(bundlePath);
	const bundle = parseBundle(buffer);
	const handler = pickHandler(bundle, args);
	const { resource } = pickResource(bundle, handler, args);
	const ctx = resourceCtxFromBundle(bundle);
	const raw = extractResourceRaw(buffer, bundle, resource);
	const model = handler.parseRaw(raw, ctx);

	const doc: DumpDocument = {
		sourceBundlePath: path.resolve(bundlePath),
		sourceBundleSize: bytes.byteLength,
		sourceBundleSha1: sha1(bytes),
		resourceType: handler.typeId,
		resourceKey: handler.key,
		resourceRawSize: raw.byteLength,
		resourceRawSha1: sha1(raw),
		data: model,
	};
	fs.writeFileSync(outPath, JSON.stringify(doc, jsonReplacer, 2));
	console.log(`Parsed ${handler.name}: ${handler.describe(model)}`);
	console.log(`Wrote ${outPath} (${raw.byteLength} bytes raw, sha1 ${sha1(raw)})`);
}

function cmdPack(args: CliArgs) {
	const [jsonPath, outPath] = args.positional;
	if (!jsonPath || !outPath) throw new Error('Usage: pack <in.json> <out-bundle> [--type <key>]');
	const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'), jsonReviver) as DumpDocument;
	const handler = args.options.has('type')
		? getHandlerByKey(args.options.get('type')!)
		: getHandlerByKey(doc.resourceKey) ?? getHandlerByTypeId(doc.resourceType);
	if (!handler) throw new Error(`Could not resolve handler for dump (resourceKey=${doc.resourceKey}, typeId=0x${doc.resourceType.toString(16)}).`);
	if (!handler.caps.write) throw new Error(`Handler ${handler.key} is read-only — cannot pack.`);

	const { buffer } = loadBundleBytes(doc.sourceBundlePath);
	const bundle = parseBundle(buffer);
	const ctx = resourceCtxFromBundle(bundle);
	const bytes = handler.writeRaw!(doc.data as never, ctx);

	const outBuffer = writeBundleFresh(bundle, buffer, {
		overrides: { resources: { [handler.typeId]: bytes } },
	});
	fs.writeFileSync(outPath, new Uint8Array(outBuffer));
	console.log(`Packed ${handler.name}: raw ${bytes.byteLength} bytes sha1 ${sha1(bytes)}`);
	console.log(`Wrote ${outPath} (${outBuffer.byteLength} bytes)`);
}

function cmdConvert(args: CliArgs) {
	const [bundlePath, outPath] = args.positional;
	if (!bundlePath || !outPath) {
		throw new Error(
			'Usage: convert <bundle> <out-bundle> --container <bndl|bnd2> --platform <pc|x360|ps3> [--allow-unknown]',
		);
	}
	const containerArg = args.options.get('container');
	const platformArg = args.options.get('platform');
	if (!containerArg || !platformArg) {
		throw new Error('convert requires --container <bndl|bnd2> and --platform <pc|x360|ps3>');
	}
	if (containerArg !== 'bndl' && containerArg !== 'bnd2') {
		throw new Error(`--container must be 'bndl' or 'bnd2' (got '${containerArg}')`);
	}
	const platformMap: Record<string, 1 | 2 | 3> = { pc: 1, x360: 2, ps3: 3 };
	const platform = platformMap[platformArg.toLowerCase()];
	if (!platform) {
		throw new Error(`--platform must be pc, x360, or ps3 (got '${platformArg}')`);
	}
	const allowUnknown = args.options.has('allow-unknown');

	const { buffer, bytes } = loadBundleBytes(bundlePath);
	const bundle = parseBundle(buffer, { strict: false });
	const target: ConvertTarget = {
		container: containerArg,
		platform,
		unknownResourcePolicy: allowUnknown ? 'passthrough' : 'fail',
	};
	const out = convertBundle(bundle, buffer, target);
	fs.writeFileSync(outPath, new Uint8Array(out));

	const sourceContainer = bundle.bundle1Extras
		? `bndl/v${bundle.bundle1Extras.bndVersion}`
		: `bnd2/v${bundle.header.version}`;
	const platformName = platform === 1 ? 'PC' : platform === 2 ? 'X360' : 'PS3';
	console.log(`source: ${path.resolve(bundlePath)} (${sourceContainer}, platform ${bundle.header.platform}, ${bytes.byteLength} B)`);
	console.log(`target: ${containerArg}/v${containerArg === 'bndl' ? '5' : '2'}, ${platformName}`);
	console.log(`Wrote ${outPath} (${out.byteLength} B, sha1 ${sha1(new Uint8Array(out))})`);
}

function cmdRoundtrip(args: CliArgs) {
	const [bundlePath] = args.positional;
	if (!bundlePath) throw new Error('Usage: roundtrip <bundle> [--type <key>] [--index <n>]');
	const { buffer, bytes } = loadBundleBytes(bundlePath);
	const bundle = parseBundle(buffer);
	const handler = pickHandler(bundle, args);
	const { resource, typedIndex, typedCount } = pickResource(bundle, handler, args);
	const ctx = resourceCtxFromBundle(bundle);
	const raw = extractResourceRaw(buffer, bundle, resource);

	if (!handler.caps.write) {
		console.log(`${handler.name} is read-only (no writer registered). Parse-only check:`);
		const model = handler.parseRaw(raw, ctx);
		console.log(`  ${handler.describe(model)}`);
		return;
	}

	const model1 = handler.parseRaw(raw, ctx);
	console.log(`${handler.name} [${handler.key}] (index ${typedIndex} / ${typedCount})`);
	console.log(`Parse (before): ${handler.describe(model1)}`);
	console.log(`  original raw: ${raw.byteLength} bytes, sha1 ${sha1(raw)}`);

	const write1 = handler.writeRaw!(model1, ctx);
	console.log(`  re-encoded raw: ${write1.byteLength} bytes, sha1 ${sha1(write1)}`);

	// Per-resource round-trip: parse the re-encoded bytes directly and
	// re-write. Avoids the full bundle repack, which isn't meaningful for
	// multi-instance bundles where it would clobber every resource of the
	// type with the same payload.
	const model2 = handler.parseRaw(write1, ctx);
	console.log(`Parse (after):  ${handler.describe(model2)}`);

	const write2 = handler.writeRaw!(model2, ctx);
	if (sha1(write2) !== sha1(write1)) {
		console.log(`ROUNDTRIP FAILED — writer not idempotent (write2 sha1 ${sha1(write2)})`);
		process.exitCode = 1;
		return;
	}

	// Additional byte-exact check against the raw input when possible.
	if (sha1(write1) === sha1(raw)) {
		console.log('ROUNDTRIP OK — byte-exact with original + writer is idempotent');
	} else {
		console.log('ROUNDTRIP OK — writer is idempotent (not byte-exact with original)');
	}

	// Full pipeline repack only makes sense for single-instance bundles.
	if (typedCount === 1 && typedIndex === 0) {
		const outBuffer = writeBundleFresh(bundle, buffer, {
			overrides: { resources: { [handler.typeId]: write1 } },
		});
		console.log(`  full repacked bundle: ${outBuffer.byteLength} bytes (was ${bytes.byteLength})`);
	}
}

function cmdStress(args: CliArgs) {
	const [bundlePath] = args.positional;
	if (!bundlePath) throw new Error('Usage: stress <bundle> [--type <key>] [--index <n>] [--scenario <name>]');
	const scenarioFilter = args.options.get('scenario');

	const { buffer } = loadBundleBytes(bundlePath);
	const bundle = parseBundle(buffer);
	const handler = pickHandler(bundle, args);

	if (!handler.caps.write || !handler.writeRaw) {
		throw new Error(`${handler.name} is read-only — cannot run stress scenarios (no writer).`);
	}
	if (!handler.stressScenarios || handler.stressScenarios.length === 0) {
		const withScenarios = registry
			.filter((h) => h.stressScenarios && h.stressScenarios.length > 0)
			.map((h) => h.key);
		const listing = withScenarios.length === 0
			? '(none registered yet)'
			: withScenarios.join(', ');
		throw new Error(
			`No stress scenarios registered for ${handler.key}. Handlers with scenarios: ${listing}`,
		);
	}

	const ctx = resourceCtxFromBundle(bundle);
	const { resource, typedIndex, typedCount } = pickResource(bundle, handler, args);
	const raw = extractResourceRaw(buffer, bundle, resource);
	const baseline = handler.parseRaw(raw, ctx);
	console.log(`${handler.name} [${handler.key}] (index ${typedIndex} / ${typedCount}): ${handler.describe(baseline)}`);
	console.log(`  original raw: ${raw.byteLength} bytes, sha1 ${sha1(raw)}`);

	// Bigint-safe deep clone — reuse the same replacer/reviver the dump/pack
	// commands use so scenarios can freely tag bigint fields.
	const cloneModel = <T,>(model: T): T =>
		JSON.parse(JSON.stringify(model, jsonReplacer), jsonReviver) as T;

	const scenarios = scenarioFilter
		? handler.stressScenarios.filter((s) => s.name === scenarioFilter)
		: handler.stressScenarios;

	if (scenarioFilter && scenarios.length === 0) {
		const available = handler.stressScenarios.map((s) => s.name).join(', ');
		throw new Error(`No scenario named "${scenarioFilter}". Available: ${available}`);
	}

	let passed = 0;
	let failed = 0;

	for (const scenario of scenarios) {
		const label = scenario.description ? `${scenario.name} — ${scenario.description}` : scenario.name;
		try {
			const mutated = scenario.mutate(cloneModel(baseline));
			const write1 = handler.writeRaw!(mutated, ctx);
			const reparsed = handler.parseRaw(write1, ctx);
			const write2 = handler.writeRaw!(reparsed, ctx);

			const problems: string[] = [];
			if (!bytesEqual(write1, write2)) {
				problems.push(
					`writer not idempotent: write1 sha1 ${sha1(write1)} (${write1.byteLength} B), write2 sha1 ${sha1(write2)} (${write2.byteLength} B)`,
				);
			}
			if (scenario.verify) {
				problems.push(...scenario.verify(mutated, reparsed));
			}

			if (problems.length === 0) {
				console.log(`  PASS  ${label}  (${write1.byteLength} B, sha1 ${sha1(write1).slice(0, 12)})`);
				passed++;
			} else {
				console.log(`  FAIL  ${label}`);
				for (const p of problems) console.log(`        - ${p}`);
				failed++;
			}
		} catch (err) {
			console.log(`  FAIL  ${label}`);
			console.log(`        - threw: ${err instanceof Error ? err.message : String(err)}`);
			failed++;
		}
	}

	console.log(`\nstress: ${passed}/${scenarios.length} passed${failed > 0 ? `, ${failed} failed` : ''}`);
	if (failed > 0) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Fuzz command
// ---------------------------------------------------------------------------

/**
 * mulberry32 — tiny seedable PRNG with a 2^32 period.
 * Good enough for reproducible structural fuzzing; not cryptographic.
 */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6D2B79F5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type MutationOp = { op: string; path: string; a?: number; b?: number };

/**
 * Walk the top-level properties of `model` and apply 1–3 random structural
 * mutations to its arrays. Records every mutation into `trace` so a failing
 * iteration can be reproduced and understood.
 *
 * Intentionally generic: only touches top-level arrays. Nested arrays and
 * primitive fields are untouched — fuzzing is about exercising count-derived
 * pointer math and writer branches, not about random garbage. Handlers that
 * need deeper or paired mutations should rely on stress scenarios instead.
 */
function randomMutate<T extends Record<string, unknown>>(
	model: T,
	rng: () => number,
	trace: MutationOp[],
): T {
	const arrayKeys: string[] = [];
	for (const key of Object.keys(model)) {
		if (Array.isArray(model[key])) arrayKeys.push(key);
	}
	if (arrayKeys.length === 0) return model;

	const numMutations = 1 + Math.floor(rng() * 3); // 1..3
	const next: Record<string, unknown> = { ...model };

	for (let m = 0; m < numMutations; m++) {
		const key = arrayKeys[Math.floor(rng() * arrayKeys.length)];
		const arr = (next[key] as unknown[]).slice();
		const len = arr.length;

		// Op distribution: pop, dup, swap, clear, append.
		// Bias away from 'clear' (destructive) — 1 in 12 slots.
		const roll = Math.floor(rng() * 12);
		if (len === 0) {
			// Nothing to mutate on an empty array this round.
			trace.push({ op: 'noop-empty', path: key });
			continue;
		}

		if (roll < 3) {
			const idx = Math.floor(rng() * len);
			arr.splice(idx, 1);
			trace.push({ op: 'pop', path: key, a: idx });
		} else if (roll < 6) {
			const idx = Math.floor(rng() * len);
			// Deep clone via JSON with bigint tagging so CgsID-style fields survive.
			const clone = JSON.parse(
				JSON.stringify(arr[idx], jsonReplacer),
				jsonReviver,
			);
			arr.push(clone);
			trace.push({ op: 'dup', path: key, a: idx });
		} else if (roll < 9) {
			if (len >= 2) {
				const i = Math.floor(rng() * len);
				let j = Math.floor(rng() * len);
				if (j === i) j = (j + 1) % len;
				const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
				trace.push({ op: 'swap', path: key, a: i, b: j });
			} else {
				trace.push({ op: 'noop-swap-single', path: key });
				continue;
			}
		} else if (roll < 10) {
			arr.length = 0;
			trace.push({ op: 'clear', path: key });
		} else {
			// append clone of last element (structurally safer than "new zeroed element"
			// because we don't know the element schema).
			const clone = JSON.parse(
				JSON.stringify(arr[len - 1], jsonReplacer),
				jsonReviver,
			);
			arr.push(clone);
			trace.push({ op: 'append', path: key, a: len - 1 });
		}

		next[key] = arr;
	}

	return next as T;
}

function formatTrace(trace: MutationOp[]): string {
	return trace
		.map((t) => {
			if (t.op === 'swap') return `swap ${t.path} @${t.a} ↔ @${t.b}`;
			if (t.op === 'pop') return `pop ${t.path} @${t.a}`;
			if (t.op === 'dup') return `dup ${t.path} @${t.a}`;
			if (t.op === 'append') return `append ${t.path} @${t.a}`;
			if (t.op === 'clear') return `clear ${t.path}`;
			return `${t.op} ${t.path}`;
		})
		.join(', ');
}

function cmdFuzz(args: CliArgs) {
	const [bundlePath] = args.positional;
	if (!bundlePath) throw new Error('Usage: fuzz <bundle> [--type <key>] [--index <n>] [--iterations N] [--seed S]');

	const iterations = Number(args.options.get('iterations') ?? 50);
	if (!Number.isFinite(iterations) || iterations <= 0) {
		throw new Error(`--iterations must be a positive integer (got ${args.options.get('iterations')})`);
	}
	const seed = args.options.has('seed')
		? Number(args.options.get('seed'))
		: (Date.now() & 0xFFFFFFFF) >>> 0;
	if (!Number.isFinite(seed)) {
		throw new Error(`--seed must be a number (got ${args.options.get('seed')})`);
	}

	const { buffer } = loadBundleBytes(bundlePath);
	const bundle = parseBundle(buffer);
	const handler = pickHandler(bundle, args);

	if (!handler.caps.write || !handler.writeRaw) {
		throw new Error(`${handler.name} is read-only — cannot fuzz without a writer.`);
	}

	const ctx = resourceCtxFromBundle(bundle);
	const { resource, typedIndex, typedCount } = pickResource(bundle, handler, args);
	const raw = extractResourceRaw(buffer, bundle, resource);
	const baseline = handler.parseRaw(raw, ctx);

	console.log(`Fuzzing ${handler.name} [${handler.key}] (index ${typedIndex} / ${typedCount}): ${handler.describe(baseline)}`);
	console.log(`  original raw: ${raw.byteLength} bytes, sha1 ${sha1(raw)}`);
	console.log(`  seed: ${seed}, iterations: ${iterations}`);

	// Verify baseline writer works before we spend time on mutations — a broken
	// baseline writer would produce a cascade of meaningless fuzz "failures".
	try {
		const w1 = handler.writeRaw!(baseline, ctx);
		const reparsed = handler.parseRaw(w1, ctx);
		const w2 = handler.writeRaw!(reparsed, ctx);
		if (!bytesEqual(w1, w2)) {
			throw new Error(`baseline writer is not idempotent (${w1.byteLength} B vs ${w2.byteLength} B)`);
		}
	} catch (err) {
		console.log(`FUZZ ABORT — baseline writer check failed: ${err instanceof Error ? err.message : String(err)}`);
		process.exitCode = 1;
		return;
	}

	const rng = mulberry32(seed);
	const tolerated = handler.fuzz?.tolerateErrors ?? [];

	// Bigint-safe deep clone — reuse the same replacer/reviver the dump/pack
	// commands use so handlers with CgsID fields don't lose data.
	const cloneModel = <T,>(m: T): T =>
		JSON.parse(JSON.stringify(m, jsonReplacer), jsonReviver) as T;

	let ok = 0;
	let toleratedCount = 0;
	let failed = 0;

	for (let i = 0; i < iterations; i++) {
		const trace: MutationOp[] = [];
		let mutated: unknown;
		try {
			mutated = randomMutate(cloneModel(baseline) as Record<string, unknown>, rng, trace);
		} catch (err) {
			console.log(`  iter ${String(i).padStart(4, ' ')}  FAIL  mutate threw: ${err instanceof Error ? err.message : String(err)}`);
			console.log(`        trace: ${formatTrace(trace)}`);
			failed++;
			continue;
		}

		try {
			const write1 = handler.writeRaw!(mutated as never, ctx);
			const reparsed = handler.parseRaw(write1, ctx);
			const write2 = handler.writeRaw!(reparsed, ctx);

			if (!bytesEqual(write1, write2)) {
				console.log(
					`  iter ${String(i).padStart(4, ' ')}  FAIL  writer not idempotent ` +
						`(write1 ${write1.byteLength} B sha1 ${sha1(write1).slice(0, 12)}, ` +
						`write2 ${write2.byteLength} B sha1 ${sha1(write2).slice(0, 12)})`,
				);
				console.log(`        trace: ${formatTrace(trace)}`);
				failed++;
				continue;
			}

			ok++;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (tolerated.some((re) => re.test(msg))) {
				toleratedCount++;
				continue;
			}
			console.log(`  iter ${String(i).padStart(4, ' ')}  FAIL  threw: ${msg}`);
			console.log(`        trace: ${formatTrace(trace)}`);
			failed++;
		}
	}

	console.log(`\nfuzz: ${ok} ok, ${toleratedCount} tolerated, ${failed} failed`);
	if (failed > 0) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// glTF worldlogic commands
// ---------------------------------------------------------------------------

type ExtractedResources = {
	payload: WorldLogicPayload;
	raws: Partial<Record<keyof WorldLogicPayload, Uint8Array>>;
};

/**
 * Scan a bundle for every resource the worldlogic glTF flow knows about and
 * parse each one. The caller gets back a WorldLogicPayload plus the raw
 * bytes (keyed by the same slot names) for diagnostics.
 */
function extractWorldLogicResources(buffer: ArrayBuffer): ExtractedResources {
	const bundle = parseBundle(buffer);
	const out: ExtractedResources = { payload: {}, raws: {} };

	const streetRes = bundle.resources.find(
		(r) => r.resourceTypeId === RESOURCE_TYPE_IDS.STREET_DATA,
	);
	if (streetRes) {
		const raw = extractResourceRaw(buffer, bundle, streetRes);
		out.raws.streetData = raw;
		out.payload.streetData = parseStreetDataData(raw);
	}

	const trafficRes = bundle.resources.find(
		(r) => r.resourceTypeId === RESOURCE_TYPE_IDS.TRAFFIC_DATA,
	);
	if (trafficRes) {
		const raw = extractResourceRaw(buffer, bundle, trafficRes);
		out.raws.trafficData = raw;
		out.payload.trafficData = parseTrafficDataData(raw, true);
	}

	const aiRes = bundle.resources.find(
		(r) => r.resourceTypeId === RESOURCE_TYPE_IDS.AI_SECTIONS,
	);
	if (aiRes) {
		const raw = extractResourceRaw(buffer, bundle, aiRes);
		out.raws.aiSections = raw;
		out.payload.aiSections = parseAISectionsData(raw, true);
	}

	const triggerRes = bundle.resources.find(
		(r) => r.resourceTypeId === RESOURCE_TYPE_IDS.TRIGGER_DATA,
	);
	if (triggerRes) {
		const raw = extractResourceRaw(buffer, bundle, triggerRes);
		out.raws.triggerData = raw;
		out.payload.triggerData = parseTriggerDataData(raw, true);
	}

	return out;
}

function summarizePayload(payload: WorldLogicPayload): string {
	const parts: string[] = [];
	if (payload.streetData) {
		const m = payload.streetData;
		parts.push(
			`streetData(streets ${m.streets.length}, junctions ${m.junctions.length}, roads ${m.roads.length})`,
		);
	}
	if (payload.trafficData) {
		const m = payload.trafficData;
		let sectionCount = 0;
		let rungCount = 0;
		for (const h of m.hulls) {
			sectionCount += h.sections.length;
			rungCount += h.rungs.length;
		}
		parts.push(
			`trafficData(hulls ${m.hulls.length}, sections ${sectionCount}, rungs ${rungCount})`,
		);
	}
	if (payload.aiSections) {
		const m = payload.aiSections;
		parts.push(
			`aiSections(sections ${m.sections.length}, resetPairs ${m.sectionResetPairs.length})`,
		);
	}
	if (payload.triggerData) {
		const m = payload.triggerData;
		parts.push(
			`triggerData(landmarks ${m.landmarks.length}, generic ${m.genericRegions.length}, blackspots ${m.blackspots.length}, spawns ${m.spawnLocations.length})`,
		);
	}
	return parts.join(', ');
}

async function cmdExportGltf(args: CliArgs) {
	const [bundlePath, outPath] = args.positional;
	if (!bundlePath || !outPath) {
		throw new Error('Usage: export-gltf <bundle> <out.gltf|out.glb>');
	}
	const { buffer, bytes } = loadBundleBytes(bundlePath);
	const extracted = extractWorldLogicResources(buffer);
	if (Object.keys(extracted.payload).length === 0) {
		throw new Error(
			'Bundle has no worldlogic-compatible resources (StreetData, TrafficData, AISections, TriggerData).',
		);
	}

	const wantJson = outPath.toLowerCase().endsWith('.gltf');
	const out = wantJson
		? await exportWorldLogicToGltfJson(extracted.payload)
		: await exportWorldLogicToGltf(extracted.payload);

	fs.writeFileSync(outPath, out);
	console.log(`Bundle: ${path.resolve(bundlePath)} (${bytes.byteLength} B, sha1 ${sha1(bytes)})`);
	console.log(`Resources: ${summarizePayload(extracted.payload)}`);
	for (const [key, raw] of Object.entries(extracted.raws)) {
		if (raw) console.log(`  ${key} raw: ${raw.byteLength} B, sha1 ${sha1(raw)}`);
	}
	console.log(`Wrote ${outPath} (${out.byteLength} B, sha1 ${sha1(out)})`);
}

async function cmdImportGltf(args: CliArgs) {
	const [origBundlePath, gltfPath, outPath] = args.positional;
	if (!origBundlePath || !gltfPath || !outPath) {
		throw new Error('Usage: import-gltf <orig-bundle> <edited.gltf> <out-bundle>');
	}
	const { buffer } = loadBundleBytes(origBundlePath);
	const bundle = parseBundle(buffer);

	const gltfFile = fs.readFileSync(gltfPath);
	const gltfBytes = new Uint8Array(gltfFile.byteLength);
	gltfBytes.set(gltfFile);
	const payload = await importWorldLogicFromGltf(gltfBytes);

	const overrides: Record<number, Uint8Array> = {};
	if (payload.streetData) {
		const rewritten = writeStreetDataData(payload.streetData);
		overrides[RESOURCE_TYPE_IDS.STREET_DATA] = rewritten;
		console.log(
			`  reconstructed StreetData: ${rewritten.byteLength} B, sha1 ${sha1(rewritten)}`,
		);
	}
	if (payload.trafficData) {
		const rewritten = writeTrafficDataData(payload.trafficData, true);
		overrides[RESOURCE_TYPE_IDS.TRAFFIC_DATA] = rewritten;
		console.log(
			`  reconstructed TrafficData: ${rewritten.byteLength} B, sha1 ${sha1(rewritten)}`,
		);
	}
	if (payload.aiSections) {
		const rewritten = writeAISectionsData(payload.aiSections, true);
		overrides[RESOURCE_TYPE_IDS.AI_SECTIONS] = rewritten;
		console.log(
			`  reconstructed AISections: ${rewritten.byteLength} B, sha1 ${sha1(rewritten)}`,
		);
	}
	if (payload.triggerData) {
		const rewritten = writeTriggerDataData(payload.triggerData, true);
		overrides[RESOURCE_TYPE_IDS.TRIGGER_DATA] = rewritten;
		console.log(
			`  reconstructed TriggerData: ${rewritten.byteLength} B, sha1 ${sha1(rewritten)}`,
		);
	}
	if (Object.keys(overrides).length === 0) {
		throw new Error('glTF contained no worldlogic resources to import.');
	}

	const outBuffer = writeBundleFresh(bundle, buffer, {
		overrides: { resources: overrides },
	});
	fs.writeFileSync(outPath, new Uint8Array(outBuffer));
	console.log(`Imported glTF: ${gltfPath} (${gltfFile.byteLength} B)`);
	console.log(`Wrote ${outPath} (${outBuffer.byteLength} B)`);
}

async function cmdRoundtripGltf(args: CliArgs) {
	const [bundlePath] = args.positional;
	if (!bundlePath) throw new Error('Usage: roundtrip-gltf <bundle>');
	const { buffer } = loadBundleBytes(bundlePath);
	const extracted = extractWorldLogicResources(buffer);
	if (Object.keys(extracted.payload).length === 0) {
		throw new Error(
			'Bundle has no worldlogic-compatible resources (StreetData, TrafficData, AISections, TriggerData).',
		);
	}

	console.log(`Bundle: ${path.resolve(bundlePath)}`);
	console.log(`Resources: ${summarizePayload(extracted.payload)}`);

	// Direct-write baselines per resource (the writer-idempotent contract for
	// StreetData, byte-exact for TrafficData). These become the yardsticks the
	// glTF round-trip must match.
	const baselines: Record<string, Uint8Array> = {};
	if (extracted.payload.streetData) {
		baselines.streetData = writeStreetDataData(extracted.payload.streetData);
	}
	if (extracted.payload.trafficData) {
		baselines.trafficData = writeTrafficDataData(extracted.payload.trafficData, true);
	}
	if (extracted.payload.aiSections) {
		baselines.aiSections = writeAISectionsData(extracted.payload.aiSections, true);
	}
	if (extracted.payload.triggerData) {
		baselines.triggerData = writeTriggerDataData(extracted.payload.triggerData, true);
	}
	for (const [key, b] of Object.entries(baselines)) {
		console.log(`  ${key} baseline: ${b.byteLength} B, sha1 ${sha1(b)}`);
	}

	// Round-trip via glTF.
	const gltfBytes = await exportWorldLogicToGltf(extracted.payload);
	console.log(`  glTF intermediate: ${gltfBytes.byteLength} B, sha1 ${sha1(gltfBytes)}`);

	const payloadAfter = await importWorldLogicFromGltf(gltfBytes);

	const posts: Record<string, Uint8Array> = {};
	if (payloadAfter.streetData) {
		posts.streetData = writeStreetDataData(payloadAfter.streetData);
	}
	if (payloadAfter.trafficData) {
		posts.trafficData = writeTrafficDataData(payloadAfter.trafficData, true);
	}
	if (payloadAfter.aiSections) {
		posts.aiSections = writeAISectionsData(payloadAfter.aiSections, true);
	}
	if (payloadAfter.triggerData) {
		posts.triggerData = writeTriggerDataData(payloadAfter.triggerData, true);
	}
	for (const [key, p] of Object.entries(posts)) {
		console.log(`  ${key} post-gltf: ${p.byteLength} B, sha1 ${sha1(p)}`);
	}

	// Compare per-resource.
	let anyFailed = false;
	for (const key of Object.keys(baselines)) {
		const b = baselines[key];
		const p = posts[key];
		if (!p) {
			console.log(`ROUNDTRIP-GLTF FAILED — resource ${key} not reconstructed from glTF`);
			anyFailed = true;
			continue;
		}
		if (!bytesEqual(b, p)) {
			console.log(
				`ROUNDTRIP-GLTF FAILED — ${key} differs: baseline sha1 ${sha1(b)}, post sha1 ${sha1(p)}`,
			);
			anyFailed = true;
		}
	}
	if (anyFailed) {
		process.exitCode = 1;
		return;
	}

	// Determinism check: a second glTF export of the same payload must match.
	const gltfBytes2 = await exportWorldLogicToGltf(extracted.payload);
	if (!bytesEqual(gltfBytes, gltfBytes2)) {
		console.log(
			`ROUNDTRIP-GLTF WARNING — glTF export not deterministic across passes ` +
				`(${gltfBytes.byteLength} B vs ${gltfBytes2.byteLength} B).`,
		);
		process.exitCode = 1;
		return;
	}

	console.log(
		`ROUNDTRIP-GLTF OK — every resource writer-idempotent after glTF round-trip, export deterministic.`,
	);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
	const [cmd, ...rest] = process.argv.slice(2);
	const args = parseArgs(rest);
	try {
		switch (cmd) {
			case 'list':           return cmdList(args);
			case 'parse':          return cmdParse(args);
			case 'dump':           return cmdDump(args);
			case 'pack':           return cmdPack(args);
			case 'roundtrip':      return cmdRoundtrip(args);
			case 'convert':        return cmdConvert(args);
			case 'stress':         return cmdStress(args);
			case 'fuzz':           return cmdFuzz(args);
			case 'export-gltf':    return await cmdExportGltf(args);
			case 'import-gltf':    return await cmdImportGltf(args);
			case 'roundtrip-gltf': return await cmdRoundtripGltf(args);
			default:
				console.error(
					'Commands: list | parse | dump | pack | roundtrip | convert | stress | fuzz | ' +
						'export-gltf | import-gltf | roundtrip-gltf',
				);
				console.error('Registered handlers: ' + registry.map((h) => h.key).join(', '));
				process.exit(1);
		}
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}

main();

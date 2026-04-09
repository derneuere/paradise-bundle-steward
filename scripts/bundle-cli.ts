// Unified bundle CLI — dispatcher over the handler registry in
// src/lib/core/registry. Every registered resource type is usable through
// the same set of subcommands with no per-type code in this file.
//
// Usage (from the steward repo root):
//   npm run bundle -- list      <bundle>
//   npm run bundle -- parse     <bundle> [--type <key>]
//   npm run bundle -- dump      <bundle> <out.json> [--type <key>]
//   npm run bundle -- pack      <in.json> <out-bundle> [--type <key>]
//   npm run bundle -- roundtrip <bundle> [--type <key>]

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle, writeBundleFresh } from '../src/lib/core/bundle';
import { extractResourceSize } from '../src/lib/core/resourceManager';
import {
	registry,
	getHandlerByKey,
	getHandlerByTypeId,
	extractResourceRaw,
	resourceCtxFromBundle,
	type ResourceHandler,
} from '../src/lib/core/registry';

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
	if (!bundlePath) throw new Error('Usage: parse <bundle> [--type <key>]');
	const { buffer } = loadBundleBytes(bundlePath);
	const bundle = parseBundle(buffer);
	const handler = pickHandler(bundle, args);
	const resource = bundle.resources.find((r) => r.resourceTypeId === handler.typeId)!;
	const ctx = resourceCtxFromBundle(bundle);
	const raw = extractResourceRaw(buffer, bundle, resource);
	const model = handler.parseRaw(raw, ctx);

	console.log(`${handler.name} [${handler.key}]: ${handler.describe(model)}`);
	console.log(`  raw: ${raw.byteLength} bytes, sha1 ${sha1(raw)}`);
}

function cmdDump(args: CliArgs) {
	const [bundlePath, outPath] = args.positional;
	if (!bundlePath || !outPath) throw new Error('Usage: dump <bundle> <out.json> [--type <key>]');
	const { buffer, bytes } = loadBundleBytes(bundlePath);
	const bundle = parseBundle(buffer);
	const handler = pickHandler(bundle, args);
	const resource = bundle.resources.find((r) => r.resourceTypeId === handler.typeId)!;
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

function cmdRoundtrip(args: CliArgs) {
	const [bundlePath] = args.positional;
	if (!bundlePath) throw new Error('Usage: roundtrip <bundle> [--type <key>]');
	const { buffer, bytes } = loadBundleBytes(bundlePath);
	const bundle = parseBundle(buffer);
	const handler = pickHandler(bundle, args);
	if (!handler.caps.write) {
		console.log(`${handler.name} is read-only (no writer registered). Parse-only check:`);
		const resource = bundle.resources.find((r) => r.resourceTypeId === handler.typeId)!;
		const ctx = resourceCtxFromBundle(bundle);
		const raw = extractResourceRaw(buffer, bundle, resource);
		const model = handler.parseRaw(raw, ctx);
		console.log(`  ${handler.describe(model)}`);
		return;
	}

	const resource = bundle.resources.find((r) => r.resourceTypeId === handler.typeId)!;
	const ctx = resourceCtxFromBundle(bundle);
	const raw = extractResourceRaw(buffer, bundle, resource);
	const model1 = handler.parseRaw(raw, ctx);
	console.log(`Parse (before): ${handler.describe(model1)}`);
	console.log(`  original raw: ${raw.byteLength} bytes, sha1 ${sha1(raw)}`);

	const write1 = handler.writeRaw!(model1, ctx);
	console.log(`  re-encoded raw: ${write1.byteLength} bytes, sha1 ${sha1(write1)}`);

	// Repack into a fresh bundle and re-parse to exercise the full pipeline.
	const outBuffer = writeBundleFresh(bundle, buffer, {
		overrides: { resources: { [handler.typeId]: write1 } },
	});
	console.log(`  repacked bundle: ${outBuffer.byteLength} bytes (was ${bytes.byteLength})`);

	const newBundle = parseBundle(outBuffer);
	const newResource = newBundle.resources.find((r) => r.resourceTypeId === handler.typeId)!;
	const rawAfter = extractResourceRaw(outBuffer, newBundle, newResource);
	const model2 = handler.parseRaw(rawAfter, ctx);
	console.log(`Parse (after):  ${handler.describe(model2)}`);
	console.log(`  parsed-back raw: ${rawAfter.byteLength} bytes, sha1 ${sha1(rawAfter)}`);

	// Idempotence check: writing the re-parsed model should yield the same
	// bytes we just re-parsed from. A drift here is a writer bug.
	const write2 = handler.writeRaw!(model2, ctx);
	if (sha1(write2) !== sha1(write1)) {
		console.log(`ROUNDTRIP FAILED — writer not idempotent (write2 sha1 ${sha1(write2)})`);
		process.exitCode = 1;
		return;
	}
	console.log('ROUNDTRIP OK — writer is idempotent, re-parse succeeded');
}

function cmdStress(args: CliArgs) {
	const [bundlePath] = args.positional;
	if (!bundlePath) throw new Error('Usage: stress <bundle> [--type <key>] [--scenario <name>]');
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
	const resource = bundle.resources.find((r) => r.resourceTypeId === handler.typeId)!;
	const raw = extractResourceRaw(buffer, bundle, resource);
	const baseline = handler.parseRaw(raw, ctx);
	console.log(`${handler.name} [${handler.key}]: ${handler.describe(baseline)}`);
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
// Entry point
// ---------------------------------------------------------------------------

function main() {
	const [cmd, ...rest] = process.argv.slice(2);
	const args = parseArgs(rest);
	try {
		switch (cmd) {
			case 'list':      return cmdList(args);
			case 'parse':     return cmdParse(args);
			case 'dump':      return cmdDump(args);
			case 'pack':      return cmdPack(args);
			case 'roundtrip': return cmdRoundtrip(args);
			case 'stress':    return cmdStress(args);
			default:
				console.error('Commands: list | parse | dump | pack | roundtrip | stress');
				console.error('Registered handlers: ' + registry.map((h) => h.key).join(', '));
				process.exit(1);
		}
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}

main();

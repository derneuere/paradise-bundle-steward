// Schema coverage tests for registryResourceSchema.
//
// Coverage fixtures: BOTH retail registries, because they exercise disjoint
// payload shapes — PLAYBACKREGISTRY carries five entity kinds (ContentClass /
// ContentType / SlotSchema / ParameterSchema / FeatureSchema), while
// RWACFEATUREREGISTRY is all GenericRwacFeatureImplementation. Entities are
// heterogeneous: payload record fields are null on the kinds that don't use
// them, which the walker must tolerate.
//
// Mirrors staticSoundMap.test.ts: parse each model and walk it against the
// schema asserting record references resolve, walkResource visits cleanly,
// no parser/schema field drift in either direction, and representative deep
// paths resolve with the expected field kinds.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseRegistry, soundHash, type ParsedRegistry } from '../../core/soundRegistry';

import { registryResourceSchema, resolveHash } from './registry';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const REGISTRY_TYPE_ID = 0xa000;

function loadModel(bundleFile: string): ParsedRegistry {
	const fileBytes = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === REGISTRY_TYPE_ID)!;
	return parseRegistry(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

for (const [label, bundleFile] of [
	['playback registry (five entity kinds)', 'example/PLAYBACKREGISTRY.BUNDLE'],
	['rwac feature registry (one entity kind)', 'example/RWACFEATUREREGISTRY.BUNDLE'],
] as const) {
	const model = loadModel(bundleFile);

	describe(`registryResourceSchema coverage — ${label}`, () => {
		it('fixture parses with non-trivial content', () => {
			expect(model.entities.length).toBeGreaterThan(0);
			expect(model.strings.length).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(registryResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!registryResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(registryResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(registryResourceSchema, model, (p, value, _field, rec) => {
				if (!rec) return;
				if (value == null || typeof value !== 'object') return;
				const declared = new Set(Object.keys(rec.fields));
				for (const key of Object.keys(value as Record<string, unknown>)) {
					if (!declared.has(key)) {
						missing.push(`${formatPath(p)}.${key}  (record "${rec.name}")`);
					}
				}
			});
			if (missing.length > 0) {
				throw new Error(`Schema is missing fields present in parsed data:\n  ${missing.join('\n  ')}`);
			}
		});

		it('every schema field is represented in the parsed data', () => {
			const missing: string[] = [];
			walkResource(registryResourceSchema, model, (p, value, _field, rec) => {
				if (!rec) return;
				if (value == null || typeof value !== 'object') return;
				const obj = value as Record<string, unknown>;
				for (const fieldName of Object.keys(rec.fields)) {
					if (!(fieldName in obj)) {
						missing.push(`${formatPath(p)}.${fieldName}  (record "${rec.name}")`);
					}
				}
			});
			if (missing.length > 0) {
				throw new Error(`Schema declares fields missing from parsed data:\n  ${missing.join('\n  ')}`);
			}
		});
	});
}

describe('registry path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(registryResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedRegistry');
	});

	it('resolves entities[0] as a RegistryEntity', () => {
		const loc = resolveSchemaAtPath(registryResourceSchema, ['entities', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('RegistryEntity');
	});

	it('resolves entities[0].parameterSchema.mu32Direction as an enum', () => {
		const loc = resolveSchemaAtPath(registryResourceSchema, ['entities', 0, 'parameterSchema', 'mu32Direction']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
	});

	it('resolves entities[0].rwacFeature.blocks[0].code as a string', () => {
		const loc = resolveSchemaAtPath(registryResourceSchema, ['entities', 0, 'rwacFeature', 'blocks', 0, 'code']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
	});

	it('resolves entities[0].featureSchema.parameterHashes[0] as u32', () => {
		const loc = resolveSchemaAtPath(registryResourceSchema, ['entities', 0, 'featureSchema', 'parameterHashes', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});

	it('resolves strings[0] as a string', () => {
		const loc = resolveSchemaAtPath(registryResourceSchema, ['strings', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
	});
});

describe('resolveHash (label hash → string pool lookup)', () => {
	const model = loadModel('example/PLAYBACKREGISTRY.BUNDLE');

	it('resolves a pooled hash to its plain-text name', () => {
		expect(resolveHash(model, soundHash('GinsuPlayer'))).toBe('GinsuPlayer');
		expect(resolveHash(model, soundHash('~ParameterSchema~'))).toBe('~ParameterSchema~');
	});

	it('falls back to hex when the pool has no match', () => {
		expect(resolveHash(model, 0xdeadbeef)).toBe('0xDEADBEEF');
		expect(resolveHash(undefined, 0x12)).toBe('0x00000012');
	});
});

// Schema coverage + round-trip tests for aiSectionsResourceSchema.
//
// Loads example/AI.DAT, extracts the AISections resource, parses it, walks
// it against the schema, and asserts:
//   1. Every field in the parsed model is described by the schema, and
//      every schema field exists on the parsed data (no drift).
//   2. resolveSchemaAtPath walks into a representative deep path
//      (sections[N].portals[P].boundaryLines[L].verts).
//   3. getAtPath / updateAtPath produce new references immutably while
//      preserving untouched siblings (structural sharing).
//   4. parse → write is byte-identical to the fixture, and walking the
//      tree read-only before writing is still byte-identical.
//   5. Tree-label callbacks render sensible strings on real fixture data.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import {
	parseAISectionsData,
	writeAISectionsData,
	SectionSpeed,
	EResetSpeedType,
	AISectionFlag,
	type ParsedAISectionsV12,
} from '../../core/aiSections';

import { aiSectionsResourceSchema } from './aiSections';
import {
	getAtPath,
	insertListItem,
	removeListItem,
	resolveSchemaAtPath,
	setAtPath,
	updateAtPath,
	walkResource,
	formatPath,
	type NodePath,
} from '../walk';
import type { FieldSchema, RecordSchema } from '../types';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const FIXTURE = path.resolve(__dirname, '../../../../example/AI.DAT');
const AI_SECTIONS_TYPE_ID = 0x10001;

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadAISectionsRaw(): { raw: Uint8Array; parsed: ParsedAISectionsV12 } {
	const fileBytes = fs.readFileSync(FIXTURE);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer);
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === AI_SECTIONS_TYPE_ID);
	if (!resource) throw new Error('example/AI.DAT missing AISections resource');
	const raw = extractResourceRaw(buffer.buffer, bundle, resource);
	const parsed = parseAISectionsData(raw, ctx.littleEndian);
	if (parsed.kind !== 'v12') throw new Error(`Expected v12 fixture, got ${parsed.kind}`);
	return { raw, parsed };
}

const { raw: rawAI, parsed: parsedAI } = loadAISectionsRaw();

// ---------------------------------------------------------------------------
// 1. Schema coverage
// ---------------------------------------------------------------------------

describe('aiSectionsResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(parsedAI.sections.length).toBeGreaterThan(0);
		expect(parsedAI.sectionMinSpeeds.length).toBe(5);
		expect(parsedAI.sectionMaxSpeeds.length).toBe(5);
	});

	it('root type exists in registry', () => {
		expect(aiSectionsResourceSchema.registry.ParsedAISections).toBeDefined();
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, record] of Object.entries(aiSectionsResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(record.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}

		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!aiSectionsResourceSchema.registry[f.type]) {
					out.push(`${where} -> "${f.type}"`);
				}
				return;
			}
			if (f.kind === 'list') {
				checkField(f.item, `${where}[]`, out);
			}
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(aiSectionsResourceSchema, parsedAI, (_path, _value, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(aiSectionsResourceSchema, parsedAI, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			const declared = new Set(Object.keys(record.fields));
			for (const key of Object.keys(value as Record<string, unknown>)) {
				if (!declared.has(key)) {
					missing.push(`${formatPath(p)}.${key}  (record "${record.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(
				`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${
					missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''
				}`,
			);
		}
	});

	it('every schema field is represented in the parsed data', () => {
		const missing: string[] = [];
		walkResource(aiSectionsResourceSchema, parsedAI, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			const obj = value as Record<string, unknown>;
			for (const fieldName of Object.keys(record.fields)) {
				if (!(fieldName in obj)) {
					missing.push(`${formatPath(p)}.${fieldName}  (record "${record.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(
				`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${
					missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''
				}`,
			);
		}
	});
});

// ---------------------------------------------------------------------------
// 2. Path resolution
// ---------------------------------------------------------------------------

describe('aiSections path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(aiSectionsResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedAISections');
	});

	it('resolves a top-level primitive field', () => {
		const loc = resolveSchemaAtPath(aiSectionsResourceSchema, ['version']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
		expect(loc!.parentRecord?.name).toBe('ParsedAISections');
	});

	it('resolves a fixed-list primitive (sectionMinSpeeds)', () => {
		const loc = resolveSchemaAtPath(aiSectionsResourceSchema, ['sectionMinSpeeds']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('list');
	});

	it('resolves sections[0]', () => {
		if (parsedAI.sections.length === 0) return;
		const loc = resolveSchemaAtPath(aiSectionsResourceSchema, ['sections', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('AISection');
	});

	it('resolves sections[0].flags as a flags field', () => {
		if (parsedAI.sections.length === 0) return;
		const loc = resolveSchemaAtPath(aiSectionsResourceSchema, ['sections', 0, 'flags']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('flags');
	});

	it('resolves sections[0].speed as an enum field', () => {
		if (parsedAI.sections.length === 0) return;
		const loc = resolveSchemaAtPath(aiSectionsResourceSchema, ['sections', 0, 'speed']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
	});

	it('resolves a deep list-inside-list path (portal boundary line verts)', () => {
		const secIdx = parsedAI.sections.findIndex((s) => s.portals.some((p) => p.boundaryLines.length > 0));
		if (secIdx < 0) return;
		const portalIdx = parsedAI.sections[secIdx].portals.findIndex((p) => p.boundaryLines.length > 0);
		const loc = resolveSchemaAtPath(aiSectionsResourceSchema, [
			'sections',
			secIdx,
			'portals',
			portalIdx,
			'boundaryLines',
			0,
			'verts',
		]);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec4');
	});

	it('resolves sections[0].corners[2] as vec2', () => {
		if (parsedAI.sections.length === 0) return;
		const loc = resolveSchemaAtPath(aiSectionsResourceSchema, ['sections', 0, 'corners', 2]);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec2');
	});

	it('resolves a SectionResetPair item', () => {
		if (parsedAI.sectionResetPairs.length === 0) return;
		const loc = resolveSchemaAtPath(aiSectionsResourceSchema, ['sectionResetPairs', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('SectionResetPair');
	});

	it('returns null for an unknown field', () => {
		const loc = resolveSchemaAtPath(aiSectionsResourceSchema, ['nonexistent']);
		expect(loc).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 3. Data get / update round-trips
// ---------------------------------------------------------------------------

describe('aiSections getAtPath / updateAtPath', () => {
	it('getAtPath returns the root for an empty path', () => {
		expect(getAtPath(parsedAI, [])).toBe(parsedAI);
	});

	it('getAtPath returns a nested primitive', () => {
		expect(getAtPath(parsedAI, ['version'])).toBe(parsedAI.version);
	});

	it('getAtPath returns a nested list item', () => {
		if (parsedAI.sections.length === 0) return;
		const first = getAtPath(parsedAI, ['sections', 0]);
		expect(first).toBe(parsedAI.sections[0]);
	});

	it('setAtPath replaces a top-level primitive with structural sharing', () => {
		const before = parsedAI.version;
		const next = setAtPath(parsedAI, ['version'], 99);
		expect(next.version).toBe(99);
		expect(next.sections).toBe(parsedAI.sections);
		expect(next.sectionResetPairs).toBe(parsedAI.sectionResetPairs);
		expect(parsedAI.version).toBe(before);
	});

	it('updateAtPath deep-edits a list-of-list primitive', () => {
		if (parsedAI.sections.length < 2) return;
		const next = updateAtPath(parsedAI, ['sections', 1, 'id'], () => 0xDEADBEEF);
		expect(next.sections[1].id).toBe(0xDEADBEEF);
		// Un-edited siblings share references.
		expect(next.sections[0]).toBe(parsedAI.sections[0]);
		// Original untouched.
		expect(parsedAI.sections[1].id).not.toBe(0xDEADBEEF);
	});

	it('updateAtPath deep-edits a vec4 field on a boundary line', () => {
		const secIdx = parsedAI.sections.findIndex((s) =>
			s.portals.some((p) => p.boundaryLines.length > 0),
		);
		if (secIdx < 0) return;
		const portalIdx = parsedAI.sections[secIdx].portals.findIndex(
			(p) => p.boundaryLines.length > 0,
		);
		const next = updateAtPath(
			parsedAI,
			['sections', secIdx, 'portals', portalIdx, 'boundaryLines', 0, 'verts'],
			() => ({ x: 1, y: 2, z: 3, w: 4 }),
		);
		expect(next.sections[secIdx].portals[portalIdx].boundaryLines[0].verts).toEqual({
			x: 1, y: 2, z: 3, w: 4,
		});
		// Original untouched.
		expect(
			parsedAI.sections[secIdx].portals[portalIdx].boundaryLines[0].verts,
		).not.toEqual({ x: 1, y: 2, z: 3, w: 4 });
	});

	it('insertListItem appends and removeListItem removes from sectionResetPairs', () => {
		const withExtra = insertListItem(parsedAI, ['sectionResetPairs'], {
			resetSpeed: EResetSpeedType.E_RESET_SPEED_TYPE_NONE,
			startSectionIndex: 0,
			resetSectionIndex: 0,
		});
		expect(withExtra.sectionResetPairs.length).toBe(parsedAI.sectionResetPairs.length + 1);
		const backOut = removeListItem(
			withExtra,
			['sectionResetPairs'],
			withExtra.sectionResetPairs.length - 1,
		);
		expect(backOut.sectionResetPairs.length).toBe(parsedAI.sectionResetPairs.length);
	});
});

// ---------------------------------------------------------------------------
// 4. Byte-exact round-trip
// ---------------------------------------------------------------------------

describe('aiSections byte round-trip', () => {
	it('parse → write reproduces the original bytes', () => {
		const written = writeAISectionsData(parsedAI, true);
		expect(written.length).toBe(rawAI.length);
		expect(sha1(written)).toBe(sha1(rawAI));
	});

	it('parse → walk → write is byte-identical (walker must not mutate)', () => {
		let visitCount = 0;
		walkResource(aiSectionsResourceSchema, parsedAI, () => {
			visitCount++;
		});
		expect(visitCount).toBeGreaterThan(100);
		const written = writeAISectionsData(parsedAI, true);
		expect(sha1(written)).toBe(sha1(rawAI));
	});

	it('setAtPath on a primitive produces a writable model', () => {
		if (parsedAI.sections.length === 0) return;
		const next = updateAtPath(
			parsedAI,
			['sections', 0, 'speed'],
			() => SectionSpeed.E_SECTION_SPEED_VERY_FAST,
		);
		expect(() => writeAISectionsData(next, true)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// 5. Tree label callbacks
// ---------------------------------------------------------------------------

describe('aiSections schema labels', () => {
	const ctx = {
		root: parsedAI,
		resource: aiSectionsResourceSchema,
	};

	it('section label combines id and speed', () => {
		if (parsedAI.sections.length === 0) return;
		const schema = aiSectionsResourceSchema.registry.AISection;
		const label = schema.label?.(
			parsedAI.sections[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(label).toMatch(/^#0 · 0x[0-9A-F]+ · /);
	});

	it('reset pair label names start and reset sections', () => {
		if (parsedAI.sectionResetPairs.length === 0) return;
		const schema = aiSectionsResourceSchema.registry.SectionResetPair;
		const label = schema.label?.(
			parsedAI.sectionResetPairs[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(label).toMatch(/^#0 · .+ · \d+→\d+$/);
	});

	it('portal label describes link section', () => {
		const sec = parsedAI.sections.find((s) => s.portals.length > 0);
		if (!sec) return;
		const schema = aiSectionsResourceSchema.registry.Portal;
		const label = schema.label?.(sec.portals[0] as unknown as Record<string, unknown>, 0, ctx);
		expect(label).toMatch(/^Portal 0 · →#/);
	});

	it('boundary line label shows start→end coords', () => {
		const sec = parsedAI.sections.find((s) =>
			s.portals.some((p) => p.boundaryLines.length > 0),
		);
		if (!sec) return;
		const portal = sec.portals.find((p) => p.boundaryLines.length > 0)!;
		const schema = aiSectionsResourceSchema.registry.BoundaryLine;
		const label = schema.label?.(
			portal.boundaryLines[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(label).toMatch(/^#0 · \(.+\) → \(.+\)$/);
	});
});

// ---------------------------------------------------------------------------
// 6. Section flags round-trip through a flags-field edit
// ---------------------------------------------------------------------------

describe('aiSections flag-field edits', () => {
	it('toggling a flag bit via updateAtPath survives parse → write → parse', () => {
		if (parsedAI.sections.length === 0) return;
		const before = parsedAI.sections[0].flags;
		const toggled = (before ^ AISectionFlag.SHORTCUT) & 0xff;
		const modified = updateAtPath(parsedAI, ['sections', 0, 'flags'], () => toggled);
		const bytes = writeAISectionsData(modified, true);
		const reparsed = parseAISectionsData(bytes, true);
		if (reparsed.kind !== 'v12') throw new Error(`Expected v12 round-trip, got ${reparsed.kind}`);
		expect(reparsed.sections[0].flags).toBe(toggled);
	});
});

// Silence unused-import warnings for types used only indirectly.
void (null as unknown as NodePath);
void (null as unknown as RecordSchema);

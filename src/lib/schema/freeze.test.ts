// Tests for freezeSchema — the read-only-schema helper backing read-only
// EditorProfiles. Every field must come back with readOnly:true; every
// list with addable:false / removable:false; the source schema must be
// untouched.

import { describe, it, expect } from 'vitest';
import { freezeSchema } from './freeze';
import type { ResourceSchema } from './types';

const makeSchema = (): ResourceSchema => ({
	key: 'sample',
	name: 'Sample',
	rootType: 'Root',
	registry: {
		Root: {
			name: 'Root',
			fields: {
				count: { kind: 'u32' },
				items: {
					kind: 'list',
					item: { kind: 'record', type: 'Item' },
					addable: true,
					removable: true,
				},
				flags: {
					kind: 'flags',
					storage: 'u8',
					bits: [{ mask: 0x01, label: 'A' }],
				},
			},
			fieldMetadata: {
				count: { description: 'item count', readOnly: false },
			},
		},
		Item: {
			name: 'Item',
			fields: {
				value: { kind: 'f32' },
				children: {
					kind: 'list',
					item: { kind: 'string' },
					addable: true,
					removable: true,
					maxLength: 8,
				},
			},
		},
	},
});

describe('freezeSchema', () => {
	it('marks every field readOnly:true', () => {
		const frozen = freezeSchema(makeSchema());
		const root = frozen.registry.Root;
		const item = frozen.registry.Item;
		expect(root.fieldMetadata?.count?.readOnly).toBe(true);
		expect(root.fieldMetadata?.items?.readOnly).toBe(true);
		expect(root.fieldMetadata?.flags?.readOnly).toBe(true);
		expect(item.fieldMetadata?.value?.readOnly).toBe(true);
		expect(item.fieldMetadata?.children?.readOnly).toBe(true);
	});

	it('preserves other field metadata when flipping readOnly', () => {
		const frozen = freezeSchema(makeSchema());
		expect(frozen.registry.Root.fieldMetadata?.count?.description).toBe('item count');
	});

	it('flips list addable/removable to false even when source had them true', () => {
		const frozen = freezeSchema(makeSchema());
		const itemsField = frozen.registry.Root.fields.items;
		expect(itemsField.kind).toBe('list');
		if (itemsField.kind !== 'list') return;
		expect(itemsField.addable).toBe(false);
		expect(itemsField.removable).toBe(false);

		const childrenField = frozen.registry.Item.fields.children;
		expect(childrenField.kind).toBe('list');
		if (childrenField.kind !== 'list') return;
		expect(childrenField.addable).toBe(false);
		expect(childrenField.removable).toBe(false);
		// Other list fields (e.g., maxLength) survive.
		expect(childrenField.maxLength).toBe(8);
	});

	it('does not mutate the source schema', () => {
		const source = makeSchema();
		const sourceCopy = JSON.parse(JSON.stringify(source));
		freezeSchema(source);
		expect(JSON.parse(JSON.stringify(source))).toEqual(sourceCopy);
	});

	it('returns an independent registry (mutating frozen does not affect source)', () => {
		const source = makeSchema();
		const frozen = freezeSchema(source);
		// Mutate frozen in place — source should be unaffected.
		(frozen.registry.Root.fieldMetadata!.count as { readOnly: boolean }).readOnly = false;
		expect(source.registry.Root.fieldMetadata?.count?.readOnly).toBe(false);
		// (The source had `readOnly: false` to begin with, but the point is the
		// mutation only affected its own object — independent identity.)
		expect(frozen.registry.Root.fieldMetadata).not.toBe(source.registry.Root.fieldMetadata);
	});

	it('handles records that have no fieldMetadata at all', () => {
		const frozen = freezeSchema(makeSchema());
		// `Item` had no fieldMetadata in the source — every field still gets one.
		expect(frozen.registry.Item.fieldMetadata?.value?.readOnly).toBe(true);
		expect(frozen.registry.Item.fieldMetadata?.children?.readOnly).toBe(true);
	});
});

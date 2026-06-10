// Hand-written schema for ParsedTextureNameMap (resource type 0x1000B).
//
// Mirrors the types in `src/lib/core/textureNameMap.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: the particles bundle's texture string table. Particle materials
// (cParticleMaterial inside ParticleDescription resources) reference textures
// only by the FNV-1a hash of the bare texture name; this map resolves that
// hash to the full gamedb TextureConfig2d URI at runtime. The hash is fully
// derived from the URI (lowercased FNV-1a of the basename without extension
// or ?ID= query), so editing the URI re-derives the hash via the record's
// derive hook and the hash field stays read-only.

import type { FieldSchema, RecordSchema, ResourceSchema, SchemaRegistry } from '../types';
import { hashLionTextureName, lionTextureName } from '@/lib/core/textureNameMap';

const u32 = (): FieldSchema => ({ kind: 'u32' });
const str = (): FieldSchema => ({ kind: 'string' });

function entryLabel(item: unknown, index: number): string {
	try {
		if (!item || typeof item !== 'object') return `#${index}`;
		const e = item as { mGDBTextureName?: string };
		if (!e.mGDBTextureName) return `#${index} · (unnamed)`;
		return `#${index} · ${lionTextureName(e.mGDBTextureName)}`;
	} catch {
		return `#${index}`;
	}
}

const TextureNameMapEntry: RecordSchema = {
	name: 'TextureNameMapEntry',
	description: 'One texture mapping: the FNV-1a hash particle materials look up, paired with the gamedb TextureConfig2d URI it resolves to. The hash is derived from the URI\'s bare basename — edit the URI and it re-derives.',
	fields: {
		muHashedLionTextureName: u32(),
		mGDBTextureName: str(),
	},
	fieldMetadata: {
		muHashedLionTextureName: {
			label: 'Lion name hash',
			description: 'FNV-1a (lowercased) of the bare texture name — "SparkBlast.TextureConfig2d?ID=245985" hashes as "sparkblast". Must match what cParticleMaterial::mpTextureName references, so it is re-derived from the URI rather than edited directly.',
			readOnly: true,
			derivedFrom: 'mGDBTextureName',
		},
		mGDBTextureName: {
			label: 'GDB texture name',
			description: 'Full gamedb URI of the TextureConfig2d asset, e.g. gamedb://burnout5/Burnout/Effects/Textures/SparkBlast.TextureConfig2d?ID=245985.',
		},
	},
	label: (value, index) => entryLabel(value, index ?? 0),
	derive: (prev, next) => {
		if (prev.mGDBTextureName === next.mGDBTextureName) return {};
		return { muHashedLionTextureName: hashLionTextureName(String(next.mGDBTextureName ?? '')) };
	},
};

const ParsedTextureNameMap: RecordSchema = {
	name: 'ParsedTextureNameMap',
	description: 'Root record for the Texture Name Map resource (0x1000B): the hash → gamedb-URI table for every texture the particles bundle\'s effects can reference. One map per particles bundle.',
	fields: {
		entries: {
			kind: 'list',
			item: { kind: 'record', type: 'TextureNameMapEntry' },
			addable: true,
			removable: true,
			makeEmpty: () => ({ muHashedLionTextureName: hashLionTextureName(''), mGDBTextureName: '' }),
			itemLabel: (item, index) => entryLabel(item, index),
		},
	},
	fieldMetadata: {
		entries: {
			label: 'Texture names',
			description: 'Lookups are by hash, so order is cosmetic — but every hash must stay unique (50 unique entries in retail).',
		},
	},
	propertyGroups: [{ title: 'Textures', properties: ['entries'] }],
};

const registry: SchemaRegistry = {
	ParsedTextureNameMap,
	TextureNameMapEntry,
};

export const textureNameMapResourceSchema: ResourceSchema = {
	key: 'textureNameMap',
	name: 'Texture Name Map',
	rootType: 'ParsedTextureNameMap',
	registry,
};

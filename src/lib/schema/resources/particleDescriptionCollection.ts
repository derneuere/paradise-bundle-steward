// Hand-written schema for ParsedParticleDescriptionCollection (0x10008).
//
// Mirrors the types in `src/lib/core/particleDescriptionCollection.ts`. Keep
// these in lockstep with the parser/writer — any field added to the parser
// needs a matching entry here, or the schema walker reports it as drift.
//
// Domain: the particles bundle's master list. Each entry is a BND2 import of
// a ParticleDescription (0x1001D) in the same bundle; at load the import
// table patches a pointer into the matching slot, and the Lion particle
// system spawns effects by indexing this table. Entry ids are FNV-1a hashes
// (lowercased) of the description's full gamedb URI — this is the one type
// family whose resource ids are FNV-1a rather than crc32. Add/remove resizes
// the resource's inline import table; the bundle envelope's import metadata
// follows it on export via the handler's importTable() hook.

import type { FieldSchema, RecordSchema, ResourceSchema, SchemaRegistry } from '../types';

const resourceId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

function descriptionLabel(item: unknown, index: number): string {
	try {
		if (!item || typeof item !== 'object') return `#${index}`;
		const e = item as { mDescriptionId?: bigint };
		const id = e.mDescriptionId != null ? `0x${e.mDescriptionId.toString(16).toUpperCase()}` : '?';
		return `#${index} · ${id}`;
	} catch {
		return `#${index}`;
	}
}

const ParticleDescriptionRef: RecordSchema = {
	name: 'ParticleDescriptionRef',
	description: 'One slot of the collection — a reference to a ParticleDescription (0x1001D) in the same bundle, resolved at load through the inline import table (the on-disk slot holds a placeholder ordinal until then).',
	fields: {
		mDescriptionId: resourceId(),
	},
	fieldMetadata: {
		mDescriptionId: {
			label: 'Description',
			description: 'Resource id of the ParticleDescription — the FNV-1a hash (lowercased) of its full gamedb URI, e.g. fnv1a("gamedb://burnout5/burnout/effects/prop_glass.lef.burnoutfxlioneffectfile?id=554576"). Must name a 0x1001D resource in the same bundle or the effect never resolves.',
		},
	},
	label: (value, index) => descriptionLabel(value, index ?? 0),
};

const ParsedParticleDescriptionCollection: RecordSchema = {
	name: 'ParsedParticleDescriptionCollection',
	description: 'Root record for the Particle Description Collection resource (0x10008): the master list of every particle effect the Lion system can spawn. One collection per particles bundle.',
	fields: {
		descriptions: {
			kind: 'list',
			item: { kind: 'record', type: 'ParticleDescriptionRef' },
			addable: true,
			removable: true,
			makeEmpty: () => ({ mDescriptionId: 0n }),
			itemLabel: (item, index) => descriptionLabel(item, index),
		},
		_padAfterTable: rawBytes(),
	},
	fieldMetadata: {
		descriptions: {
			label: 'Particle descriptions',
			description: 'Slot order is the authoring order the runtime indexes by — retail covers all 42 of the bundle\'s ParticleDescription resources exactly once. Reordering changes which effect each runtime index spawns.',
		},
		_padAfterTable: {
			label: 'Pad after table',
			description: 'Zero bytes between the slot table and the inline import table (16 in retail; purpose unknown). Preserved verbatim for byte-exact round-trip.',
			hidden: true,
		},
	},
	propertyGroups: [{ title: 'Descriptions', properties: ['descriptions'] }],
};

const registry: SchemaRegistry = {
	ParsedParticleDescriptionCollection,
	ParticleDescriptionRef,
};

export const particleDescriptionCollectionResourceSchema: ResourceSchema = {
	key: 'particleDescriptionCollection',
	name: 'Particle Description Collection',
	rootType: 'ParsedParticleDescriptionCollection',
	registry,
};

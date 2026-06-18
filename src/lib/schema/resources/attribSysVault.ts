// Schema for AttribSys Vault (resource type 0x1C) — the vehicle / camera /
// engine attribute database.
//
// The vault holds a list of attribute instances, each belonging to a class
// (physicsvehiclebaseattribs, physicsvehicleboostattribs, …). The per-class
// field set is defined in `vehicleAttribs.ts` and resolved at runtime by
// classHash, so the attribute's `fields` value can't be described as a static
// record — it's a `custom` field rendered by the `attribSysFields` extension,
// which looks up the right per-class schema and renders typed inputs.
//
// Round-trip bookkeeping the model carries (dependencies, pointer fixups, the
// raw StrE chunk, collections/exports tables) is intentionally not declared
// here: the schema editor preserves untouched fields by structural sharing, so
// omitting them keeps them byte-exact while hiding internals from the editor.

import type { RecordSchema, ResourceSchema, SchemaRegistry } from '../types';

// Class-name → human label for the attribute tree rows. Pure data; kept local
// so this schema stays free of any UI-layer import.
const CLASS_LABELS: Record<string, string> = {
	physicsvehiclebaseattribs: 'Base handling (mass, grip, brakes)',
	physicsvehicleboostattribs: 'Boost',
	physicsvehicleengineattribs: 'Engine (torque, RPM, gears)',
	physicsvehicledriftattribs: 'Drift',
	physicsvehiclesuspensionattribs: 'Suspension',
	physicsvehiclesteeringattribs: 'Steering',
	physicsvehiclecollisionattribs: 'Collision body box',
	physicsvehiclebodyrollattribs: 'Body roll',
	physicsvehiclehandling: 'Handling refs',
	camerabumperbehaviour: 'Bumper camera',
	cameraexternalbehaviour: 'External camera',
	burnoutcargraphicsasset: 'Car graphics asset',
	burnoutcarasset: 'Car asset',
};

const registry: SchemaRegistry = {
	AttribAttribute: {
		name: 'AttribAttribute',
		fields: {
			className: { kind: 'string' },
			classHash: { kind: 'bigint', hex: true },
			fields: { kind: 'custom', component: 'attribSysFields' },
		},
		fieldMetadata: {
			className: { readOnly: true },
			classHash: { readOnly: true, label: 'classHash' },
			fields: { label: 'Attributes' },
		},
		label: (v) => {
			const className = String((v as { className?: unknown }).className ?? '');
			return CLASS_LABELS[className] ?? className;
		},
	} satisfies RecordSchema,

	AttribSysVault: {
		name: 'AttribSysVault',
		fields: {
			versionHash: { kind: 'bigint', hex: true },
			strings: { kind: 'list', item: { kind: 'string' }, addable: false, removable: false },
			attributes: {
				kind: 'list',
				item: { kind: 'record', type: 'AttribAttribute' },
				addable: false,
				removable: false,
			},
		},
		fieldMetadata: {
			versionHash: { readOnly: true, label: 'versionHash' },
			// Parsed from the bin StrE chunk for display only — not editable.
			strings: { readOnly: true, description: 'String exports (display only).' },
		},
	} satisfies RecordSchema,
};

export const attribSysVaultResourceSchema: ResourceSchema = {
	key: 'attribSysVault',
	name: 'AttribSys Vault',
	rootType: 'AttribSysVault',
	registry,
};

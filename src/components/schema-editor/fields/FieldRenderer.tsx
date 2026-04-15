// Dispatches a field schema to the right renderer component.
//
// Centralized here so individual field renderers don't need to know about
// each other. The inspector and the PrimListField both use this as the
// entry point.

import { IntField } from './IntField';
import { FloatField } from './FloatField';
import { BigIntField } from './BigIntField';
import { BoolField } from './BoolField';
import { StringField } from './StringField';
import { EnumField } from './EnumField';
import { FlagsField } from './FlagsField';
import { Vec2Field, Vec3Field, Vec4Field } from './VectorField';
import { Matrix44Field } from './Matrix44Field';
import { RefField } from './RefField';
import { PrimListField } from './PrimListField';
import { ListNavField } from './ListNavField';
import { RecordInlineField } from './RecordInlineField';
import { CustomField } from './CustomField';
import type { FieldSchema, FieldMetadata } from '@/lib/schema/types';

type Props = {
	label: string;
	field: FieldSchema;
	value: unknown;
	onChange: (next: unknown) => void;
	meta?: FieldMetadata;
	/** Absolute path to this value, required for list nav + record inline. */
	path?: (string | number)[];
	/** Hide the label (used inside PrimListField rows). */
	hideLabel?: boolean;
};

export function FieldRenderer({ label, field, value, onChange, meta, path, hideLabel }: Props) {
	const shownLabel = hideLabel ? '' : label;

	switch (field.kind) {
		case 'u8': case 'u16': case 'u32':
		case 'i8': case 'i16': case 'i32':
			return <IntField label={shownLabel} value={value as number} onChange={onChange as (v: number) => void} meta={meta} kind={field.kind} />;
		case 'f32':
			return <FloatField label={shownLabel} value={value as number} onChange={onChange as (v: number) => void} meta={meta} />;
		case 'bigint':
			return <BigIntField label={shownLabel} value={value as bigint} onChange={onChange as (v: bigint) => void} meta={meta} hex={field.hex} />;
		case 'bool':
			return <BoolField label={shownLabel} value={value as boolean} onChange={onChange as (v: boolean) => void} meta={meta} />;
		case 'string':
			return <StringField label={shownLabel} value={value as string} onChange={onChange as (v: string) => void} meta={meta} />;
		case 'enum':
			return <EnumField label={shownLabel} value={value as number} onChange={onChange as (v: number) => void} meta={meta} schema={field} />;
		case 'flags':
			return <FlagsField label={shownLabel} value={value as number} onChange={onChange as (v: number) => void} meta={meta} schema={field} />;
		case 'vec2':
			return <Vec2Field label={shownLabel} value={value as { x: number; y: number }} onChange={onChange as (v: { x: number; y: number }) => void} meta={meta} />;
		case 'vec3':
			return <Vec3Field label={shownLabel} value={value as { x: number; y: number; z: number }} onChange={onChange as (v: { x: number; y: number; z: number }) => void} meta={meta} />;
		case 'vec4':
			return <Vec4Field label={shownLabel} value={value as { x: number; y: number; z: number; w: number }} onChange={onChange as (v: { x: number; y: number; z: number; w: number }) => void} meta={meta} />;
		case 'matrix44':
			return <Matrix44Field label={shownLabel} value={value as number[]} onChange={onChange as (v: number[]) => void} meta={meta} />;
		case 'ref':
			return <RefField label={shownLabel} value={value as number} onChange={onChange as (v: number) => void} meta={meta} schema={field} />;
		case 'list': {
			// When the list declares a customRenderer, prefer it over the
			// default ListNavField / PrimListField. The extension receives
			// the list value at `path` plus `setData` for whole-root edits.
			if (field.customRenderer) {
				if (!path) return <div className="text-xs text-destructive">customRenderer requires a path</div>;
				return (
					<CustomField
						label={shownLabel}
						value={value}
						onChange={onChange}
						meta={meta}
						schema={{ kind: 'custom', component: field.customRenderer }}
						path={path}
					/>
				);
			}
			// List of records → navigation summary. Primitive / structured
			// list → inline editable table.
			if (field.item.kind === 'record') {
				if (!path) return <div className="text-xs text-destructive">ListNavField requires a path</div>;
				return <ListNavField label={shownLabel} value={value as unknown[]} onChange={onChange as (v: unknown[]) => void} meta={meta} schema={field} path={path} />;
			}
			return <PrimListField label={shownLabel} value={value as unknown[]} onChange={onChange as (v: unknown[]) => void} meta={meta} schema={field} />;
		}
		case 'record':
			if (!path) return <div className="text-xs text-destructive">RecordInlineField requires a path</div>;
			return <RecordInlineField label={shownLabel} value={value as Record<string, unknown>} onChange={onChange as (v: Record<string, unknown>) => void} meta={meta} schema={field} path={path} />;
		case 'custom':
			if (!path) return <div className="text-xs text-destructive">CustomField requires a path</div>;
			return <CustomField label={shownLabel} value={value} onChange={onChange} meta={meta} schema={field} path={path} />;
	}
}

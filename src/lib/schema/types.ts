// Schema type system for binary-resource editors.
//
// A schema describes a parsed resource model as a tree of typed fields so a
// generic editor can render inputs, navigate sub-structures, and reconcile
// derived fields on write.
//
// The schema is hand-written per resource (one module in `./resources/`).
// Runtime type inference is not possible — TypeScript erases u8/u16/f32
// distinctions, and those matter for binary round-trip.
//
// Design notes:
// - A `RecordSchema` defines a named struct type and the fields it contains.
// - Top-level resources are themselves records. Nested structs are records
//   looked up by name via `SchemaRegistry`.
// - Primitive "structured" types (Vec4, Matrix44) are NOT records — they are
//   leaves with structured editors, because we never want users navigating
//   *into* a vector.
// - Paths into a resource are arrays of string / number segments, e.g.
//   `["hulls", 3, "sectionFlows", 7]`. These are stable only within a single
//   edit session — insertions shift trailing indexes.

// ---------------------------------------------------------------------------
// Ref targets
// ---------------------------------------------------------------------------

// A ref describes "this field is an index into another list". Used for
// FlowType references, section indexes, etc. Phase A only resolves refs
// inside the same resource; Phase D extends this to cross-resource.
export type RefTarget = {
	// Relative path from the *resource root* to the target list.
	// e.g. `["flowTypes"]` — select the top-level TrafficData.flowTypes list.
	// The ref value is then used as an index into that list.
	listPath: (string | number)[];

	// Name of the record type stored in the list. Used to compute ref labels.
	itemType: string;

	// For future cross-resource refs. Phase A: always omitted ("same resource").
	resourceKey?: string;

	// Optional name used in tree/inspector UI — "FlowType", "Section", etc.
	// Falls back to `itemType` when absent.
	displayName?: string;
};

// ---------------------------------------------------------------------------
// Field kinds
// ---------------------------------------------------------------------------

// Numeric primitives carry their storage size so renderers can clamp inputs
// and so the walker knows enough about the binary shape to power future
// validations (e.g., "value 65536 overflows u16").
export type IntKind =
	| 'u8' | 'u16' | 'u32'
	| 'i8' | 'i16' | 'i32';

export type PrimitiveFieldSchema =
	| { kind: IntKind; min?: number; max?: number }
	| { kind: 'f32'; min?: number; max?: number }
	| { kind: 'bigint'; bytes?: number; hex?: boolean } // u64 / CgsID
	| { kind: 'bool' }
	| { kind: 'string' };

// Structured primitives — leaves, not records.
export type StructuredPrimitiveSchema =
	| { kind: 'vec2' }
	| { kind: 'vec3' }
	| { kind: 'vec4' }
	| { kind: 'matrix44' }; // 16 × f32

// Enum & flags — both stored as ints.
export type EnumFieldSchema = {
	kind: 'enum';
	storage: IntKind;
	values: { value: number; label: string; description?: string }[];
};

export type FlagsFieldSchema = {
	kind: 'flags';
	storage: IntKind;
	bits: { mask: number; label: string; description?: string }[];
};

// Ref — single index into another list.
export type RefFieldSchema = {
	kind: 'ref';
	storage: IntKind;
	target: RefTarget;
	// Sentinel value that means "no ref". For u8 refs this is often 0xFF;
	// for u16 refs, 0xFFFF. Absent = no sentinel.
	nullValue?: number;
};

// Record — nested struct referenced by type name in the registry.
export type RecordFieldSchema = {
	kind: 'record';
	type: string; // key into SchemaRegistry
};

// List of items (homogeneous). `item` can be any field schema including a
// record or another list (for nested arrays, though we don't use that here).
export type ListFieldSchema = {
	kind: 'list';
	item: FieldSchema;
	// Editing affordances.
	addable?: boolean;   // default true
	removable?: boolean; // default true
	// Fixed-size arrays (e.g., `mauStateTimings: u16[16]`) set both to 16.
	minLength?: number;
	maxLength?: number;
	// Factory for a new empty item. Required when `addable` is true AND the
	// item type cannot supply a default itself (e.g., primitive items default
	// to 0; records need a factory).
	makeEmpty?: (ctx: SchemaContext) => unknown;
	// Per-item label for tree rendering. Falls back to `"#${index}"`.
	itemLabel?: (item: unknown, index: number, ctx: SchemaContext) => string;
	// Named custom renderer from the editor extension registry. When set,
	// the inspector renders this extension INSTEAD of the default
	// ListNavField / PrimListField. Use this to reuse pre-existing tabs
	// (e.g., FlowTypesTab) without rewriting them schema-first.
	customRenderer?: string;
	/**
	 * Layout hint for primitive lists. `'grid'` renders items as a CSS
	 * grid with `gridCols` columns — useful for fixed-length primitive
	 * arrays that represent a 2D matrix (e.g., `mauStateTimings: u16[16]`
	 * displayed as a 4×4 grid). Ignored by ListNavField (only applies to
	 * primitive-item lists handled by PrimListField).
	 */
	displayAs?: 'grid';
	gridCols?: number;
};

// Escape hatch — a named custom renderer registered at the editor level.
// Same pattern as visual-react's `component` property on a PropertyGroup:
// the schema declares the name; the editor extension registry supplies the
// React component at runtime. This is how existing Phase 1/2 tabs become
// custom renderers without schema awareness.
export type CustomFieldSchema = {
	kind: 'custom';
	component: string; // key into editor extension registry
};

// Union of everything a field can be.
export type FieldSchema =
	| PrimitiveFieldSchema
	| StructuredPrimitiveSchema
	| EnumFieldSchema
	| FlagsFieldSchema
	| RefFieldSchema
	| RecordFieldSchema
	| ListFieldSchema
	| CustomFieldSchema;

// ---------------------------------------------------------------------------
// Record-level metadata
// ---------------------------------------------------------------------------

// Per-field display / behavior overrides. Mirrors visual-react's
// `fieldMetadata` entries. Everything here is optional; the editor falls back
// to sensible defaults derived from the field schema kind.
export type FieldMetadata = {
	label?: string;
	description?: string;
	warning?: string;
	// Hidden fields are preserved by the walker (important for round-trip)
	// but not rendered in the tree or default inspector. Use for `_pad*`
	// bytes and derived fields like `muSizeInBytes`.
	hidden?: boolean;
	// Read-only fields are shown but not editable. Use for sizes / counts
	// that must be reconciled at write time.
	readOnly?: boolean;
	// Fields whose value is derived from another field. Not used by Phase A
	// itself, but Phase B's mutation helper can re-derive on edit.
	derivedFrom?: string;
	// Spatial vec3/vec4 flag. When true, the renderer displays axes in
	// Y-up order: label "Y" reads `value.z` and label "Z" reads `value.y`,
	// so users edit in comfortable XYZ while the underlying game model
	// (Z-up, Y=depth) is preserved byte-for-byte on disk. Opt-in because
	// a vec4 can also be a packed non-spatial value (e.g., BoundaryLine
	// packs `(startX, startY, endX, endY)`).
	swapYZ?: boolean;
};

// Property group — splits the inspector into tabs. A group can list fields,
// point at a custom extension component, or both.
export type PropertyGroup =
	| { title: string; properties: string[] }
	| { title: string; component: string }
	| { title: string; properties: string[]; component: string };

// Validation result — severity + message, optionally tagged with a field.
export type ValidationSeverity = 'error' | 'warning' | 'info';
export type ValidationResult = {
	severity: ValidationSeverity;
	message: string;
	field?: string;
};

// Record — the unit of schema declaration. One per nested struct type.
export type RecordSchema = {
	name: string; // matches the key used in SchemaRegistry
	description?: string;
	// Insertion-ordered map of field schemas. JS preserves insertion order,
	// which we rely on for deterministic rendering.
	fields: Record<string, FieldSchema>;
	fieldMetadata?: Record<string, FieldMetadata>;
	propertyGroups?: PropertyGroup[];
	// Optional tree label for instances of this type. Used for list items
	// that contain a record (e.g., `hulls[3]`). Falls back to `"#${index}"`.
	label?: (value: Record<string, unknown>, index: number | null, ctx: SchemaContext) => string;
	// Cross-field validation. Called on the record's value + schema context.
	validate?: (value: Record<string, unknown>, ctx: SchemaContext) => ValidationResult[];
	/**
	 * Derived-field hook. Called after any mutation that affects this
	 * record — compares `prev` vs `next` and returns a partial patch
	 * that gets merged on top of `next`. Use it to keep redundant cache
	 * fields in sync with their source of truth (e.g., `mfMaxVehicleRecip
	 * = 1/muMaxVehicles` on `TrafficSectionSpan`).
	 *
	 * The hook MUST be pure and should only update derived fields — never
	 * touch independent fields. If no change is needed, return `{}`.
	 *
	 * Fires at mutation time, not at write time. Bundles round-trip
	 * byte-exact if the user never touches the source field, because the
	 * derived field is passed through the writer verbatim.
	 */
	derive?: (
		prev: Record<string, unknown>,
		next: Record<string, unknown>,
	) => Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type SchemaRegistry = Record<string, RecordSchema>;

// Resource schema — pairs a SchemaRegistry with a root type name. This is
// what the editor loads when a resource is opened.
export type ResourceSchema = {
	key: string;           // matches ResourceHandler.key (e.g., "trafficData")
	name: string;          // display name
	rootType: string;      // top-level record type in `registry`
	registry: SchemaRegistry;
};

// ---------------------------------------------------------------------------
// Context passed to label / validate / makeEmpty callbacks
// ---------------------------------------------------------------------------

// Schema callbacks get a read-only view of the entire resource data so they
// can compute labels that reference external fields (e.g., a SectionFlow
// label that names its FlowType). Callbacks MUST NOT mutate `root`.
export type SchemaContext = {
	// Top-level resource model (frozen, read-only in practice).
	root: unknown;
	// The full resource schema (registry + rootType).
	resource: ResourceSchema;
	// The path to the record/field being labeled, if applicable.
	path?: (string | number)[];
};

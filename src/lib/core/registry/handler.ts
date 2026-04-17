// Core contract every resource type implements.
//
// Dependency rule: individual parser files (src/lib/core/*.ts) must NEVER
// import from this file or from src/lib/core/registry/*. The registry imports
// the parsers, not the other way around. That keeps the dependency graph
// acyclic: parsers → bundle → resourceManager, registry → parsers.

// ResourceCategory is defined here (instead of in resourceTypes.ts) so the
// registry can live at the bottom of the dependency graph and resourceTypes.ts
// can derive its RESOURCE_TYPES map from the registry without creating a cycle.
export type ResourceCategory = 'Graphics' | 'Audio' | 'Data' | 'Script' | 'Camera' | 'Other';

export type HandlerCaps = {
	read: boolean;
	write: boolean;
};

export type ResourceCtx = {
	// Always true for now — the whole codebase is 32-bit PC only. Kept as a
	// field so future console support doesn't require an interface break.
	littleEndian: boolean;
	// PLATFORMS.PC / PLATFORMS.XBOX360 / PLATFORMS.PS3 from types.ts. Kept
	// for diagnostics and future fork points.
	platform: number;
};

/**
 * Minimal view of a bundle-level resource that the collection picker can
 * use without dragging the full `UIResource` from BundleContext into the
 * registry layer (which would create a layering inversion — core shouldn't
 * know about UI types).
 */
export type PickerResourceCtx = {
	/** Formatted u64 hex id, e.g. `0x00000000ABCD1234`. Stable across sort. */
	id: string;
	/** Debug-data name when present, else the `Resource_<hex>` fallback. */
	name: string;
	/** Position within this handler key's list in bundle order. */
	index: number;
};

export type PickerBadge = {
	label: string;
	tone: 'muted' | 'warn' | 'accent';
};

export type PickerLabel = {
	/** Primary display text — e.g. `trk_1234_col`. */
	primary: string;
	/** Secondary muted text — e.g. `12 soups · 3,421 tris`. */
	secondary?: string;
	/** Right-aligned pills. The `empty` label is treated specially by the
	 *  tree header's "Hide empty" toggle. */
	badges?: PickerBadge[];
};

export type PickerEntry<Model = unknown> = {
	model: Model | null;
	ctx: PickerResourceCtx;
};

export type PickerSortKey<Model = unknown> = {
	id: string;
	label: string;
	compare(a: PickerEntry<Model>, b: PickerEntry<Model>): number;
};

/**
 * Per-handler config consumed by the tree-embedded collection picker when
 * a bundle contains >1 resource of this type. Optional — handlers whose
 * bundles only ever have one resource (TrafficData, StreetData) skip it.
 */
export type PickerConfig<Model = unknown> = {
	labelOf(model: Model | null, ctx: PickerResourceCtx): PickerLabel;
	sortKeys: PickerSortKey<Model>[];
	/** Id of the sort key to use by default. Must match one of `sortKeys[i].id`. */
	defaultSort: string;
	/** Returns text matched against the user's filter query. Defaults to the
	 *  primary label if omitted. */
	searchText?(model: Model | null, ctx: PickerResourceCtx): string;
};

export interface ResourceHandler<Model = unknown> {
	readonly typeId: number;
	/** Stable slug used in JSON dumps, CLI --type flags, and UI route paths. */
	readonly key: string;
	readonly name: string;
	readonly description: string;
	readonly category: ResourceCategory;
	readonly caps: HandlerCaps;

	/**
	 * Optional picker config for the tree-embedded resource switcher. Only
	 * consulted when the bundle has >1 resource with this handler's typeId.
	 */
	picker?: PickerConfig<Model>;

	/**
	 * Decode already-extracted, already-decompressed raw resource bytes into
	 * the handler's model type. The extractor (see registry/extract.ts) handles
	 * resource offset math, decompression, and nested-bundle detection — this
	 * function just maps bytes to a typed model.
	 */
	parseRaw(raw: Uint8Array, ctx: ResourceCtx): Model;

	/**
	 * Encode a model back to raw resource bytes. Omitted when caps.write is
	 * false. The CLI's pack/roundtrip commands and the UI's export pipeline
	 * both skip read-only handlers cleanly when this is missing.
	 */
	writeRaw?(model: Model, ctx: ResourceCtx): Uint8Array;

	/** One-line human summary printed by `bundle-cli parse`. */
	describe(model: Model): string;

	/** Pinned example fixtures for the auto-generated vitest suite. */
	fixtures: ResourceFixture[];

	/**
	 * Known mutation scenarios exercised by `bundle-cli stress`. Optional.
	 * Read-only handlers (caps.write === false) can still register scenarios
	 * but the CLI will refuse to run them since there is nothing to write.
	 */
	stressScenarios?: StressScenario<Model>[];

	/**
	 * Optional configuration for the `bundle-cli fuzz` command.
	 *
	 * `tolerateErrors` lists writer error-message patterns that the fuzzer
	 * should count as "expected rejection" rather than unexpected failure.
	 * For example, StreetData's writer throws when `challenges.length !=
	 * roads.length`; a generic structural mutation can easily violate that
	 * invariant, and the fuzzer should not flag it as a crash.
	 */
	fuzz?: {
		tolerateErrors?: RegExp[];
	};
}

/**
 * A single mutation scenario run by `bundle-cli stress`. Scenarios are
 * deliberately deterministic and small — they exist to catch writer /
 * reader bugs that only surface when specific fields are edited.
 */
export type StressScenario<Model = unknown> = {
	/** Short slug used for --scenario filtering from the CLI. */
	name: string;
	/** One-line description printed by the stress runner. */
	description?: string;
	/**
	 * Produce a mutated copy of the model. The runner always passes a deep
	 * clone, so mutating the argument in place is safe, but returning a new
	 * object makes intent clearer.
	 */
	mutate(model: Model): Model;
	/**
	 * Optional invariant check run after parse→write→parse. Receives the
	 * mutated model and the re-parsed model and returns an array of problem
	 * strings; an empty array means success. If omitted the runner only
	 * checks writer idempotence (two consecutive writes produce equal bytes).
	 */
	verify?(afterMutate: Model, afterReparse: Model): string[];
};

export type ResourceFixture = {
	/** Repo-relative path (e.g. 'example/BTTSTREETDATA.DAT'). */
	bundle: string;
	expect?: {
		/** Expect parseRaw to succeed without throwing. Defaults to true. */
		parseOk?: boolean;
		/**
		 * Expect writeRaw(parseRaw(raw)) to equal raw byte-for-byte. The
		 * strictest form of round-trip. StreetData can't hit this (the C#
		 * writer intentionally drops per-junction exits and per-road spans,
		 * producing a smaller payload), so use modelRoundTrip for it instead.
		 */
		byteRoundTrip?: boolean;
		/**
		 * Expect the writer to be idempotent: writeRaw(parseRaw(write1)) must
		 * equal write1 byte-for-byte, where write1 = writeRaw(parseRaw(raw)).
		 *
		 * This is the right check when the writer is intentionally lossy on
		 * the first pass (e.g. StreetData drops the retail spans/exits tail)
		 * but every subsequent write must be stable.
		 */
		stableWriter?: boolean;
	};
};

/**
 * Build a ResourceCtx from a ParsedBundle. Centralizes the platform→littleEndian
 * derivation so handlers never compute it themselves.
 */
export function resourceCtxFromBundle(bundle: { header: { platform: number } }): ResourceCtx {
	return {
		platform: bundle.header.platform,
		// PS3 is the only big-endian platform. Everything else is little-endian.
		// Kept as a bit so future X360 work can flip it explicitly.
		littleEndian: bundle.header.platform !== 3,
	};
}

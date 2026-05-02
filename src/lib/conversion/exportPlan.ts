// Pure analyser + runner for the "Export to game version..." flow.
//
// `analyzeExport` walks every parsed resource in an EditableBundle, looks up
// the EditorProfile for the model variant (V4 / V12 / etc.), and decides
// what each resource needs to do for the target preset:
//
//   - already on the target kind                          → pass through
//   - target preset doesn't constrain this resource type  → pass through
//   - mismatched kind, conversion registered              → migration
//   - mismatched kind, no conversion registered           → BLOCKER
//
// `runMigrations` executes the migration callbacks and aggregates the
// per-migration `defaulted` / `lossy` field lists into bundle-wide sets.
// Aggregation is "by resource key + path" so the user sees one entry per
// distinct field path even when many instances of the same type need
// migration (e.g. one entry for "aiSections: sections[].speed (from
// dangerRating)" rather than one per instance).
//
// Both functions are pure — no I/O, no React. The dialog consumes the
// result and decides whether to surface a confirmation step (lossy
// entries non-empty) or fire-and-forget (clean migration).
//
// The actual bytes-on-disk write happens in `applyExport.ts`; this module
// stops at the migrated models so the plan stays inspectable.

import type { EditableBundle } from '@/context/WorkspaceContext.types';
import { getHandlerByKey, getHandlerByTypeId } from '@/lib/core/registry';
import { pickProfile } from '@/lib/editor/registry';
import type { ConversionResult } from '@/lib/editor/types';
import type { TargetPreset } from './targets';

/**
 * One resource that can't be exported because no migration is registered
 * to take it from its current kind to the preset's required kind. The
 * dialog renders the list of blockers and disables the Export button when
 * any are present.
 */
export type Blocker = {
	resourceKey: string;
	index: number;
	typeId: number;
	currentKind: string;
	targetKind: string;
	/** Pre-formatted user-facing message. e.g.
	 *  `"AI Sections v4 → v12 (no migration registered)"`. */
	message: string;
};

/**
 * One resource that needs a kind change from current to target. The
 * `migrate` thunk is a no-arg call that runs the EditorProfile's
 * registered conversion against the current model — closure-captured so
 * the analyzer doesn't have to thread the model through.
 */
export type Migration = {
	resourceKey: string;
	index: number;
	typeId: number;
	currentKind: string;
	targetKind: string;
	/** Human label from the conversion entry — e.g.
	 *  `"Convert to v12 (Paradise PC Retail)"`. */
	label: string;
	/** No-arg call. Returns the migrated model + per-field bookkeeping. */
	migrate: () => ConversionResult<unknown>;
};

/**
 * Static analysis of the bundle against a preset. Doesn't run any
 * migrations — only inspects the registered conversion entries so the
 * dialog can decide whether to enable the Export button.
 */
export type ExportAnalysis = {
	migrations: Migration[];
	blockers: Blocker[];
};

/**
 * One executed migration plus the results the migration emitted. Carries
 * the original Migration entry so callers can map back to (resourceKey,
 * index) when wiring outputs into the writer.
 */
export type MigrationRun = {
	migration: Migration;
	result: unknown;
	defaulted: string[];
	lossy: string[];
};

/**
 * Aggregated bundle-wide migration outcome. `defaulted` and `lossy` are
 * deduped + sorted across every migration and prefixed with the
 * resourceKey so the dialog can show "aiSections: sections[].speed (from
 * dangerRating)" rather than just the bare field path.
 */
export type MigrationRunResult = {
	runs: MigrationRun[];
	defaulted: string[];
	lossy: string[];
};

/**
 * Walk every resource in the bundle and build a static analysis against
 * the preset. Pure — no migrations are run here.
 *
 * Resources whose typeId isn't constrained by the preset (`kinds[typeId]`
 * is undefined) pass through untouched — the export will keep their
 * original bytes / re-encoded bytes via the writer's normal pass-through
 * path. This matters because most preset targets only constrain a
 * handful of resource types; constraining every type would force every
 * future resource to ship with a `default` kind.
 *
 * Resources whose handler isn't registered in the editor registry (e.g.
 * texture, model — registered in `core/registry` but not in the editor
 * registry as of writing) also pass through. Those types will go through
 * the writer's reencode path; the export-to-version flow only intercepts
 * resources that actually have an editor profile to consult.
 */
export function analyzeExport(
	bundle: EditableBundle,
	preset: TargetPreset,
): ExportAnalysis {
	const migrations: Migration[] = [];
	const blockers: Blocker[] = [];

	for (const [key, instances] of bundle.parsedResourcesAll) {
		const handler = getHandlerByKey(key);
		if (!handler) continue;
		const typeId = handler.typeId;
		const targetKind = preset.kinds[typeId];
		if (targetKind === undefined) continue;

		for (let index = 0; index < instances.length; index++) {
			const model = instances[index];
			if (model == null) continue;

			const profile = pickProfile(typeId, model);
			if (!profile) continue;

			const currentKind = profile.kind;
			if (currentKind === targetKind) continue;

			const conversion = profile.conversions?.[targetKind];
			if (!conversion) {
				blockers.push({
					resourceKey: key,
					index,
					typeId,
					currentKind,
					targetKind,
					message: `${handler.name} ${currentKind} → ${targetKind} (no migration registered)`,
				});
				continue;
			}

			migrations.push({
				resourceKey: key,
				index,
				typeId,
				currentKind,
				targetKind,
				label: conversion.label,
				// Closure-capture the model so the runner is a pure thunk.
				migrate: () => conversion.migrate(model as never),
			});
		}
	}

	return { migrations, blockers };
}

/**
 * Run every migration in the analysis and aggregate the per-migration
 * field-level reports into a bundle-wide deduped sorted view.
 *
 * Field paths are prefixed with the resourceKey ("aiSections:
 * sections[].speed (from dangerRating)") so a future preset that
 * migrates two distinct resource types — say AI Sections AND
 * TrafficData — produces a readable mixed list instead of two
 * "sections[].speed" entries that look like the same thing.
 */
export function runMigrations(migrations: Migration[]): MigrationRunResult {
	const runs: MigrationRun[] = [];
	const allDefaulted = new Set<string>();
	const allLossy = new Set<string>();

	for (const m of migrations) {
		const r = m.migrate();
		runs.push({
			migration: m,
			result: r.result,
			defaulted: r.defaulted,
			lossy: r.lossy,
		});
		for (const f of r.defaulted) allDefaulted.add(`${m.resourceKey}: ${f}`);
		for (const f of r.lossy) allLossy.add(`${m.resourceKey}: ${f}`);
	}

	return {
		runs,
		defaulted: [...allDefaulted].sort(),
		lossy: [...allLossy].sort(),
	};
}

/**
 * Map each migration run back to the resourceId hex string used by the
 * bundle writer's `byResourceId` override map. Walks `bundle.parsed.resources`
 * in declaration order, counting per handler.key, and matches against the
 * (resourceKey, index) carried on each run. Resources without a registered
 * handler (rare — only types not in the core registry) are skipped.
 *
 * The returned record is suitable for direct use as `WriteOptions.overrides.byResourceId`
 * — values are the migrated model objects (NOT bytes), which the writer's
 * `applyOverride` plumbs through `handler.writeRaw(model, targetCtx)` to get
 * the final encoded bytes for the target platform.
 */
export function buildMigrationOverridesByResourceId(
	bundle: EditableBundle,
	runs: MigrationRun[],
): Record<string, unknown> {
	if (runs.length === 0) return {};

	// Keyed lookup: "key:index" -> migrated model.
	const byKeyIndex = new Map<string, unknown>();
	for (const run of runs) {
		byKeyIndex.set(`${run.migration.resourceKey}:${run.migration.index}`, run.result);
	}

	const overrides: Record<string, unknown> = {};
	const counters = new Map<string, number>();
	for (const resource of bundle.parsed.resources) {
		const handler = getHandlerByTypeId(resource.resourceTypeId);
		if (!handler) continue;
		const key = handler.key;
		const idx = counters.get(key) ?? 0;
		counters.set(key, idx + 1);

		const migrated = byKeyIndex.get(`${key}:${idx}`);
		if (migrated === undefined) continue;

		const idHex = `0x${(
			(BigInt(resource.resourceId.high) << 32n) | BigInt(resource.resourceId.low)
		)
			.toString(16)
			.toUpperCase()
			.padStart(16, '0')}`;
		overrides[idHex] = migrated;
	}

	return overrides;
}

// Bytes-on-disk side of the "Export to game version..." flow.
//
// Given a bundle, a target preset, and the migration runs from
// `runMigrations`, produce an ArrayBuffer that's ready to download. Two
// shapes:
//
//   - Source matches preset's (container, platform) AND no migrations
//     needed → write fresh in place, no shape changes. Equivalent to a
//     plain "Save Bundle" but the user has explicitly confirmed they want
//     the export pathway.
//
//   - Anything else → route through `convertBundle` with the migrated
//     models passed via `extraOverridesByResourceId`. convertBundle handles
//     the platform/container reshape; the writer's applyOverride hook
//     re-encodes each migrated model with the target ctx so the output
//     bytes are platform-correct.
//
// This module is the only place the export flow touches `convertBundle`
// directly — keeping it isolated means the planner stays React-free and
// the dialog stays UI-only.

import { convertBundle, writeBundleFresh } from '@/lib/core/bundle';
import type { EditableBundle } from '@/context/WorkspaceContext.types';
import type { TargetPreset } from './targets';
import {
	buildMigrationOverridesByResourceId,
	type MigrationRun,
} from './exportPlan';

/**
 * Build the output ArrayBuffer for an export. Pure — no I/O, no DOM. The
 * caller (the dialog) wraps the result in a Blob + download.
 */
export function applyExport(
	bundle: EditableBundle,
	preset: TargetPreset,
	runs: MigrationRun[],
): ArrayBuffer {
	const sourceIsBnd1 = !!bundle.parsed.bundle1Extras;
	const sourceContainer: 'bnd1' | 'bnd2' = sourceIsBnd1 ? 'bnd1' : 'bnd2';
	// BND1 carries its real platform on bundle1Extras; the wrapper's `header`
	// has been normalised to the same value but treat extras as authoritative.
	const sourcePlatform =
		bundle.parsed.bundle1Extras?.platform ?? bundle.parsed.header.platform;

	const sameContainer = sourceContainer === preset.container;
	const samePlatform = sourcePlatform === preset.platform;

	// Fast path: no shape changes, no migrations. Round-trip the bundle
	// through writeBundleFresh so the output is a clean repack (resource
	// table rebuilt, alignment normalised) — matches what "Save Bundle"
	// produces.
	if (sameContainer && samePlatform && runs.length === 0) {
		return writeBundleFresh(bundle.parsed, bundle.originalArrayBuffer);
	}

	// Common path: route through convertBundle. Migrations are passed as
	// extra overrides keyed by resourceId hex; convertBundle merges them on
	// top of its endian-flip overrides so the writer encodes each migrated
	// model with the target platform's ctx.
	const extraOverrides = buildMigrationOverridesByResourceId(bundle, runs);
	return convertBundle(bundle.parsed, bundle.originalArrayBuffer, {
		container: preset.container,
		platform: preset.platform,
		extraOverridesByResourceId:
			Object.keys(extraOverrides).length > 0 ? extraOverrides : undefined,
	});
}

/**
 * Default filename for an export. Inserts the preset id between the
 * bundle's basename and its extension so the user immediately sees which
 * version a saved file targets:
 *
 *     AI.DAT + paradise-pc-retail → AI.paradise-pc-retail.DAT
 *
 * Bundles without a recognisable extension just append the preset id.
 *
 * Pure helper — extracted so the dialog and the tests can share one rule.
 */
export function defaultExportFilename(
	sourceBundleId: string,
	preset: TargetPreset,
): string {
	// Find the LAST dot so multi-dot names like FOO.BAR.BIN keep their
	// inner segments intact ("FOO.BAR.paradise-pc-retail.BIN").
	const lastDot = sourceBundleId.lastIndexOf('.');
	if (lastDot <= 0) {
		// No extension or leading dot ("hidden") — just suffix.
		return `${sourceBundleId}.${preset.id}`;
	}
	const stem = sourceBundleId.slice(0, lastDot);
	const ext = sourceBundleId.slice(lastDot);
	return `${stem}.${preset.id}${ext}`;
}

// What a crash needs besides the meshes: which loaded bundle is the other half
// of the car and how many deformation rows the spec fills. A vehicle ships as a body bundle (VEH_<name>_GR: the
// GraphicsSpec, its models and meshes) and an attribute bundle
// (VEH_<name>_AT: the DeformationSpec plus the AttribSys vault).

import type { ParsedDeformationSpec } from '@/lib/core/deformationSpec';
import type { ParsedBundle } from '@/lib/core/types';
import { hasGraphicsSpec, type CrashBody } from './crashBody';

export type CarHalf = 'AT' | 'GR';

// VEH_PUSSC01_AT.BIN <-> VEH_PUSSC01_GR.BIN. Null when the id isn't named
// like either half.
export function twinBundleId(id: string, to: CarHalf): string | null {
	const m = /^(.*)_(AT|GR)(\.[^.]+)$/i.exec(id);
	return m ? `${m[1]}_${to}${m[3]}` : null;
}

// The user's explicit choice, else the same-named twin, else the first
// candidate (a mod body can borrow any loaded spec).
export function pickTwin<T extends { id: string }>(candidates: readonly T[], ownId: string | undefined, to: CarHalf, chosenId?: string): T | undefined {
	const twin = ownId ? twinBundleId(ownId, to)?.toLowerCase() : undefined;
	return candidates.find((b) => b.id === chosenId)
		?? candidates.find((b) => b.id.toLowerCase() === twin)
		?? candidates[0];
}

// The slice of a workspace bundle the crash setup reads.
export type CrashBundle = { id: string; parsed: ParsedBundle; parsedResources: Map<string, unknown> };

export const deformationSpecOf = (b: CrashBundle | undefined) =>
	(b?.parsedResources.get('deformationSpec') as ParsedDeformationSpec | undefined) ?? null;

// The DeformationSpec a body bundle crashes with: every other loaded bundle
// holding one is a candidate, the _AT twin preferred.
export function crashSpecFor<T extends CrashBundle>(body: T | null, bundles: readonly T[], chosenSpecId?: string) {
	if (!body || !hasGraphicsSpec(body.parsed)) return { candidates: [] as T[], picked: undefined, spec: null };
	const candidates = bundles.filter((b) => b !== body && deformationSpecOf(b));
	const picked = pickTwin(candidates, body.id, 'AT', chosenSpecId);
	return { candidates, picked, spec: deformationSpecOf(picked) };
}

// Offer the crash test when there's a spec and the meshes carry blend weights
// (a wheel or prop GraphicsSpec has none). An undecoded body (the "all
// renderables" source) still offers it, and the panel asks for GraphicsSpec.
export const crashTestAvailable = (spec: ParsedDeformationSpec | null, body: CrashBody | null) =>
	!!spec && (body === null || body.skinRows > 0);

// Rows the spec fills: the leading run of skinned tag points, then every
// part's driven points.
export function specRows(spec: ParsedDeformationSpec): number {
	let run = 0;
	while (run < spec.tagPoints.length && spec.tagPoints[run].skinnedPoint) run++;
	return run + spec.ikParts.reduce((n, p) => n + p.numberOfDrivenPoints, 0);
}

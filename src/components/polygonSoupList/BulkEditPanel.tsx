// Bulk-edit side panel for PolygonSoupList. Mounted while the bulk
// selection has at least one polygon and lets the user rewrite a single
// collisionTag field across every selected polygon at once. Lifted out of
// the legacy `PolygonSoupListPage` so the workspace's PSL flow can mount
// it too — see `WorkspacePage`'s right inspector + `PSLBulkProvider`.

import { useState } from 'react';
import { useResetOnChange } from '@/hooks/useResetOnChange';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
	AISectionPicker,
	FlagCheckbox,
} from '@/components/schema-editor/extensions/collisionTagExtension';
import {
	decodeCollisionTag,
	setAiSectionIndex,
	setSurfaceId,
	setTrafficInfo,
	setFlagFatal,
	setFlagDriveable,
	setFlagSuperfatal,
	trafficInfoLabel,
	SURFACE_ID_MAX,
	TRAFFIC_INFO_MAX,
} from '@/lib/core/collisionTag';
import type { PolygonSoupPoly } from '@/lib/core/polygonSoupList';
import type { NodePath } from '@/lib/schema/walk';

// ---------------------------------------------------------------------------
// Polygon-path utilities — shared with the PSLBulkProvider
// ---------------------------------------------------------------------------

export type PolyAddress = { soup: number; poly: number };

/** Polygon paths are exactly `['soups', S, 'polygons', P]`. Anything else
 *  isn't an editable polygon row — callers silently ignore the result. */
export function parsePolyPath(path: NodePath): PolyAddress | null {
	if (
		path.length === 4 &&
		path[0] === 'soups' &&
		typeof path[1] === 'number' &&
		path[2] === 'polygons' &&
		typeof path[3] === 'number'
	) {
		return { soup: path[1], poly: path[3] };
	}
	return null;
}

export function parsePolyPathKey(key: string): PolyAddress | null {
	const parts = key.split('/');
	if (parts.length !== 4 || parts[0] !== 'soups' || parts[2] !== 'polygons') return null;
	const soup = Number(parts[1]);
	const poly = Number(parts[3]);
	if (!Number.isFinite(soup) || !Number.isFinite(poly)) return null;
	return { soup, poly };
}

// ---------------------------------------------------------------------------
// Bulk-edit summary — folds the decoded collision-tag fields of every poly
// into either a single shared value or `null` ("mixed").
// ---------------------------------------------------------------------------

export type BulkSummary = {
	aiSectionIndex: number | null;
	surfaceId: number | null;
	trafficInfo: number | null;
	fatal: boolean | null;
	driveable: boolean | null;
	superfatal: boolean | null;
};

export function foldBulk(polys: PolygonSoupPoly[]): BulkSummary {
	const summary: BulkSummary = {
		aiSectionIndex: null,
		surfaceId: null,
		trafficInfo: null,
		fatal: null,
		driveable: null,
		superfatal: null,
	};
	if (polys.length === 0) return summary;
	const first = decodeCollisionTag(polys[0].collisionTag);
	summary.aiSectionIndex = first.aiSectionIndex;
	summary.surfaceId = first.surfaceId;
	summary.trafficInfo = first.trafficInfo;
	summary.fatal = first.fatal;
	summary.driveable = first.driveable;
	summary.superfatal = first.superfatal;
	for (let i = 1; i < polys.length; i++) {
		const d = decodeCollisionTag(polys[i].collisionTag);
		if (summary.aiSectionIndex !== d.aiSectionIndex) summary.aiSectionIndex = null;
		if (summary.surfaceId !== d.surfaceId) summary.surfaceId = null;
		if (summary.trafficInfo !== d.trafficInfo) summary.trafficInfo = null;
		if (summary.fatal !== d.fatal) summary.fatal = null;
		if (summary.driveable !== d.driveable) summary.driveable = null;
		if (summary.superfatal !== d.superfatal) summary.superfatal = null;
	}
	return summary;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export type BulkEditPanelProps = {
	count: number;
	summary: BulkSummary;
	onClear: () => void;
	applyBulk: (updater: (raw: number) => number) => void;
};

export function BulkEditPanel({
	count,
	summary,
	onClear,
	applyBulk,
}: BulkEditPanelProps) {
	const [aiDraft, setAiDraft] = useState<number | null>(summary.aiSectionIndex);
	const [surfaceDraft, setSurfaceDraft] = useState<string>(
		summary.surfaceId == null ? '' : String(summary.surfaceId),
	);
	const [trafficDraft, setTrafficDraft] = useState<string>(
		summary.trafficInfo == null ? '' : String(summary.trafficInfo),
	);

	// When the selection becomes homogeneous for a field, seed the draft so
	// the "Apply" button previews the value the user would leave in place.
	// Mixed values don't overwrite the draft so the user can still type.
	useResetOnChange(summary.aiSectionIndex, () => {
		if (summary.aiSectionIndex != null) setAiDraft(summary.aiSectionIndex);
	});
	useResetOnChange(summary.surfaceId, () => {
		if (summary.surfaceId != null) setSurfaceDraft(String(summary.surfaceId));
	});
	useResetOnChange(summary.trafficInfo, () => {
		if (summary.trafficInfo != null) setTrafficDraft(String(summary.trafficInfo));
	});

	const applyAiSection = () => {
		if (aiDraft == null) return;
		applyBulk((raw) => setAiSectionIndex(raw, aiDraft));
	};

	const applySurface = () => {
		const v = parseInt(surfaceDraft, 10);
		if (!Number.isFinite(v) || v < 0 || v > SURFACE_ID_MAX) return;
		applyBulk((raw) => setSurfaceId(raw, v));
	};

	const applyTraffic = () => {
		const v = parseInt(trafficDraft, 10);
		if (!Number.isFinite(v) || v < 0 || v > TRAFFIC_INFO_MAX) return;
		applyBulk((raw) => setTrafficInfo(raw, v));
	};

	return (
		<div className="overflow-auto rounded border border-amber-500/40 bg-background/60">
			<div className="p-3 border-b border-amber-500/40 flex items-center justify-between gap-2 bg-amber-500/5">
				<div>
					<div className="text-sm font-medium">Bulk edit</div>
					<div className="text-[11px] text-muted-foreground">
						{count} polygon{count === 1 ? '' : 's'} selected
					</div>
				</div>
				<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>
					Clear
				</Button>
			</div>
			<div className="p-3 space-y-4">
				<div className="space-y-1">
					<div className="text-[11px] font-medium text-muted-foreground">AI section index</div>
					<AISectionPicker
						value={summary.aiSectionIndex ?? aiDraft}
						onChange={(v) => setAiDraft(v)}
						placeholder={summary.aiSectionIndex == null ? '(mixed)' : undefined}
					/>
					<Button
						size="sm"
						className="h-7 text-xs w-full"
						disabled={aiDraft == null}
						onClick={applyAiSection}
					>
						Apply AI section to {count}
					</Button>
				</div>

				<div className="space-y-1">
					<div className="text-[11px] font-medium text-muted-foreground">Surface ID</div>
					<Input
						type="number"
						min={0}
						max={SURFACE_ID_MAX}
						value={surfaceDraft}
						placeholder={summary.surfaceId == null ? '(mixed)' : undefined}
						className="h-8 font-mono text-xs"
						onChange={(e) => setSurfaceDraft(e.target.value)}
					/>
					<Button
						size="sm"
						className="h-7 text-xs w-full"
						disabled={surfaceDraft === ''}
						onClick={applySurface}
					>
						Apply surface to {count}
					</Button>
				</div>

				<div className="space-y-2">
					<div className="text-[11px] font-medium text-muted-foreground">Flags</div>
					<div className="space-y-2">
						<BulkFlagRow
							key={`fatal:${summary.fatal ?? 'mixed'}`}
							label="Fatal (wreck)"
							value={summary.fatal}
							onApply={(v) => applyBulk((raw) => setFlagFatal(raw, v))}
							count={count}
						/>
						<BulkFlagRow
							key={`driveable:${summary.driveable ?? 'mixed'}`}
							label="Driveable"
							value={summary.driveable}
							onApply={(v) => applyBulk((raw) => setFlagDriveable(raw, v))}
							count={count}
						/>
						<BulkFlagRow
							key={`superfatal:${summary.superfatal ?? 'mixed'}`}
							label="Superfatal"
							value={summary.superfatal}
							onApply={(v) => applyBulk((raw) => setFlagSuperfatal(raw, v))}
							count={count}
						/>
					</div>
				</div>

				<div className="space-y-1">
					<div className="text-[11px] font-medium text-muted-foreground">Traffic info</div>
					<Input
						type="number"
						min={0}
						max={TRAFFIC_INFO_MAX}
						value={trafficDraft}
						placeholder={summary.trafficInfo == null ? '(mixed)' : undefined}
						className="h-8 font-mono text-xs"
						onChange={(e) => setTrafficDraft(e.target.value)}
					/>
					{trafficDraft !== '' && (
						<div className="text-[10px] text-muted-foreground font-mono">
							{trafficInfoLabel(parseInt(trafficDraft, 10))}
						</div>
					)}
					<Button
						size="sm"
						className="h-7 text-xs w-full"
						disabled={trafficDraft === ''}
						onClick={applyTraffic}
					>
						Apply traffic to {count}
					</Button>
				</div>
			</div>
		</div>
	);
}

// Per-flag bulk row: shows the indeterminate state, lets the user pick a
// target value, and fires an Apply that rewrites that flag on every
// selected polygon.
function BulkFlagRow({
	label,
	value,
	onApply,
	count,
}: {
	label: string;
	value: boolean | null;
	onApply: (next: boolean) => void;
	count: number;
}) {
	// Parent re-keys this row when `value` flips between non-null values,
	// remounting and seeding `draft` afresh through the useState
	// initializer below — so no effect is needed to follow `value`.
	const [draft, setDraft] = useState<boolean>(value ?? false);

	return (
		<div className="flex items-center justify-between gap-2">
			<FlagCheckbox label={label} value={draft} onChange={setDraft} />
			<Button
				variant="outline"
				size="sm"
				className="h-6 text-[10px] px-2"
				onClick={() => onApply(draft)}
			>
				Apply to {count}
			</Button>
		</div>
	);
}

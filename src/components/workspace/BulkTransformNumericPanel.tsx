// BulkTransformNumericPanel — the numeric companion to the WorldViewport's
// BulkTransformGizmo (issue #81). Renders in the right inspector pane while
// a gizmo session is active.
//
// Three triples:
//   - Translate Δ (X, Y, Z) — staged delta; live during drag, editable;
//     pressing Enter / blurring commits a one-shot transform (one Workspace-
//     undo entry).
//   - Rotate Δ (X, Y, Z, in degrees for the user; radians on the wire).
//     Auto-disable: X and Z greyed out when the Selection contains any
//     XZ-packed resource (ADR-0011) — flag comes off the session's axes.
//   - Pivot (X, Y, Z) — absolute world coordinates of the gizmo's pivot.
//     Live-editable; no undo entry (pivot is part of Tools, not history).
//
// Bidirectional binding: the panel reads from the GizmoSession (kept fresh
// by the overlay during a drag — every drag-frame updates `session.delta`)
// and writes back through `session.setDelta` (live preview), `session.commit`
// (typed Enter — one-shot), and `session.setPivot` (no-undo).
//
// All deltas reset to zero after every commit — the "Blender N panel" idiom.
// The reset is driven by the overlay clearing its `drag` state on commit;
// when the session re-publishes with `delta = identityDelta()`, the panel's
// controlled inputs follow.

import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { identityDelta, type BulkTransformDelta } from '@/hooks/useBulkTransformDrag';
import {
	applyTypedDeltaEdit,
	applyTypedPivotEdit,
	useBulkTransformGizmoSession,
} from './BulkTransformGizmoSession';

// =============================================================================
// Public component
// =============================================================================

export function BulkTransformNumericPanel() {
	const session = useBulkTransformGizmoSession();
	if (!session) return null;
	return <BulkTransformNumericPanelInner key={session.id} session={session} />;
}

// Inner component is keyed by `session.id` so navigating to a different
// gizmo target resets every typed-but-uncommitted field to the new auto-
// derived starting values. Otherwise stale local input strings would carry
// across selections.
type SessionForInner = ReturnType<typeof useBulkTransformGizmoSession>;

function BulkTransformNumericPanelInner({
	session,
}: {
	session: NonNullable<SessionForInner>;
}) {
	const { delta, pivot, axes, setDelta, commit, setPivot } = session;

	// Local input mirrors so typing doesn't commit on every keystroke. Each
	// axis keeps a string state synchronised with the session's numeric value
	// (so a drag-frame update or a session reset overwrites stale input
	// text). Committing happens on Enter / blur.
	return (
		<div className="border-t bg-card/40">
			<div className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
				Bulk transform
			</div>
			<div className="px-3 pb-3 space-y-3">
				<DeltaTriple
					label="Translate Δ"
					kind="translate"
					value={delta}
					axes={axes.translate}
					unit=""
					setDelta={setDelta}
					commit={commit}
				/>
				<DeltaTriple
					label="Rotate Δ"
					kind="rotate"
					value={delta}
					axes={axes.rotate}
					unit="°"
					rotationDegrees
					setDelta={setDelta}
					commit={commit}
				/>
				<PivotTriple pivot={pivot} setPivot={setPivot} />
			</div>
		</div>
	);
}

// =============================================================================
// Δ triple — translate or rotate
// =============================================================================
//
// A triple of editable number inputs bound to one of the BulkTransformDelta
// sub-records (`translate` or `rotate`). The `axes` prop drives the auto-
// disable rule: an axis with `enabled: false` renders read-only / greyed
// (e.g. rotate X & Z when the selection has XZ-packed resources, per
// ADR-0011).

function DeltaTriple({
	label,
	kind,
	value,
	axes,
	unit,
	rotationDegrees,
	setDelta,
	commit,
}: {
	label: string;
	kind: 'translate' | 'rotate';
	value: BulkTransformDelta;
	/** Per-axis enable flags. False ⇒ field is read-only and visually muted. */
	axes: { x: boolean; y: boolean; z: boolean };
	unit: string;
	/** Rotation values are shown to the user in degrees but stored on the
	 *  wire as radians. Defaults to false (translate values stay verbatim). */
	rotationDegrees?: boolean;
	setDelta: (next: BulkTransformDelta) => void;
	commit: (typed: BulkTransformDelta) => void;
}) {
	const toDisplay = (v: number) => (rotationDegrees ? (v * 180) / Math.PI : v);
	const fromDisplay = (v: number) => (rotationDegrees ? (v * Math.PI) / 180 : v);

	const rec = value[kind];
	const renderAxis = (axis: 'x' | 'y' | 'z') => {
		const enabled = axes[axis];
		const numeric = rec[axis];
		return (
			<NumericAxisInput
				key={`${kind}-${axis}`}
				axisLabel={axis.toUpperCase()}
				enabled={enabled}
				unit={unit}
				value={toDisplay(numeric)}
				onPreview={(typedDisplay) => {
					const radians = fromDisplay(typedDisplay);
					setDelta(applyTypedDeltaEdit(value, kind, axis, radians));
				}}
				onCommit={(typedDisplay) => {
					const radians = fromDisplay(typedDisplay);
					commit(applyTypedDeltaEdit(value, kind, axis, radians));
				}}
				onResetPreview={() => {
					// Discard preview — reset the field's contribution to the
					// staged delta. Without this, hitting Escape mid-edit
					// would leave a phantom preview in place.
					setDelta(applyTypedDeltaEdit(value, kind, axis, 0));
				}}
			/>
		);
	};

	return (
		<div>
			<div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
			<div className="grid grid-cols-3 gap-2">
				{renderAxis('x')}
				{renderAxis('y')}
				{renderAxis('z')}
			</div>
		</div>
	);
}

// =============================================================================
// Pivot triple
// =============================================================================
//
// Absolute-world-coord pivot editor. Identical shape to a Δ triple but the
// commit semantics are different: every edit is a `setPivot` (live + no
// undo), so we don't bother with a "preview / commit" split. Enter / blur
// is the natural moment to push the typed value but we could just as well
// push on every change — pivot updates are cheap and never history-bearing.

function PivotTriple({
	pivot,
	setPivot,
}: {
	pivot: { x: number; y: number; z: number };
	setPivot: (world: { x: number; y: number; z: number }) => void;
}) {
	const renderAxis = (axis: 'x' | 'y' | 'z') => (
		<NumericAxisInput
			key={`pivot-${axis}`}
			axisLabel={axis.toUpperCase()}
			enabled
			unit=""
			value={pivot[axis]}
			onPreview={(typed) => setPivot(applyTypedPivotEdit(pivot, axis, typed))}
			onCommit={(typed) => setPivot(applyTypedPivotEdit(pivot, axis, typed))}
			// Pivot has no "reset to zero" meaning — pressing Escape just
			// reverts the visible text to the latest pivot value via the
			// controlled `value` prop.
			onResetPreview={() => {}}
		/>
	);

	return (
		<div>
			<div className="text-xs font-medium text-muted-foreground mb-1">Pivot</div>
			<div className="grid grid-cols-3 gap-2">
				{renderAxis('x')}
				{renderAxis('y')}
				{renderAxis('z')}
			</div>
		</div>
	);
}

// =============================================================================
// One numeric axis input
// =============================================================================
//
// A controlled <input type="number"> that:
//   - Mirrors `value` into local state so React drag-frame updates overwrite
//     stale typing.
//   - Calls `onPreview` on every keystroke (live binding — drives the gizmo
//     preview while the user types into the Δ fields).
//   - Calls `onCommit` on Enter / blur (one-shot commit; one Workspace-undo
//     entry).
//   - Calls `onResetPreview` on Escape (drops the staged value).
//   - Renders disabled and muted when `enabled === false` (auto-disable
//     rule for X / Z rotate fields on XZ-packed selections, per ADR-0011).

function NumericAxisInput({
	axisLabel,
	enabled,
	unit,
	value,
	onPreview,
	onCommit,
	onResetPreview,
}: {
	axisLabel: string;
	enabled: boolean;
	unit: string;
	value: number;
	onPreview: (typed: number) => void;
	onCommit: (typed: number) => void;
	onResetPreview: () => void;
}) {
	const [text, setText] = useState(() => formatNumber(value));

	// Sync local text with prop updates from outside (drag-frame, commit
	// reset, session change). Skip re-syncing when the parsed local value
	// already equals the prop — avoids clobbering the user's in-progress
	// typing on every prop tick (drag-frames at 60fps would otherwise wipe
	// the input mid-edit).
	useEffect(() => {
		const parsed = parseFloat(text);
		if (Number.isFinite(parsed) && Math.abs(parsed - value) < 1e-9) return;
		setText(formatNumber(value));
		// Intentionally NOT depending on `text` — that would loop.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value]);

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const next = e.target.value;
			setText(next);
			const parsed = parseFloat(next);
			if (Number.isFinite(parsed)) onPreview(parsed);
		},
		[onPreview],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				const parsed = parseFloat(text);
				if (Number.isFinite(parsed)) onCommit(parsed);
				else onCommit(0);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				onResetPreview();
			}
		},
		[text, onCommit, onResetPreview],
	);

	const handleBlur = useCallback(() => {
		const parsed = parseFloat(text);
		if (Number.isFinite(parsed) && Math.abs(parsed - value) > 1e-9) {
			onCommit(parsed);
		}
	}, [text, value, onCommit]);

	return (
		<div className="flex flex-col gap-0.5">
			<span className="text-[10px] text-muted-foreground">
				{axisLabel}{unit ? ` (${unit})` : ''}
			</span>
			<Input
				type="number"
				step="any"
				disabled={!enabled}
				aria-disabled={!enabled}
				aria-label={`Axis ${axisLabel}`}
				className={
					'h-7 w-full font-mono text-xs' +
					(!enabled ? ' opacity-50 cursor-not-allowed' : '')
				}
				value={text}
				onChange={handleChange}
				onKeyDown={handleKeyDown}
				onBlur={handleBlur}
			/>
		</div>
	);
}

function formatNumber(v: number): string {
	if (!Number.isFinite(v)) return '0';
	// Trim trailing zeros while keeping a sensible precision. Plain `String`
	// gives "0.30000000000000004" for accumulated float math, which crowds
	// the input visually — round to 6 sig figs first.
	const rounded = Math.round(v * 1e6) / 1e6;
	if (rounded === 0) return '0';
	return String(rounded);
}

// Re-export the identityDelta helper so test scaffolding can build a
// zeroed session without re-importing from the hook.
export { identityDelta };

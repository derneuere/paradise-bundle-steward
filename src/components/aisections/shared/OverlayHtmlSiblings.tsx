// OverlayHtmlSiblings — DOM-overlay JSX registered into the WorldViewport
// chrome's HTML slot so the snap toggle, marquee, edge context menu, and
// V12-only cascade/soup-skip hints float above the WebGL surface.
//
// Combines the previously-duplicated `HtmlSiblings` from
// `AISectionsOverlay` and `AISectionsLegacyOverlay`. The V12-only pieces
// (cascade toggle, cascade hint, polygon-soup skip hint) are gated by the
// optional props — V4/V6 leaves them undefined and the UI piece drops out.
//
// The `useWorldViewportHtmlSlot(isActive ? node : null)` pattern (ADR-
// 0007 / issue #24): when this overlay isn't the active resource the
// chrome drops our DOM siblings entirely.

import React, { useMemo } from 'react';
import { Copy, Link2, Magnet } from 'lucide-react';
import * as THREE from 'three';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
import { useWorldViewportHtmlSlot } from '@/components/schema-editor/viewports/WorldViewport';
import { EdgeContextMenu } from './EdgeContextMenu';

export function OverlayHtmlSiblings({
	isActive,
	snapEnabled,
	toggleSnap,
	cascadeEnabled,
	toggleCascade,
	cameraBridge,
	onMarquee,
	edgeMenu,
	canDuplicate = true,
	onDuplicateThroughEdge,
	onCloseEdgeMenu,
	cascadeActive,
	skippedSoupCount,
	showSkippedSoupHint,
	marqueeHint = 'press B to box-select AI sections',
}: {
	isActive: boolean;
	snapEnabled: boolean;
	toggleSnap: () => void;
	/** V12-only — sticky cascade toggle. When undefined the Cascade
	 *  button doesn't render (V4/V6 has no cascade affordance). */
	cascadeEnabled?: boolean;
	toggleCascade?: () => void;
	cameraBridge: React.MutableRefObject<CameraBridgeData | null>;
	onMarquee: (frustum: THREE.Frustum, mode: 'add' | 'remove') => void;
	edgeMenu: { x: number; y: number; sectionIndex: number; edgeIdx: number } | null;
	/** V4/V6 wires this from `!!onChange` so the duplicate option disables
	 *  in read-only mode. V12 always allows it (defaults to true). */
	canDuplicate?: boolean;
	onDuplicateThroughEdge: () => void;
	onCloseEdgeMenu: () => void;
	/** V12-only — true when an in-flight gesture is in cascade-on mode. */
	cascadeActive?: boolean;
	/** V12-only — distinct polygon-soup count across the workspace's
	 *  active PSL bulk (issue #82). */
	skippedSoupCount?: number;
	/** V12-only — true when the soup-skip hint should render. */
	showSkippedSoupHint?: boolean;
	marqueeHint?: string;
}) {
	const node = useMemo(
		() => (
			<>
				<MarqueeSelector
					bridge={cameraBridge}
					far={50000}
					onMarquee={onMarquee}
					hintIdle={marqueeHint}
				/>

				{/* Snap + (V12-only) Cascade toggle row. Wrapped in a flex
				    container so the two buttons layout side-by-side without
				    per-button absolute positioning — the Snap label's width
				    varies with on/off, so a guessed `left: NNpx` on the
				    Cascade button overlapped at some labels. */}
				<div
					style={{
						position: 'absolute',
						top: 8,
						left: 8,
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						pointerEvents: 'none', // children opt back in
					}}
				>
					<button
						type="button"
						onClick={toggleSnap}
						title={snapEnabled
							? 'Snap to edges: ON (S to toggle)'
							: 'Snap to edges: OFF (S to toggle)'}
						aria-pressed={snapEnabled}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 6,
							padding: '4px 8px',
							borderRadius: 6,
							fontSize: 11,
							fontFamily: 'monospace',
							border: '1px solid rgba(255,255,255,0.15)',
							background: snapEnabled ? 'rgba(80, 170, 110, 0.85)' : 'rgba(20, 22, 28, 0.85)',
							color: snapEnabled ? '#fff' : 'rgba(255,255,255,0.7)',
							cursor: 'pointer',
							userSelect: 'none',
							boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
							pointerEvents: 'auto',
						}}
					>
						<Magnet size={14} />
						<span>Snap{snapEnabled ? ' · on' : ' · off'}</span>
						<span style={{ opacity: 0.5, fontSize: 10 }}>S</span>
					</button>

					{toggleCascade != null && (
						<button
							type="button"
							onClick={toggleCascade}
							title={cascadeEnabled
								? 'Keep connections (cascade): ON — hold Shift on a gesture for non-cascading (C to toggle)'
								: 'Keep connections (cascade): OFF — hold Shift on a gesture for cascading (C to toggle)'}
							aria-pressed={cascadeEnabled}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 6,
								padding: '4px 8px',
								borderRadius: 6,
								fontSize: 11,
								fontFamily: 'monospace',
								border: '1px solid rgba(255,255,255,0.15)',
								// Magenta tint when ON — matches the in-flight cascade
								// hint halo / status badge below, so the user can
								// associate the toggle with what they'll see when a
								// gesture fires.
								background: cascadeEnabled ? 'rgba(200, 80, 180, 0.85)' : 'rgba(20, 22, 28, 0.85)',
								color: cascadeEnabled ? '#fff' : 'rgba(255,255,255,0.7)',
								cursor: 'pointer',
								userSelect: 'none',
								boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
								pointerEvents: 'auto',
							}}
						>
							<Link2 size={14} />
							<span>Cascade{cascadeEnabled ? ' · on' : ' · off'}</span>
							<span style={{ opacity: 0.5, fontSize: 10 }}>C</span>
						</button>
					)}
				</div>

				{edgeMenu && (
					<EdgeContextMenu
						x={edgeMenu.x}
						y={edgeMenu.y}
						edgeIdx={edgeMenu.edgeIdx}
						onClose={onCloseEdgeMenu}
					>
						<button
							type="button"
							className="w-full text-left flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
							onClick={onDuplicateThroughEdge}
							disabled={!canDuplicate}
							title={canDuplicate ? undefined : 'No edit handler wired — overlay is read-only here'}
						>
							<Copy className="h-3.5 w-3.5" />
							Duplicate section through this edge
						</button>
					</EdgeContextMenu>
				)}

				{/* Cascade status hint — appears top-centre during a Shift-
				    held bulk-transform gesture (CONTEXT.md / "Cascade",
				    ADR-0009, issue #75). Magenta tint matches the gizmo's
				    cascade halo so the two cues read as one mode. V12-only;
				    V4/V6 leaves `cascadeActive` undefined and this drops. */}
				{cascadeActive && (
					<div
						role="status"
						aria-live="polite"
						style={{
							position: 'absolute',
							top: 8,
							left: '50%',
							transform: 'translateX(-50%)',
							padding: '4px 10px',
							borderRadius: 6,
							fontSize: 11,
							fontFamily: 'monospace',
							border: '1px solid #ff66cc',
							background: 'rgba(255, 102, 204, 0.18)',
							color: '#ffaadd',
							pointerEvents: 'none',
							userSelect: 'none',
							boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
							whiteSpace: 'nowrap',
						}}
					>
						Cascade ON · outside neighbours follow
					</div>
				)}

				{/* Polygon-soup skip hint — appears top-centre (offset down
				    if the cascade hint is also on so they stack cleanly)
				    when the Selection contains transformable entities AND
				    1+ polygon soups (issue #82). Polygon soups have no
				    world-space placement field (vertices u16-packed into
				    local soup-space — CONTEXT.md / "Pivot"), so the
				    transform delta is applied to the non-soup entities
				    only. Amber tint distinguishes it from the cascade
				    magenta — the two cues represent unrelated states.
				    V12-only. */}
				{showSkippedSoupHint && skippedSoupCount != null && skippedSoupCount > 0 && (
					<div
						role="status"
						aria-live="polite"
						data-testid="bulk-transform-soup-skip-hint"
						style={{
							position: 'absolute',
							top: cascadeActive ? 36 : 8,
							left: '50%',
							transform: 'translateX(-50%)',
							padding: '4px 10px',
							borderRadius: 6,
							fontSize: 11,
							fontFamily: 'monospace',
							border: '1px solid #f59e0b',
							background: 'rgba(245, 158, 11, 0.18)',
							color: '#fbbf24',
							pointerEvents: 'none',
							userSelect: 'none',
							boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
							whiteSpace: 'nowrap',
						}}
					>
						{skippedSoupCount} polygon soup{skippedSoupCount === 1 ? '' : 's'} not transformed
					</div>
				)}
			</>
		),
		[
			snapEnabled,
			toggleSnap,
			cascadeEnabled,
			toggleCascade,
			cameraBridge,
			onMarquee,
			edgeMenu,
			canDuplicate,
			onDuplicateThroughEdge,
			onCloseEdgeMenu,
			cascadeActive,
			showSkippedSoupHint,
			skippedSoupCount,
			marqueeHint,
		],
	);
	useWorldViewportHtmlSlot(isActive ? node : null);
	return null;
}

/** Re-export the camera-bridge `<CameraBridge>` companion so callers can
 *  wire the inside-Canvas mirror alongside this DOM-overlay component.
 *  Not strictly needed (callers already import CameraBridge directly),
 *  but keeping the two together documents the pairing. */
export { CameraBridge };

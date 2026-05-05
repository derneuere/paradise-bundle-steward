// SectionDetail — portal spheres / boundary lines / no-go lines / portal-link
// dashed lines for ONE AI section. Extracted from `AISectionsOverlay.tsx`
// (V12) and `AISectionsLegacyOverlay.tsx` (V4/V6) so the bulk-select rendering
// path can spawn one detail layer per bulk-member section without cloning the
// whole block twice.
//
// Why a single component spans V12 and V4/V6: the shapes are isomorphic at
// the rendering level — both yield "a list of portals each at an XYZ with a
// linkSection target, a list of boundary lines each with an x/y/z/w pair,
// a list of no-go lines with the same x/y/z/w, and a method to look up the
// link target so the dashed line can land on terrain". The ROOT shape that
// HOSTS those lists differs (V12 has corners as `Vector2[]`, V4 has parallel
// `cornersX[]`/`cornersZ[]` and `midPosition: Vector4` instead of
// `position: Vector3`). The accessor pattern lets each schema project from
// its native storage; no intermediate-representation allocation.
//
// Visual conventions (kept in lock-step with the originals — issue #35):
//   - Cyan portal spheres with a small Html label `Portal P → Sec N`.
//   - Selected portal swaps to `portalSelMat` (orange).
//   - Red boundary line segments; selected boundary line goes orange + thicker
//     and shows X/Y and Z/W endpoint labels.
//   - Orange (`#cc8833`) no-go lines; selected one goes orange-yellow + thicker.
//   - Dashed cyan portal-link lines from each portal anchor to the centre of
//     the target section (or to no-target when `linkSection` is invalid).
//
// The detail layer is rendered ONCE for the inspector-selected section
// (with the marker carrying the deeper portal/boundary/noGo selection so the
// drill-down highlights show), and ONCE PER BULK MEMBER that isn't the
// inspector-selected section (with `marker = null` so only the structural
// outlines render — the inspector-only highlights stay locked to the one
// section the user is editing).

import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { portalGeo, portalMat, portalSelMat } from './materials';
import type { AISectionMarker } from './selection';

// ---------------------------------------------------------------------------
// Display shapes — what the accessors produce. These are intentionally
// rendering-only types; they don't reach into either schema's parser shape.
// V12 / V4 adapters convert from their native storage to these on call.
// ---------------------------------------------------------------------------

export type DisplayPortal = {
	/** World-space anchor point. V12 sources this from `portal.position`,
	 *  V4/V6 from `portal.midPosition` (Vector4 on disk; the .w byte is
	 *  structural padding so it's dropped here). */
	position: { x: number; y: number; z: number };
	/** Section index this portal links to. -1 / out-of-range when the link
	 *  is dangling (empty bundle, V4 prototype data with stale indexes). The
	 *  detail layer drops the dashed line when the target can't be resolved. */
	linkSection: number;
	boundaryLines: readonly DisplayBoundaryLine[];
};

export type DisplayBoundaryLine = {
	/** Endpoints encoded as a Vector4 on disk: (x,y) is start XZ, (z,w) is
	 *  end XZ. Y comes from the parent portal anchor for boundary lines and
	 *  from the section's resolved baseY for no-go lines. */
	verts: { x: number; y: number; z: number; w: number };
};

/**
 * Per-variant accessor — turns a raw section object (V12 `AISection` or V4/V6
 * `LegacyAISection`) into the display-only shapes above plus a method to
 * resolve a link target's centre on the ground plane.
 */
export type SectionDetailAccessor<TSection, TRoot> = {
	portals: (s: TSection) => readonly DisplayPortal[];
	noGoLines: (s: TSection) => readonly DisplayBoundaryLine[];
	/**
	 * Look up a target section by index. Returns null when the index is out
	 * of range OR when the target's corner storage is too small to host a
	 * meaningful centre point for the link line (legacy V4 fixtures
	 * sometimes ship 2-corner stubs). When non-null the caller follows up
	 * with `centreOf(root, idx)` for the link's far endpoint.
	 */
	sectionAt: (root: TRoot, idx: number) => TSection | null;
	/**
	 * Compute the link-line endpoint for the target at `idx`. The Y here is
	 * the GROUND Y of that target — V12 looks it up via the resolved
	 * sectionYs map, V4 falls back to the source's portal Y. Returns null
	 * when the index is invalid; the caller drops the dashed line in that
	 * case. Taking the index (not the section object) lets the V12 closure
	 * reach into its captured sectionYs without smuggling the index inside
	 * the section record.
	 */
	centreOf: (root: TRoot, idx: number, sourcePortalY: number) =>
		| { x: number; y: number; z: number }
		| null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SectionDetail<TSection, TRoot>({
	section,
	root,
	accessor,
	marker,
	baseY,
	onPickPortal,
	onPickBoundaryLine,
	onPickNoGoLine,
}: {
	section: TSection;
	root: TRoot;
	accessor: SectionDetailAccessor<TSection, TRoot>;
	/** Inspector-selected marker, used to highlight the picked sub-entity
	 *  (portal / boundary line / no-go line). Pass `null` for bulk-only
	 *  rendering — bulk members get the full structural geometry but no
	 *  selected-sub-entity highlights, so the user knows which one is the
	 *  inspector pick. */
	marker: AISectionMarker;
	/** Y of the section's resolved ground. Used to lift no-go lines onto
	 *  the section's ground plane. Portal anchors and portal boundary lines
	 *  carry their own absolute Y (the wire format stores it explicitly)
	 *  and ignore this. */
	baseY: number;
	onPickPortal?: (portalIndex: number) => void;
	onPickBoundaryLine?: (portalIndex: number, lineIndex: number) => void;
	onPickNoGoLine?: (lineIndex: number) => void;
}) {
	const portals = useMemo(() => accessor.portals(section), [section, accessor]);
	const noGoLines = useMemo(() => accessor.noGoLines(section), [section, accessor]);

	return (
		<>
			{portals.map((portal, pi) => {
				const pos: [number, number, number] = [portal.position.x, portal.position.y, portal.position.z];
				const isSel = marker?.kind === 'portal' && marker.portalIndex === pi;
				return (
					<group key={`portal-${pi}`} position={pos}>
						<mesh
							geometry={portalGeo}
							material={isSel ? portalSelMat : portalMat}
							onClick={onPickPortal ? (e) => { e.stopPropagation(); onPickPortal(pi); } : undefined}
						/>
						<Html center distanceFactor={150} style={{ pointerEvents: 'none' }}>
							<div style={{
								background: 'rgba(0,0,0,0.75)', color: '#33cccc', padding: '2px 6px',
								borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace',
							}}>
								Portal {pi} → Sec {portal.linkSection}
							</div>
						</Html>
					</group>
				);
			})}

			{portals.map((portal, pi) =>
				portal.boundaryLines.map((bl, li) => {
					const start: [number, number, number] = [bl.verts.x, portal.position.y + 0.5, bl.verts.y];
					const end: [number, number, number] = [bl.verts.z, portal.position.y + 0.5, bl.verts.w];
					const isSel = marker?.kind === 'boundaryLine' && marker.portalIndex === pi && marker.lineIndex === li;
					return (
						<group key={`bl-${pi}-${li}`}>
							<Line points={[start, end]} color={isSel ? '#ffaa33' : '#cc3333'} lineWidth={isSel ? 3 : 2} />
							<mesh
								position={[(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2]}
								onClick={onPickBoundaryLine ? (e) => { e.stopPropagation(); onPickBoundaryLine(pi, li); } : undefined}
							>
								<sphereGeometry args={[2, 6, 4]} />
								<meshBasicMaterial transparent opacity={0} />
							</mesh>
							{isSel && (
								<>
									<mesh position={start}>
										<sphereGeometry args={[1.5, 8, 6]} />
										<meshStandardMaterial color="#ff4444" emissive="#441111" emissiveIntensity={0.5} />
									</mesh>
									<mesh position={end}>
										<sphereGeometry args={[1.5, 8, 6]} />
										<meshStandardMaterial color="#4444ff" emissive="#111144" emissiveIntensity={0.5} />
									</mesh>
									<Html position={start} center distanceFactor={120} style={{ pointerEvents: 'none' }}>
										<div style={{ background: 'rgba(0,0,0,0.8)', color: '#ff6666', padding: '1px 4px', borderRadius: 3, fontSize: 9, fontFamily: 'monospace' }}>
											X={bl.verts.x.toFixed(1)} Y={bl.verts.y.toFixed(1)}
										</div>
									</Html>
									<Html position={end} center distanceFactor={120} style={{ pointerEvents: 'none' }}>
										<div style={{ background: 'rgba(0,0,0,0.8)', color: '#6666ff', padding: '1px 4px', borderRadius: 3, fontSize: 9, fontFamily: 'monospace' }}>
											Z={bl.verts.z.toFixed(1)} W={bl.verts.w.toFixed(1)}
										</div>
									</Html>
								</>
							)}
						</group>
					);
				}),
			)}

			{noGoLines.map((bl, li) => {
				const lineY = baseY + 0.5;
				const start: [number, number, number] = [bl.verts.x, lineY, bl.verts.y];
				const end: [number, number, number] = [bl.verts.z, lineY, bl.verts.w];
				const isSel = marker?.kind === 'noGoLine' && marker.lineIndex === li;
				return (
					<group key={`ng-${li}`}>
						<Line points={[start, end]} color={isSel ? '#ffaa33' : '#cc8833'} lineWidth={isSel ? 3 : 2} />
						<mesh
							position={[(start[0] + end[0]) / 2, lineY, (start[2] + end[2]) / 2]}
							onClick={onPickNoGoLine ? (e) => { e.stopPropagation(); onPickNoGoLine(li); } : undefined}
						>
							<sphereGeometry args={[2, 6, 4]} />
							<meshBasicMaterial transparent opacity={0} />
						</mesh>
					</group>
				);
			})}

			{portals.map((portal, pi) => {
				const target = accessor.sectionAt(root, portal.linkSection);
				if (!target) return null;
				const centre = accessor.centreOf(root, portal.linkSection, portal.position.y);
				if (!centre) return null;
				const from: [number, number, number] = [portal.position.x, portal.position.y + 1, portal.position.z];
				const to: [number, number, number] = [centre.x, centre.y + 1, centre.z];
				return (
					<Line key={`link-${pi}`} points={[from, to]} color="#33cccc" lineWidth={1} dashed dashSize={4} gapSize={3} />
				);
			})}
		</>
	);
}

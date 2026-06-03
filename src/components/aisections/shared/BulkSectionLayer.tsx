// BulkSectionLayer — yellow outlines + structural detail for every
// bulk member that ISN'T the inspector pick.
//
// The "leave portals on screen at all times" fix: bulk members render
// with `marker={null}` so structural geometry shows (portals, boundary
// lines, no-go lines) but no selected-sub-entity highlights — keeping
// the inspector's editing cues isolated to the one section the user
// is actually editing.
//
// V12 wires `previewModel` + `sectionYs` so the bulk previews track
// the in-flight drag; V4/V6 omits both and falls back to baseY = 0
// (legacy data has no resolved-Y map, matching the existing legacy
// detail-layer convention).
//
// `bulkSet` is the workspace bulk's string-key set (e.g. "section:5").
// We extract section indices here so callers don't have to know about
// the `kind:idx` encoding.

import { SelectionOverlay, type Corner } from './SelectionOverlay';
import { SectionDetail, type SectionDetailAccessor } from './SectionDetail';

/** Pick "section:idx" entries out of the bulk Set and return their
 *  numeric indices. */
function bulkSectionIndicesFromSet(bulkSet: ReadonlySet<string>): number[] {
	const out: number[] = [];
	for (const key of bulkSet) {
		const parts = key.split(':');
		if (parts[0] !== 'section') continue;
		const idx = Number(parts[1]);
		if (!Number.isFinite(idx)) continue;
		out.push(idx);
	}
	return out;
}

export function BulkSectionLayer<TSection, TRoot>({
	bulkSet,
	selectedSectionIndex,
	data,
	previewModel,
	dragKind,
	sections,
	cornersOf,
	accessor,
	root,
	sectionYs,
	color = '#ffd633',
}: {
	bulkSet: ReadonlySet<string>;
	selectedSectionIndex: number | null;
	/** Live source array — `data.sections` for V12, `legacy.sections`
	 *  for V4/V6. Read as the fallback when no preview is active. */
	data: { sections: readonly TSection[] };
	/** Live preview model. V12-only — V4/V6 passes undefined. When
	 *  set AND the in-flight drag is a `bulk` gesture, bulk member
	 *  outlines draw against the preview geometry so every member is
	 *  seen translating / rotating in lockstep. */
	previewModel?: { sections: readonly TSection[] } | null;
	/** Drag kind discriminator — only used to gate which array bulk
	 *  outlines read from. V12 passes 'bulk' during a bulk gesture;
	 *  anything else falls back to `data`. V4/V6 always undefined. */
	dragKind?: string | null;
	/** Section array convenience pointer (same as `data.sections`,
	 *  exposed so SectionDetail can read it as root context). */
	sections: readonly TSection[];
	cornersOf: (section: TSection) => Corner[];
	accessor: SectionDetailAccessor<TSection, TRoot>;
	/** Root model passed to SectionDetail (V12: `data`, V4/V6: `legacy`). */
	root: TRoot;
	/** Optional per-section ground Y; V4/V6 omits. */
	sectionYs?: ArrayLike<number>;
	/** Outline tint. Defaults to the "bulk member" yellow. */
	color?: string;
}) {
	const indices = bulkSectionIndicesFromSet(bulkSet);
	if (indices.length === 0) return null;
	const dragIsBulk = dragKind === 'bulk';
	return (
		<>
			{/* Outline loop — yellow SelectionOverlay per member. */}
			{indices.map((idx) => {
				if (idx === selectedSectionIndex) return null;
				const liveSec = dragIsBulk && previewModel
					? previewModel.sections[idx]
					: data.sections[idx];
				if (!liveSec) return null;
				const corners = cornersOf(liveSec);
				const y = sectionYs && idx < sectionYs.length ? sectionYs[idx] : 0;
				return (
					<SelectionOverlay
						key={`bulk-${idx}`}
						corners={corners}
						color={color}
						baseY={y}
					/>
				);
			})}
			{/* Detail loop — portals + boundary lines + no-go lines, no
			    sub-entity highlights (marker=null). Always reads from
			    `data` (not preview) since the detail layer doesn't track
			    preview portals — matches the pre-extraction behaviour. */}
			{indices.map((idx) => {
				if (idx === selectedSectionIndex) return null;
				const sec = data.sections[idx];
				if (!sec) return null;
				const y = sectionYs && idx < sectionYs.length ? sectionYs[idx] : 0;
				return (
					<SectionDetail
						key={`bulk-detail-${idx}`}
						section={sec}
						root={root}
						accessor={accessor}
						marker={null}
						baseY={y}
					/>
				);
			})}
		</>
	);
}

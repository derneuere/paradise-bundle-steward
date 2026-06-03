// HoverSectionLayer — blue outline + grey label for the section under the
// cursor.
//
// Wraps `SelectionOverlay` (blue) and `SectionLabel` (grey) in one
// component so the V12 / V4/V6 overlays can express "the hovered section"
// as a single JSX element. The caller is responsible for the "hover !==
// selected" gate (cheaper than passing a `selectedIndex` prop just to
// shortcut inside this component).

import type { ReactNode } from 'react';
import { SelectionOverlay, type Corner } from './SelectionOverlay';
import { SectionLabel } from './SectionLabel';

export function HoverSectionLayer({
	corners,
	baseY = 0,
	labelText,
}: {
	corners: readonly Corner[];
	baseY?: number;
	labelText?: ReactNode;
}) {
	return (
		<>
			<SelectionOverlay corners={corners} color="#66aaff" baseY={baseY} />
			{labelText != null && corners.length >= 4 && (
				<SectionLabel corners={corners} color="#aaaaaa" baseY={baseY}>
					{labelText}
				</SectionLabel>
			)}
		</>
	);
}

// Per-row Visibility controls on the Workspace tree: the eye toggle plus a
// "solo" button that shows only this node and hides its peers in the same
// Bundle (e.g. one TRK_COL out of WORLDCOL's 428). A second solo click
// restores every peer. Alt+click on the eye does the same, but nobody finds
// an alt-gesture, so solo also gets its own button.
//
// The solo button only appears on row hover, so rows need the `group` class.

import React, { useCallback } from 'react';
import { Eye, EyeOff, Focus } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { VisibilityNode } from '@/context/WorkspaceContext.types';

const BUTTON_CLASS =
	'shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground';

export function VisibilityControls({
	node,
	label,
}: {
	node: VisibilityNode;
	label: string;
}) {
	const { isVisible, setVisibility, soloVisibility } = useWorkspace();
	const visible = isVisible(node);

	const onToggle = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			if (e.altKey) {
				soloVisibility(node);
				return;
			}
			setVisibility(node, !visible);
		},
		[node, visible, setVisibility, soloVisibility],
	);

	const onSolo = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			soloVisibility(node);
		},
		[node, soloVisibility],
	);

	return (
		<>
			<button
				type="button"
				onClick={onSolo}
				className={`${BUTTON_CLASS} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
				title={`Show only ${label} (hide the rest) — click again to show all`}
				aria-label={`Show only ${label}`}
			>
				<Focus className="h-3 w-3" />
			</button>
			<button
				type="button"
				onClick={onToggle}
				className={BUTTON_CLASS}
				title={`${visible ? `Hide ${label}` : `Show ${label}`} — alt+click to show only this`}
				aria-label={visible ? `Hide ${label}` : `Show ${label}`}
				aria-pressed={visible}
			>
				{visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 opacity-60" />}
			</button>
		</>
	);
}

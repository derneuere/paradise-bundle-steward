// Belt-and-braces guard: clear the Workspace selection if the bundle it
// pointed at is no longer loaded. The provider's closeBundle / replace
// paths already drop the selection before they remove the bundle, so
// this should be a no-op in normal flows. It catches the case where a
// downstream caller drops a bundle without going through those paths
// — preventing the inspector / viewport from reading off stale state.

import { useEffect } from 'react';
import type { EditableBundle, WorkspaceSelection } from '@/context/WorkspaceContext.types';

export function useDropStaleSelection(
	bundles: readonly EditableBundle[],
	selection: WorkspaceSelection,
	select: (next: WorkspaceSelection) => void,
): void {
	useEffect(() => {
		if (selection && !bundles.some((b) => b.id === selection.bundleId)) {
			select(null);
		}
	}, [bundles, selection, select]);
}

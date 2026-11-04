// Spec for the tree-row Visibility controls: every row with an eye toggle
// also offers a visible "show only this" (solo) button, so isolating one
// TRK_COL out of WORLDCOL doesn't depend on discovering alt+click. The solo
// semantics themselves are pinned in context/__tests__/WorkspaceContext.solo.

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VisibilityControls } from '../VisibilityControls';

const workspace = { visible: true };
vi.mock('@/context/WorkspaceContext', () => ({
	useWorkspace: () => ({
		isVisible: () => workspace.visible,
		setVisibility: () => {},
		soloVisibility: () => {},
	}),
}));

const node = { bundleId: 'WORLDCOL.BIN', resourceKey: 'polygonSoupList', index: 7 };

describe('VisibilityControls', () => {
	it('renders a solo button next to the eye toggle', () => {
		const html = renderToStaticMarkup(<VisibilityControls node={node} label="polygonSoupList #7" />);
		expect(html).toContain('aria-label="Show only polygonSoupList #7"');
		expect(html).toContain('aria-label="Hide polygonSoupList #7"');
	});

	it('keeps the solo button reachable while the node itself is hidden', () => {
		workspace.visible = false;
		const html = renderToStaticMarkup(<VisibilityControls node={node} label="polygonSoupList #7" />);
		expect(html).toContain('aria-label="Show only polygonSoupList #7"');
		expect(html).toContain('aria-label="Show polygonSoupList #7"');
		workspace.visible = true;
	});
});

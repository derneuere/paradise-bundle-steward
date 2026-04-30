// ⌘Z / ⌘⇧Z / ⌘Y → Workspace undo / redo.
//
// Mounted at the editor page level (per ADR-0006: ⌘Z undoes the most recent
// edit anywhere in the Workspace, regardless of which Bundle or which
// resource it touched). The WorkspaceEditor page calls this once; the
// legacy single-Bundle SchemaEditor pages call it too so their shortcut
// still flows into the same global stack.
//
// Why a dedicated hook (vs. inline in UndoRedoControls): the buttons and
// the keyboard binding have different lifetimes — pages without a visible
// undo button still want the shortcut, and a page that mounts the buttons
// in two places (header + sidebar) shouldn't double-fire. The hook is the
// canonical place to register the listener.

import { useEffect } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';

// Skip when the user is editing rich text (contentEditable). For plain
// `<input>` / `<textarea>` we still override Ctrl+Z because every keystroke
// commits into the model — model-level undo IS the input's logical undo,
// no double-undo problem.
function isInRichTextEditor(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	return !!el?.isContentEditable;
}

export function useWorkspaceUndoRedoShortcuts(): void {
	const { undo, redo } = useWorkspace();

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (isInRichTextEditor(e.target)) return;
			const ctrlOrCmd = e.ctrlKey || e.metaKey;
			if (!ctrlOrCmd) return;

			const k = e.key.toLowerCase();
			if (k === 'z' && !e.shiftKey) {
				e.preventDefault();
				undo();
			} else if (k === 'y' || (k === 'z' && e.shiftKey)) {
				e.preventDefault();
				redo();
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [undo, redo]);
}

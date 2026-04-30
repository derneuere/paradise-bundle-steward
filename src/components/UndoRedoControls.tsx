// Undo/redo controls for the Workspace.
//
// Pages mount this once near their toolbar. Per ADR-0006 the Workspace has
// a single global undo stack — ⌘Z always undoes the most recent edit
// anywhere in the Workspace. The component still accepts a `resourceKey`
// for placement context (the SchemaEditor mounts it next to the active
// resource's hierarchy header), but it no longer scopes the stack to that
// key.

import React, { useEffect } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { useWorkspace } from '@/context/WorkspaceContext';

type Props = {
	/**
	 * Optional placement context — present so call sites that pass it (the
	 * schema editor mounts it as `resourceKey={resource.key}`) keep
	 * compiling. The Workspace stack is global, so the value is unused.
	 */
	resourceKey?: string;
	/** Optional className applied to the wrapping `<div>`. */
	className?: string;
};

// Detecting whether to skip our keyboard handler when the user is editing
// rich text (contentEditable). For normal `<input>` / `<textarea>` we still
// override Ctrl+Z because the schema editor commits every keystroke into
// the model — so model-level undo IS the input's logical undo, no double-
// undo problem.
function isInRichTextEditor(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	return !!el?.isContentEditable;
}

export const UndoRedoControls: React.FC<Props> = ({ className }) => {
	const { undo, redo, canUndo, canRedo } = useWorkspace();

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

	return (
		<TooltipProvider delayDuration={300}>
			<div className={`flex items-center gap-1 ${className ?? ''}`}>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="outline"
							size="icon"
							className="h-8 w-8"
							disabled={!canUndo}
							onClick={() => undo()}
							aria-label="Undo"
						>
							<Undo2 className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom" className="text-xs">
						Undo (Ctrl+Z)
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="outline"
							size="icon"
							className="h-8 w-8"
							disabled={!canRedo}
							onClick={() => redo()}
							aria-label="Redo"
						>
							<Redo2 className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom" className="text-xs">
						Redo (Ctrl+Y)
					</TooltipContent>
				</Tooltip>
			</div>
		</TooltipProvider>
	);
};

// Undo/redo controls for a single resource.
//
// Pages mount this once near their toolbar. It renders two icon buttons that
// reflect the current per-resource history state (disabled when the relevant
// stack is empty) and registers global Ctrl+Z / Ctrl+Y / Cmd+Z keyboard
// listeners scoped to the same (resourceKey, index) pair.
//
// Why a single component instead of separate buttons + hook: every page that
// uses model-level undo needs both halves, and putting them together keeps
// the wiring identical across pages — drop in `<UndoRedoControls />` and you
// get matching UI + shortcut behavior.

import React, { useEffect } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { useBundle } from '@/context/BundleContext';

type Props = {
	/** Handler key for the resource whose history to drive (e.g. 'aiSections'). */
	resourceKey: string;
	/** Defaults to 0 — the common case for single-resource bundles. */
	index?: number;
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

export const UndoRedoControls: React.FC<Props> = ({ resourceKey, index = 0, className }) => {
	const { undo, redo, canUndo, canRedo } = useBundle();
	const undoEnabled = canUndo(resourceKey, index);
	const redoEnabled = canRedo(resourceKey, index);

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (isInRichTextEditor(e.target)) return;
			const ctrlOrCmd = e.ctrlKey || e.metaKey;
			if (!ctrlOrCmd) return;

			const k = e.key.toLowerCase();
			if (k === 'z' && !e.shiftKey) {
				e.preventDefault();
				undo(resourceKey, index);
			} else if (k === 'y' || (k === 'z' && e.shiftKey)) {
				e.preventDefault();
				redo(resourceKey, index);
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [resourceKey, index, undo, redo]);

	return (
		<TooltipProvider delayDuration={300}>
			<div className={`flex items-center gap-1 ${className ?? ''}`}>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="outline"
							size="icon"
							className="h-8 w-8"
							disabled={!undoEnabled}
							onClick={() => undo(resourceKey, index)}
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
							disabled={!redoEnabled}
							onClick={() => redo(resourceKey, index)}
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

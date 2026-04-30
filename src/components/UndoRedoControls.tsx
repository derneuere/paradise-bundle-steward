// Undo/redo buttons for the Workspace.
//
// Per ADR-0006 the Workspace has a single global undo stack — ⌘Z always
// undoes the most recent edit anywhere in the Workspace. The buttons here
// just dispatch into that stack and reflect `canUndo` / `canRedo`.
//
// The keyboard binding (⌘Z / ⌘⇧Z / ⌘Y) is owned by the page, not the
// buttons — see `useWorkspaceUndoRedoShortcuts`. Pages can mount the
// buttons zero or many times without changing the shortcut behaviour.

import React from 'react';
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

export const UndoRedoControls: React.FC<Props> = ({ className }) => {
	const { undo, redo, canUndo, canRedo } = useWorkspace();

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

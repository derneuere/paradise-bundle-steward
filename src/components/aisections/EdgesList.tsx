// Edges sub-panel for the AISection inspector.
//
// Edges aren't a stored field — they're derived from the corners list. We
// render one row per implicit edge so the user has a stable surface to
// right-click on and trigger the "Duplicate section through this edge"
// operation that pairs up portals automatically.
//
// Pure UI. The geometry / portal-wiring lives in
// `@/lib/core/aiSectionsOps.duplicateSectionThroughEdge`.

import React, { useState } from 'react';
import { ArrowRight, Copy, MoreHorizontal, Trash2 } from 'lucide-react';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { AISection, ParsedAISectionsV12, Vector2 } from '@/lib/core/aiSections';
import { deleteSection, duplicateSectionThroughEdge } from '@/lib/core/aiSectionsOps';
import { useSchemaEditor } from '@/components/schema-editor/context';

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : '?');
const fmtPoint = (p: Vector2) => `(${fmt(p.x)}, ${fmt(p.y)})`;

type Props = {
	section: AISection;
	srcIdx: number;
	model: ParsedAISectionsV12;
};

export const EdgesList: React.FC<Props> = ({ section, srcIdx, model }) => {
	const { setAtPath, selectPath } = useSchemaEditor();
	const [confirmDelete, setConfirmDelete] = useState(false);
	const corners = section.corners ?? [];
	const N = corners.length;

	const handleDuplicate = (edgeIdx: number) => {
		const next = duplicateSectionThroughEdge(model, srcIdx, edgeIdx);
		// Replace the entire resource root — simpler than diffing and matches
		// the pattern used by AISectionsListExtension.
		setAtPath([], next);
		// Auto-select the new section so the user can immediately drag corners.
		const dupIdx = next.sections.length - 1;
		requestAnimationFrame(() => {
			selectPath(['sections', dupIdx]);
		});
	};

	const handleDelete = () => {
		const next = deleteSection(model, srcIdx);
		setAtPath([], next);
		// Selection now points at a section that no longer exists. Move the
		// selection to a sensible neighbour: same index (which now holds what
		// used to be the next section), or back to the section list when we
		// just deleted the last one.
		requestAnimationFrame(() => {
			if (next.sections.length === 0) {
				selectPath(['sections']);
			} else {
				const newIdx = Math.min(srcIdx, next.sections.length - 1);
				selectPath(['sections', newIdx]);
			}
		});
		setConfirmDelete(false);
	};

	// Pre-compute side-effects so the confirm dialog can show what will go.
	const orphanedPortalCount = model.sections.reduce((acc, s, i) => {
		if (i === srcIdx) return acc;
		return acc + s.portals.filter((p) => p.linkSection === srcIdx).length;
	}, 0);
	const affectedResetPairs = model.sectionResetPairs.filter(
		(rp) => rp.startSectionIndex === srcIdx || rp.resetSectionIndex === srcIdx,
	).length;

	if (N < 2) {
		return (
			<div className="text-xs text-muted-foreground">
				This section has fewer than 2 corners — no edges to display.
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<div className="text-[11px] text-muted-foreground">
				Edges are derived from the corners list. Right-click an edge to
				duplicate this section through it — the editor will append a new
				section translated perpendicular to the chosen edge and wire up a
				mirrored portal pair (same Position, reversed boundary winding).
			</div>
			<ul className="space-y-1">
				{corners.map((_, edgeIdx) => {
					const A = corners[edgeIdx];
					const B = corners[(edgeIdx + 1) % N];
					return (
						<ContextMenu key={edgeIdx}>
							<ContextMenuTrigger asChild>
								<li
									className="flex items-center gap-2 rounded border border-border/60 bg-card/40 px-2 py-1.5 text-xs hover:bg-accent/40 cursor-context-menu select-none"
									title="Right-click for actions"
								>
									<span className="font-mono text-muted-foreground w-12 shrink-0">Edge {edgeIdx}</span>
									<span className="font-mono">{fmtPoint(A)}</span>
									<ArrowRight className="h-3 w-3 text-muted-foreground" />
									<span className="font-mono">{fmtPoint(B)}</span>
									<div className="ml-auto flex items-center">
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button
													variant="ghost"
													size="icon"
													className="h-6 w-6"
													aria-label={`Edge ${edgeIdx} actions`}
												>
													<MoreHorizontal className="h-3.5 w-3.5" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onSelect={() => handleDuplicate(edgeIdx)}>
													<Copy className="h-3.5 w-3.5 mr-2" />
													Duplicate section through this edge
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</li>
							</ContextMenuTrigger>
							<ContextMenuContent>
								<ContextMenuItem onSelect={() => handleDuplicate(edgeIdx)}>
									<Copy className="h-3.5 w-3.5 mr-2" />
									Duplicate section through this edge
								</ContextMenuItem>
							</ContextMenuContent>
						</ContextMenu>
					);
				})}
			</ul>

			<div className="mt-4 pt-3 border-t border-border/40">
				<div className="flex items-center justify-between">
					<div>
						<div className="text-xs font-medium">Delete this section</div>
						<div className="text-[11px] text-muted-foreground">
							Removes section #{srcIdx} and rewires every cross-reference so the
							model stays consistent.
						</div>
					</div>
					<Button
						variant="destructive"
						size="sm"
						className="h-7"
						onClick={() => setConfirmDelete(true)}
					>
						<Trash2 className="h-3.5 w-3.5 mr-1.5" />
						Delete
					</Button>
				</div>
			</div>

			<AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete section #{srcIdx}?</AlertDialogTitle>
						<AlertDialogDescription asChild>
							<div className="space-y-2">
								<p>
									This will remove the section permanently. To keep the model
									consistent, the editor will also:
								</p>
								<ul className="list-disc list-inside text-xs space-y-0.5">
									<li>
										Drop {orphanedPortalCount} portal
										{orphanedPortalCount === 1 ? '' : 's'} on other sections
										that link to this one.
									</li>
									<li>
										Drop {affectedResetPairs} section-reset pair
										{affectedResetPairs === 1 ? '' : 's'} that reference this
										section.
									</li>
									<li>
										Decrement every remaining <code>linkSection</code> /
										reset-pair index above {srcIdx} by one so neighbours keep
										pointing at the same logical sections.
									</li>
								</ul>
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete section
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
};

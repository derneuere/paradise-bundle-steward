// Pre-export validation dialog for bundles that contain AI Sections.
//
// Surfaces unresolved portals (linkSection out of range) before the bundle
// hits the writer. Non-blocking — user can dismiss and proceed.
//
// Domain note: empirical baseline against unmodified retail (example/AI.DAT
// and example/ps3/AI.DAT) shows 0 unresolved portals, so the count the user
// sees here is genuinely from their edits / imports, not pre-existing data.
// The dialog wording still hedges in case future fixtures introduce some.

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import type { UnresolvedPortal } from '@/lib/core/aiSectionsValidate';

type Props = {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	unresolvedPortals: readonly UnresolvedPortal[];
	bundleId: string;
	aiSectionsIndex: number | null;
	onContinue: () => void;
	onNavigateToPortal?: (sectionIdx: number, portalIdx: number) => void;
};

export function BundleExportValidationDialog({
	open,
	onOpenChange,
	unresolvedPortals,
	bundleId,
	aiSectionsIndex,
	onContinue,
	onNavigateToPortal,
}: Props) {
	const sectionsAffected = new Set(unresolvedPortals.map((u) => u.sectionIdx)).size;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<AlertTriangle className="w-5 h-5 text-amber-500" />
						Unresolved boundary portals
					</DialogTitle>
					<DialogDescription>
						{unresolvedPortals.length} unresolved portal{unresolvedPortals.length === 1 ? '' : 's'} across {sectionsAffected} section{sectionsAffected === 1 ? '' : 's'} in <strong>{bundleId}</strong>.
					</DialogDescription>
				</DialogHeader>
				<div className="text-sm text-muted-foreground space-y-2">
					<p>
						These portals have <code>linkSection = -1</code> or out-of-range, and likely came from a recent bulk import where the source links pointed outside the bulk. The game treats these as boundaries; review them before shipping.
					</p>
				</div>
				<div className="rounded-md border bg-muted/20 p-3 max-h-64 overflow-auto">
					<table className="w-full text-xs">
						<thead className="text-muted-foreground">
							<tr>
								<th className="text-left font-normal pb-1">Section</th>
								<th className="text-left font-normal pb-1">Portal</th>
								<th className="text-left font-normal pb-1">linkSection</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{unresolvedPortals.slice(0, 100).map((u, i) => (
								<tr key={i} className="font-mono">
									<td className="py-0.5">#{u.sectionIdx}</td>
									<td className="py-0.5">#{u.portalIdx}</td>
									<td className="py-0.5">{u.linkSection}</td>
									<td className="py-0.5 text-right">
										{onNavigateToPortal && aiSectionsIndex != null && (
											<button
												type="button"
												className="text-[11px] text-blue-600 hover:underline"
												onClick={() => onNavigateToPortal(u.sectionIdx, u.portalIdx)}
											>
												Inspect
											</button>
										)}
									</td>
								</tr>
							))}
							{unresolvedPortals.length > 100 && (
								<tr>
									<td colSpan={4} className="text-muted-foreground italic pt-1">
										… +{unresolvedPortals.length - 100} more
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={onContinue}>
						Continue with export
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

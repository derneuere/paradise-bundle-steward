// Same-name re-load prompt. Surfaced when `loadBundle` parses a file whose
// filename matches a Bundle already in the Workspace. CONTEXT.md /
// "Bundle filename" forbids two Bundles with the same id from coexisting,
// so the only options are Replace (swap the bytes, drop bookkeeping for
// the old id) and Cancel (discard the candidate).
//
// Why no "Add as duplicate": the game references files by exact filename
// at runtime — keeping a duplicate would either rename the file (breaking
// the game's lookup) or hold two Bundles that map to the same on-disk
// path (one would be silently shadowed on save).

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
import { AlertTriangle } from 'lucide-react';

type Props = {
	bundleId: string | null;
	open: boolean;
	onDecision: (replaced: boolean) => void;
};

export const ReplaceBundleDialog = ({ bundleId, open, onDecision }: Props) => {
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				// Radix fires onOpenChange with `false` when the user dismisses
				// the dialog (Esc, click outside, X). Treat that as Cancel.
				if (!next) onDecision(false);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<AlertTriangle className="w-5 h-5 text-amber-500" />
						Replace bundle?
					</AlertDialogTitle>
					<AlertDialogDescription>
						A bundle named <strong>{bundleId ?? ''}</strong> is already loaded
						in this workspace. Replacing it will swap in the newly-picked
						file's bytes and drop any selection or undo history that pointed
						at it. Edits made to the previous bundle will be lost.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={() => onDecision(false)}>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction onClick={() => onDecision(true)}>
						Replace
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};

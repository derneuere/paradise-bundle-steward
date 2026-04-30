// Dirty-close prompt. Surfaced when `closeBundle` is called on a Bundle
// whose `isModified === true`. Closing discards the in-memory edits — the
// only way to keep them is to Save Bundle (download) before closing.

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
	onDecision: (confirmed: boolean) => void;
};

export const CloseBundleDialog = ({ bundleId, open, onDecision }: Props) => {
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onDecision(false);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<AlertTriangle className="w-5 h-5 text-amber-500" />
						Close unsaved bundle?
					</AlertDialogTitle>
					<AlertDialogDescription>
						<strong>{bundleId ?? ''}</strong> has unsaved edits. Closing it
						drops those edits — the bundle's bytes on disk are untouched, but
						everything in this session goes away. Save the bundle first if
						you want to keep the changes.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={() => onDecision(false)}>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction onClick={() => onDecision(true)}>
						Close without saving
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};

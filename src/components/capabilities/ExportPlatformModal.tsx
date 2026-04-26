// Modal that lets the user pick a target platform when the loaded bundle
// can be safely exported as more than one (LE↔BE conversion).
//
// Shown only when `getExportablePlatforms(bundle).length > 1` — bundles whose
// resources include a PC-only handler fall through to the existing direct-
// export path without seeing this dialog.

import { useState } from 'react';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AlertTriangle } from 'lucide-react';
import { getPlatformName } from '@/lib/core/bundle';

type ExportPlatformModalProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	platforms: number[];
	sourcePlatform: number;
	onConfirm: (targetPlatform: number) => void;
};

export const ExportPlatformModal = ({
	open,
	onOpenChange,
	platforms,
	sourcePlatform,
	onConfirm,
}: ExportPlatformModalProps) => {
	const [selected, setSelected] = useState<number>(sourcePlatform);

	const handleConfirm = () => {
		onConfirm(selected);
		onOpenChange(false);
	};

	const isCrossPlatform = selected !== sourcePlatform;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (next) setSelected(sourcePlatform);
				onOpenChange(next);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Export bundle as…</DialogTitle>
					<DialogDescription>
						This bundle's resources can be re-encoded for more than one platform.
						Pick the target binary layout. The source platform is selected by default.
					</DialogDescription>
				</DialogHeader>

				<RadioGroup
					value={String(selected)}
					onValueChange={(v) => setSelected(Number(v))}
					className="py-2"
				>
					{platforms.map((p) => {
						const id = `export-platform-${p}`;
						const isSource = p === sourcePlatform;
						return (
							<div key={p} className="flex items-center gap-3">
								<RadioGroupItem id={id} value={String(p)} />
								<Label htmlFor={id} className="cursor-pointer font-normal">
									{getPlatformName(p)}
									{isSource && (
										<span className="ml-2 text-xs text-muted-foreground">(source)</span>
									)}
								</Label>
							</div>
						);
					})}
				</RadioGroup>

				{isCrossPlatform && (
					<div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
						<AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-500" />
						<div>
							<div className="font-medium">Experimental cross-platform export</div>
							<div className="text-muted-foreground">
								Self-consistency is verified by tests, but the converted bundle
								has not been validated against the actual game. Treat as a
								technical preview.
							</div>
						</div>
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleConfirm}>Export</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

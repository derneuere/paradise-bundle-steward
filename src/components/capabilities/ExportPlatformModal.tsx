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

export type ExportContainerInfo = {
	/** 'bnd2' for retail Bundle 2 ('bnd2' magic) sources, 'bnd1' for the
	 *  Bundle V1 ('bndl' magic) prototype container used in pre-release
	 *  Burnout 5 dev builds. */
	kind: 'bnd1' | 'bnd2';
	/** Bundle wrapper version. 2 for bnd2; 5 for the Feb 22 2007 bnd1 fixture
	 *  (we don't yet support v3 / v4). */
	version: number;
};

type ExportPlatformModalProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	platforms: number[];
	sourcePlatform: number;
	onConfirm: (targetPlatform: number) => void;
	/** Source bundle's container — surfaced so the user knows whether their
	 *  output will stay as 'bndl' (BND1 prototype) or 'bnd2' (retail). The
	 *  current export path always preserves the source container; we only
	 *  flip endianness on cross-platform export. */
	sourceContainer: ExportContainerInfo;
};

export const ExportPlatformModal = ({
	open,
	onOpenChange,
	platforms,
	sourcePlatform,
	onConfirm,
	sourceContainer,
}: ExportPlatformModalProps) => {
	const [selected, setSelected] = useState<number>(sourcePlatform);

	const handleConfirm = () => {
		onConfirm(selected);
		onOpenChange(false);
	};

	const isCrossPlatform = selected !== sourcePlatform;
	const containerLabel =
		sourceContainer.kind === 'bnd1'
			? `Bundle V1 ('bndl' v${sourceContainer.version})`
			: `Bundle 2 ('bnd2' v${sourceContainer.version})`;
	const containerSubtitle =
		sourceContainer.kind === 'bnd1'
			? 'Prototype-build container — kept on export.'
			: 'Retail container — kept on export.';

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

				{/* Container context: which wrapper format the output will use.
				    Always shown so the user can confirm at a glance whether
				    they're getting a BND1 or BND2 bundle back. */}
				<div className="rounded-md border bg-muted/30 p-3 text-sm">
					<div className="text-xs uppercase tracking-wider text-muted-foreground">
						Container
					</div>
					<div className="font-mono">{containerLabel}</div>
					<div className="text-xs text-muted-foreground mt-1">{containerSubtitle}</div>
				</div>

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
								{sourceContainer.kind === 'bnd1' && (
									<>
										{' '}For BND1 sources the cross-platform path runs through
										the convert helper; in-app edits to BND1 resources are
										<em> not yet</em> merged with the converted bytes (same-
										platform export does pick them up). Pick the source
										platform to keep your edits.
									</>
								)}
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

// Banner shown at the top of the inspector when the selected resource
// has conversion provenance attached (issue #38).
//
// Source of truth: WorkspaceContext's provenance map, written to by the
// "Export to game version..." dialog after each successful export.
// Mounting decision: render only when the selection is at instance /
// schema level AND `getConversionProvenance` returns non-null.
//
// Visual hierarchy: defaulted entries are muted (informational) and
// lossy entries get an amber accent (the "review this guess" cases).
// Both lists collapse cleanly when empty so a defaulted-only or
// lossy-only migration still produces a coherent banner.

import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	formatBannerHeading,
	type ConversionProvenance,
} from './conversionProvenanceBanner.helpers';

type Props = {
	provenance: ConversionProvenance;
	onDismiss: () => void;
};

export function ConversionProvenanceBanner({ provenance, onDismiss }: Props) {
	const heading = formatBannerHeading(provenance);
	const hasDefaulted = provenance.defaulted.length > 0;
	const hasLossy = provenance.lossy.length > 0;

	return (
		<div
			role="status"
			aria-label="Conversion provenance"
			className="border-b bg-amber-500/5 px-4 py-3 text-xs"
			data-testid="conversion-provenance-banner"
		>
			<div className="flex items-start gap-2">
				<AlertTriangle
					className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0"
					aria-hidden="true"
				/>
				<div className="flex-1 min-w-0 space-y-1.5">
					<div className="font-medium text-foreground">{heading}</div>
					{hasDefaulted && (
						<div className="text-muted-foreground">
							<span className="font-medium">defaulted:</span>{' '}
							<span
								className="font-mono break-all"
								data-testid="provenance-defaulted-list"
							>
								{provenance.defaulted.join(', ')}
							</span>
						</div>
					)}
					{hasLossy && (
						<div className="text-amber-700 dark:text-amber-400">
							<span className="font-medium">Interpreted:</span>{' '}
							<span
								className="font-mono break-all"
								data-testid="provenance-lossy-list"
							>
								{provenance.lossy.join(', ')}
							</span>
						</div>
					)}
				</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={onDismiss}
					aria-label="Dismiss conversion provenance banner"
					className="h-6 px-1.5 text-[11px] gap-1 shrink-0"
				>
					<X className="h-3 w-3" />
					Dismiss
				</Button>
			</div>
		</div>
	);
}

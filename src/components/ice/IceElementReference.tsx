// Read-only reference viewer for the ICE element-descriptions table.
//
// The 48 element descriptions are a per-build static schedule, not bundle data:
// they're what the take editor uses to decode and present each keyframe value
// with the right control (channel, data type, bit width, range, token labels).
// Because the table isn't stored in any bundle there is nothing to load or
// save and nothing to edit — this component only displays it, grouped by
// channel, so someone editing a take can consult the schedule.
//
// Presentational + derived: it computes rows once from the static table via
// useMemo and renders them. No props, no effects, no data fetching.

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import {
	buildIceElementReferenceRows,
	groupReferenceRowsByChannel,
	type IceElementReferenceRow,
} from './iceElementReferenceModel';

export function IceElementReference() {
	const groups = useMemo(
		() => groupReferenceRowsByChannel(buildIceElementReferenceRows()),
		[],
	);

	return (
		<div className="space-y-3">
			<p className="text-xs text-muted-foreground">
				The static per-build element schedule used to decode and edit take
				channels. It defines each element's channel, data type, bit width,
				default/min/max, and token labels. This table is not part of the bundle,
				so it is read-only — there is nothing to load or save.
			</p>
			{groups.map((group) => (
				<div key={group.channel} className="rounded-md border border-border">
					<div className="flex items-center justify-between px-3 py-2 text-sm font-medium">
						<span>{group.name}</span>
						<Badge variant="secondary" className="text-[10px]">
							channel {group.channel}
						</Badge>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full border-t border-border text-left text-xs">
							<thead className="text-muted-foreground">
								<tr>
									<Th>#</Th>
									<Th>Tag</Th>
									<Th>Name</Th>
									<Th>Kind</Th>
									<Th>Type</Th>
									<Th className="text-right">Bits</Th>
									<Th className="text-right">Default</Th>
									<Th className="text-right">Min</Th>
									<Th className="text-right">Max</Th>
									<Th>Tokens</Th>
								</tr>
							</thead>
							<tbody>
								{group.rows.map((row) => (
									<ReferenceRow key={row.index} row={row} />
								))}
							</tbody>
						</table>
					</div>
				</div>
			))}
		</div>
	);
}

function ReferenceRow({ row }: { row: IceElementReferenceRow }) {
	return (
		<tr className="border-t border-border/60 align-top">
			<Td className="text-muted-foreground">{row.index}</Td>
			<Td className="font-mono">{row.tag}</Td>
			<Td>{row.displayName}</Td>
			<Td>
				<Badge variant="outline" className="text-[9px] uppercase tracking-wide">
					{row.isKey ? 'key' : 'interval'}
				</Badge>
			</Td>
			<Td className="font-mono">{row.dataTypeName}</Td>
			<Td className="text-right tabular-nums">{row.dataBits}</Td>
			<Td className="text-right font-mono tabular-nums">{row.defaultText}</Td>
			<Td className="text-right font-mono tabular-nums">{row.minText}</Td>
			<Td className="text-right font-mono tabular-nums">{row.maxText}</Td>
			<Td className="text-muted-foreground">
				{row.tokens.length > 0 ? row.tokens.join(', ') : '—'}
			</Td>
		</tr>
	);
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
	return <th className={`px-2 py-1 font-medium ${className ?? ''}`}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
	return <td className={`px-2 py-1 ${className ?? ''}`}>{children}</td>;
}

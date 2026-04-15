// StreetData overview — plain summary card showing version + collection counts.
//
// Previously lived inline inside StreetDataEditor.tsx together with a "Show 3D"
// toggle. The schema editor always shows the viewport in its center pane, so
// the toggle has been dropped; what's left is a pure read-only summary.

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ParsedStreetData } from '@/lib/core/streetData';

type Props = {
	data: ParsedStreetData;
	onChange: (next: ParsedStreetData) => void;
};

export const OverviewTab: React.FC<Props> = ({ data }) => {
	const summary = useMemo(
		() => ({
			version: data.miVersion,
			streets: data.streets.length,
			junctions: data.junctions.length,
			roads: data.roads.length,
			challenges: data.challenges.length,
		}),
		[data],
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Street Data Overview</CardTitle>
			</CardHeader>
			<CardContent className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
				<div>Version: <b>{summary.version}</b></div>
				<div>Streets: <b>{summary.streets}</b></div>
				<div>Junctions: <b>{summary.junctions}</b></div>
				<div>Roads: <b>{summary.roads}</b></div>
				<div>Challenges: <b>{summary.challenges}</b></div>
			</CardContent>
		</Card>
	);
};

export default OverviewTab;

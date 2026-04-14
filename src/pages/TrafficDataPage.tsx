import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { TrafficDataEditor } from '@/components/trafficdata/TrafficDataEditor';
import type { ParsedTrafficData } from '@/lib/core/trafficData';

const TrafficDataPage = () => {
	const { getResource, setResource } = useBundle();
	const data = getResource<ParsedTrafficData>('trafficData');

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle>Traffic Data</CardTitle>
				</CardHeader>
				<CardContent>
					{data ? (
						<TrafficDataEditor data={data} onChange={(next) => setResource('trafficData', next)} />
					) : (
						<div className="text-sm text-muted-foreground">Load a bundle containing traffic data to begin.</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
};

export default TrafficDataPage;

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
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
					<Button asChild variant="outline" size="sm">
						<Link to="/trafficData-v2">
							<FlaskConical className="w-4 h-4 mr-1" /> Try Schema Editor
						</Link>
					</Button>
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

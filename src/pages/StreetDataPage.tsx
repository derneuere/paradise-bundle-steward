import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { StreetDataEditor } from '@/components/streetdata/StreetDataEditor';
import type { ParsedStreetData } from '@/lib/core/streetData';

const StreetDataPage = () => {
	const { getResource, setResource } = useBundle();
	const streetData = getResource<ParsedStreetData>('streetData');

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle>Street Data</CardTitle>
				</CardHeader>
				<CardContent>
					{streetData ? (
						<StreetDataEditor data={streetData} onChange={(next) => setResource('streetData', next)} />
					) : (
						<div className="text-sm text-muted-foreground">
							This bundle does not contain a Street Data resource. Load a bundle with one to edit.
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
};

export default StreetDataPage;

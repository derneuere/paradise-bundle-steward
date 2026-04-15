// Traffic Data editor — schema-driven hierarchy + inspector + 3D viewport.
//
// The old tab-based editor was removed after every tab was registered as a
// schema-editor extension, so this page now just wires up the schema editor
// provider with the TrafficData resource schema and extension registry.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { trafficDataExtensions } from '@/components/schema-editor/extensions/trafficDataExtensions';
import { trafficDataResourceSchema } from '@/lib/schema/resources/trafficData';
import type { ParsedTrafficData } from '@/lib/core/trafficData';

const TrafficDataPage = () => {
	const { getResource, setResource } = useBundle();
	const data = getResource<ParsedTrafficData>('trafficData');

	if (!data) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Traffic Data</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle containing traffic data to begin.
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="h-full min-h-0">
			<SchemaEditorProvider
				resource={trafficDataResourceSchema}
				data={data}
				onChange={(next) => setResource('trafficData', next as ParsedTrafficData)}
				extensions={trafficDataExtensions}
			>
				<SchemaEditor />
			</SchemaEditorProvider>
		</div>
	);
};

export default TrafficDataPage;

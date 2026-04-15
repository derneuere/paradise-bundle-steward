// Schema-driven TrafficData editor (Phase B). Sits alongside the existing
// TrafficDataPage until parity is reached.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useBundle } from '@/context/BundleContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { trafficDataExtensions } from '@/components/schema-editor/extensions/trafficDataExtensions';
import { trafficDataResourceSchema } from '@/lib/schema/resources/trafficData';
import type { ParsedTrafficData } from '@/lib/core/trafficData';
import { Link } from 'react-router-dom';

const TrafficDataEditorV2Page = () => {
	const { getResource, setResource } = useBundle();
	const data = getResource<ParsedTrafficData>('trafficData');

	if (!data) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Traffic Data — Schema Editor (preview)</CardTitle>
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
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-lg font-semibold">Traffic Data — Schema Editor</h2>
					<p className="text-xs text-muted-foreground">
						Preview of the hierarchy-driven editor. The classic tab editor is still available at{' '}
						<Link to="/trafficData" className="underline">/trafficData</Link>.
					</p>
				</div>
				<Button asChild variant="outline" size="sm">
					<Link to="/trafficData">Back to tab editor</Link>
				</Button>
			</div>
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

export default TrafficDataEditorV2Page;

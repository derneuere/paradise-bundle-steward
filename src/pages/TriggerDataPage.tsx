// Trigger Data editor — schema-driven hierarchy + inspector + 3D viewport.
//
// The old tab-based TriggerDataEditor was wrapped into a set of
// schema-editor extensions (HeaderTab, LandmarksTab, GenericRegionsTab,
// …) so this page now just wires up the SchemaEditorProvider with the
// TriggerData resource schema and extension registry.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { triggerDataExtensions } from '@/components/schema-editor/extensions/triggerDataExtensions';
import { triggerDataResourceSchema } from '@/lib/schema/resources/triggerData';
import type { ParsedTriggerData } from '@/lib/core/triggerData';

const TriggerDataPage = () => {
	const { getResource, setResource } = useBundle();
	const data = getResource<ParsedTriggerData>('triggerData');

	if (!data) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Trigger Data</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle containing trigger data to begin.
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="h-full min-h-0">
			<SchemaEditorProvider
				resource={triggerDataResourceSchema}
				data={data}
				onChange={(next) => setResource('triggerData', next as ParsedTriggerData)}
				extensions={triggerDataExtensions}
			>
				<SchemaEditor />
			</SchemaEditorProvider>
		</div>
	);
};

export default TriggerDataPage;

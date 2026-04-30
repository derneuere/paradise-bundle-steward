// Trigger Data editor — schema-driven hierarchy + inspector + 3D viewport.
//
// The old tab-based TriggerDataEditor was wrapped into a set of
// schema-editor extensions (HeaderTab, LandmarksTab, GenericRegionsTab,
// …) so this page now just wires up the SchemaEditorProvider with the
// TriggerData resource schema and extension registry.

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useActiveBundleId, useWorkspace } from '@/context/WorkspaceContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { SchemaBulkSelectionContext } from '@/components/schema-editor/bulkSelectionContext';
import { useGenericBulkSelection } from '@/components/schema-editor/useGenericBulkSelection';
import { triggerDataExtensions } from '@/components/schema-editor/extensions/triggerDataExtensions';
import { triggerDataResourceSchema } from '@/lib/schema/resources/triggerData';
import type { ParsedTriggerData } from '@/lib/core/triggerData';

const TriggerDataPage = () => {
	const { getResource, setResource } = useWorkspace();
	const bundleId = useActiveBundleId();
	const data = bundleId ? getResource<ParsedTriggerData>(bundleId, 'triggerData') : null;
	const bulk = useGenericBulkSelection();
	const bulkValue = useMemo(
		() => ({
			bulkPathKeys: bulk.bulkPathKeys,
			onBulkToggle: bulk.onBulkToggle,
			onBulkRange: bulk.onBulkRange,
			onBulkApplyPaths: bulk.onBulkApplyPaths,
		}),
		[bulk.bulkPathKeys, bulk.onBulkToggle, bulk.onBulkRange, bulk.onBulkApplyPaths],
	);

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
			<SchemaBulkSelectionContext.Provider value={bulkValue}>
				<SchemaEditorProvider
					resource={triggerDataResourceSchema}
					data={data}
					onChange={(next) => bundleId && setResource(bundleId, 'triggerData', next as ParsedTriggerData)}
					extensions={triggerDataExtensions}
				>
					<SchemaEditor />
				</SchemaEditorProvider>
			</SchemaBulkSelectionContext.Provider>
		</div>
	);
};

export default TriggerDataPage;

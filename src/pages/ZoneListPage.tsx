// Zone List editor — schema-driven hierarchy + inspector + 3D viewport.
//
// Mirrors AISectionsPage. The "Map" tab is registered as an extension that
// hosts ZoneListViewport (cyan-grid polygons matching Bundle-Manager's PVS
// editor screenshot); everything else flows through the default schema
// form renderers.

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { SchemaBulkSelectionContext } from '@/components/schema-editor/bulkSelectionContext';
import { useGenericBulkSelection } from '@/components/schema-editor/useGenericBulkSelection';
import { zoneListResourceSchema } from '@/lib/schema/resources/zoneList';
import type { ParsedZoneList } from '@/lib/core/zoneList';

const ZoneListPage = () => {
	const { getResource, setResource } = useBundle();
	const data = getResource<ParsedZoneList>('zoneList');
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
					<CardTitle>Zone List</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle containing a Zone List (PVS.BNDL) to begin.
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="h-full min-h-0">
			<SchemaBulkSelectionContext.Provider value={bulkValue}>
				<SchemaEditorProvider
					resource={zoneListResourceSchema}
					data={data}
					onChange={(next) => setResource('zoneList', next as ParsedZoneList)}
				>
					<SchemaEditor />
				</SchemaEditorProvider>
			</SchemaBulkSelectionContext.Provider>
		</div>
	);
};

export default ZoneListPage;

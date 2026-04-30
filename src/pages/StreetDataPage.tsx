// StreetData resource page — hosts the schema-driven editor with the
// existing table-tab components wired in as extensions.

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFirstLoadedBundleId, useWorkspace } from '@/context/WorkspaceContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { SchemaBulkSelectionContext } from '@/components/schema-editor/bulkSelectionContext';
import { useGenericBulkSelection } from '@/components/schema-editor/useGenericBulkSelection';
import { streetDataResourceSchema } from '@/lib/schema/resources/streetData';
import { streetDataExtensions } from '@/components/schema-editor/extensions/streetDataExtensions';
import type { ParsedStreetData } from '@/lib/core/streetData';

const StreetDataPage = () => {
	const { getResource, setResource } = useWorkspace();
	const bundleId = useFirstLoadedBundleId();
	const data = bundleId ? getResource<ParsedStreetData>(bundleId, 'streetData') : null;
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
					<CardTitle>Street Data</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						This bundle does not contain a Street Data resource. Load a bundle with one to edit.
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="h-full min-h-0">
			<SchemaBulkSelectionContext.Provider value={bulkValue}>
				<SchemaEditorProvider
					resource={streetDataResourceSchema}
					data={data}
					onChange={(next) => bundleId && setResource(bundleId, 'streetData', next as ParsedStreetData)}
					extensions={streetDataExtensions}
				>
					<SchemaEditor />
				</SchemaEditorProvider>
			</SchemaBulkSelectionContext.Provider>
		</div>
	);
};

export default StreetDataPage;

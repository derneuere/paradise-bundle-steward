// Traffic Data editor — schema-driven hierarchy + inspector + 3D viewport.
//
// The old tab-based editor was removed after every tab was registered as a
// schema-editor extension, so this page now just wires up the schema editor
// provider with the TrafficData resource schema and extension registry.

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFirstLoadedBundleId, useWorkspace } from '@/context/WorkspaceContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { SchemaBulkSelectionContext } from '@/components/schema-editor/bulkSelectionContext';
import { useGenericBulkSelection } from '@/components/schema-editor/useGenericBulkSelection';
import { trafficDataExtensions } from '@/components/schema-editor/extensions/trafficDataExtensions';
import { trafficDataResourceSchema } from '@/lib/schema/resources/trafficData';
import type { ParsedTrafficData, ParsedTrafficDataRetail } from '@/lib/core/trafficData';

const TrafficDataPage = () => {
	const { getResource, setResource } = useWorkspace();
	const bundleId = useFirstLoadedBundleId();
	const raw = bundleId ? getResource<ParsedTrafficData>(bundleId, 'trafficData') : null;
	// This legacy single-resource page renders the retail schema only. v22
	// prototype payloads are surfaced via the Workspace tree (its EditorProfile
	// picks the read-only v22 schema there); routing them to the retail
	// schema here would crash on the missing `hulls` / `flowTypes` fields.
	const data: ParsedTrafficDataRetail | null = raw && raw.kind !== 'v22' ? raw : null;
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
			<SchemaBulkSelectionContext.Provider value={bulkValue}>
				<SchemaEditorProvider
					resource={trafficDataResourceSchema}
					data={data}
					onChange={(next) => bundleId && setResource(bundleId, 'trafficData', next as ParsedTrafficDataRetail)}
					extensions={trafficDataExtensions}
				>
					<SchemaEditor />
				</SchemaEditorProvider>
			</SchemaBulkSelectionContext.Provider>
		</div>
	);
};

export default TrafficDataPage;

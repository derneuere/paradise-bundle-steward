// AI Sections editor — schema-driven hierarchy + inspector + 3D viewport.
//
// The old tab-based editor (AISectionsEditor.tsx + inlined OverviewTab /
// ResetPairsTab) has been replaced by the schema-driven framework. The
// Overview and Reset Pairs tabs are registered as extensions; the sections
// table is a customRenderer on the root.sections list; everything else
// flows through the default schema form renderers.

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFirstLoadedBundleId, useWorkspace } from '@/context/WorkspaceContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { SchemaBulkSelectionContext } from '@/components/schema-editor/bulkSelectionContext';
import { useGenericBulkSelection } from '@/components/schema-editor/useGenericBulkSelection';
import { aiSectionsExtensions } from '@/components/schema-editor/extensions/aiSectionsExtensions';
import { aiSectionsResourceSchema } from '@/lib/schema/resources/aiSections';
import type { ParsedAISections, ParsedAISectionsV12 } from '@/lib/core/aiSections';

const AISectionsPage = () => {
	const { getResource, setResource } = useWorkspace();
	const bundleId = useFirstLoadedBundleId();
	const raw = bundleId ? getResource<ParsedAISections>(bundleId, 'aiSections') : null;
	// Legacy thin route only renders the V12 retail surface — the schema and
	// extensions both expect that shape. V4/V6 prototype payloads load and
	// round-trip via the registry but have no editor UI yet (next slice).
	const data = raw?.kind === 'v12' ? (raw as ParsedAISectionsV12) : null;
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
					<CardTitle>AI Sections</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle containing AI sections to begin.
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="h-full min-h-0">
			<SchemaBulkSelectionContext.Provider value={bulkValue}>
				<SchemaEditorProvider
					resource={aiSectionsResourceSchema}
					data={data}
					onChange={(next) => bundleId && setResource(bundleId, 'aiSections', next as ParsedAISectionsV12)}
					extensions={aiSectionsExtensions}
				>
					<SchemaEditor />
				</SchemaEditorProvider>
			</SchemaBulkSelectionContext.Provider>
		</div>
	);
};

export default AISectionsPage;

// Player Car Colours editor — schema-driven hierarchy + inspector.
//
// No 3D viewport for this resource. The schema declares 5 fixed palettes
// (Gloss, Metallic, Pearlescent, Special, Party) each containing parallel
// paint + pearl color lists; the default schema editor renders the tree
// and the f32 channel inputs with no extensions needed.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useActiveBundleId, useWorkspace } from '@/context/WorkspaceContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { playerCarColoursResourceSchema } from '@/lib/schema/resources/playerCarColours';
import type { PlayerCarColours } from '@/lib/core/playerCarColors';

const ColorsPage = () => {
	const { getResource, setResource } = useWorkspace();
	const bundleId = useActiveBundleId();
	const data = bundleId ? getResource<PlayerCarColours>(bundleId, 'playerCarColours') : null;

	if (!data) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Player Car Colours</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle containing player car colours to begin.
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="h-full min-h-0">
			<SchemaEditorProvider
				resource={playerCarColoursResourceSchema}
				data={data}
				onChange={(next) => bundleId && setResource(bundleId, 'playerCarColours', next as PlayerCarColours)}
			>
				<SchemaEditor />
			</SchemaEditorProvider>
		</div>
	);
};

export default ColorsPage;

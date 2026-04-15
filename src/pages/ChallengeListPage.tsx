// Challenge List editor — schema-driven hierarchy + inspector.
//
// The old tab editor lives on as custom-renderer extensions: the
// Overview statistics card on the root, plus Action 1 / Action 2 tabs
// on each ChallengeListEntry. General and Advanced are rendered by the
// default schema form via propertyGroups.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { challengeListExtensions } from '@/components/schema-editor/extensions/challengeListExtensions';
import { challengeListResourceSchema } from '@/lib/schema/resources/challengeList';
import type { ParsedChallengeList } from '@/lib/core/challengeList';

const ChallengeListPage = () => {
	const { getResource, setResource } = useBundle();
	const data = getResource<ParsedChallengeList>('challengeList');

	if (!data) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Challenge List</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle containing a challenge list to begin.
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="h-full min-h-0">
			<SchemaEditorProvider
				resource={challengeListResourceSchema}
				data={data}
				onChange={(next) => setResource('challengeList', next as ParsedChallengeList)}
				extensions={challengeListExtensions}
			>
				<SchemaEditor />
			</SchemaEditorProvider>
		</div>
	);
};

export default ChallengeListPage;

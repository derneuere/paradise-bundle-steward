import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { AISectionsEditor } from '@/components/aisections/AISectionsEditor';
import type { ParsedAISections } from '@/lib/core/aiSections';

const AISectionsPage = () => {
	const { getResource, setResource } = useBundle();
	const aiData = getResource<ParsedAISections>('aiSections');

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle>AI Sections</CardTitle>
				</CardHeader>
				<CardContent>
					{aiData ? (
						<AISectionsEditor data={aiData} onChange={(next) => setResource('aiSections', next)} />
					) : (
						<div className="text-sm text-muted-foreground">Load a bundle containing AI sections to begin.</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
};

export default AISectionsPage;

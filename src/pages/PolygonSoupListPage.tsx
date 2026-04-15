// Schema-driven editor for PolygonSoupList (resource type 0x43 —
// colloquially "worldcol").
//
// Unlike the single-resource TrafficDataPage, WORLDCOL.BIN has hundreds of
// PolygonSoupList resources — one per track unit. This page shows ALL of
// them in the 3D viewport and lets the user pick which one the schema
// editor (tree + inspector) should operate on. Clicking a face in the
// viewport also switches the active resource and navigates the tree to the
// soup under the cursor.

import { useCallback, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBundle } from '@/context/BundleContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { polygonSoupListResourceSchema } from '@/lib/schema/resources/polygonSoupList';
import type { ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';
import { PolygonSoupListContext } from '@/components/schema-editor/viewports/polygonSoupListContext';

// Build a dropdown label for a PSL resource. Shows the resource index, soup
// count, and total triangle count so the user can pick the interesting ones
// (the 159 empty stubs in WORLDCOL get a " · empty" suffix).
function pslLabel(model: ParsedPolygonSoupList | null, index: number): string {
	if (model == null) return `#${index} · parse failed`;
	const soupCount = model.soups.length;
	if (soupCount === 0) return `#${index} · empty`;
	let triCount = 0;
	for (const s of model.soups) {
		for (const p of s.polygons) triCount += p.vertexIndices[3] === 0xFF ? 1 : 2;
	}
	return `#${index} · ${soupCount} soup${soupCount === 1 ? '' : 's'} · ${triCount.toLocaleString()} tris`;
}

const PolygonSoupListPage = () => {
	const { getResources, setResourceAt } = useBundle();
	const models = getResources<ParsedPolygonSoupList>('polygonSoupList');

	// Default to the first populated resource so the schema editor opens on
	// something useful instead of the 48-byte empty stub at index 0.
	const firstPopulated = useMemo(() => {
		for (let i = 0; i < models.length; i++) {
			if (models[i] && (models[i] as ParsedPolygonSoupList).soups.length > 0) return i;
		}
		return 0;
	}, [models]);

	const [selectedIndex, setSelectedIndex] = useState<number>(firstPopulated);
	// Initial path for the schema editor — re-keyed whenever the selected
	// resource changes so the SchemaEditorProvider remounts with fresh state.
	// Viewport click → (modelIndex, soupIndex) populates this to navigate the
	// tree to the clicked soup on the first render after the resource swap.
	const [initialPath, setInitialPath] = useState<(string | number)[]>([]);

	const currentModel = models[selectedIndex] ?? null;

	const handleChange = useCallback(
		(next: unknown) => setResourceAt('polygonSoupList', selectedIndex, next),
		[setResourceAt, selectedIndex],
	);

	const handleViewportSelect = useCallback(
		(modelIndex: number, soupIndex: number) => {
			setSelectedIndex(modelIndex);
			setInitialPath(['soups', soupIndex]);
		},
		[],
	);

	if (models.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Polygon Soup List — Schema Editor</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle containing a polygon soup list (e.g. WORLDCOL.BIN) to begin.
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!currentModel) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Polygon Soup List — Schema Editor</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Resource #{selectedIndex} failed to parse — pick a different one.
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="h-full min-h-0 flex flex-col gap-3">
			<div className="flex items-center gap-4 shrink-0">
				<div className="flex-1">
					<h2 className="text-lg font-semibold">Polygon Soup List — Schema Editor</h2>
					<p className="text-xs text-muted-foreground">
						Collision mesh resource (0x43). Click geometry in the 3D view to select a soup, or pick a resource from the dropdown.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">Resource</span>
					<Select
						value={String(selectedIndex)}
						onValueChange={(v) => {
							setSelectedIndex(Number(v));
							setInitialPath([]);
						}}
					>
						<SelectTrigger className="h-8 w-72">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="max-h-[60vh]">
							{models.map((m, i) => (
								<SelectItem key={i} value={String(i)}>
									{pslLabel(m as ParsedPolygonSoupList | null, i)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
			<div className="flex-1 min-h-0">
				<PolygonSoupListContext.Provider
					value={{
						models: models as (ParsedPolygonSoupList | null)[],
						selectedModelIndex: selectedIndex,
						onSelect: handleViewportSelect,
					}}
				>
					<SchemaEditorProvider
						// Key on selectedIndex so the provider remounts with a fresh
						// initialPath whenever the user (or the viewport) picks a
						// different resource.
						key={`psl-${selectedIndex}`}
						resource={polygonSoupListResourceSchema}
						data={currentModel}
						onChange={handleChange}
						initialPath={initialPath}
					>
						<SchemaEditor />
					</SchemaEditorProvider>
				</PolygonSoupListContext.Provider>
			</div>
		</div>
	);
};

export default PolygonSoupListPage;

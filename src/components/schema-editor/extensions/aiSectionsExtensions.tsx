// Adapters that wrap the legacy AISections tab components as schema-editor
// extensions. Each adapter translates between:
//   - the schema editor's narrow / whole-resource extension contracts, and
//   - the tabs' original `(data, onChange, ...)` props.
//
// This is what lets the schema-driven page reuse the existing Overview +
// SectionsList + ResetPairsTable UIs verbatim while the schema still owns
// tree navigation, per-section inspection, and round-trip walks.
//
// Most adapters here are `WholeResourceExtensionProps` because the legacy
// tabs were authored against the resource root — they fan out across
// `sections`, `sectionResetPairs`, etc. The per-section edges adapter
// genuinely needs the root too (it cross-references other sections to
// resolve duplicate-edge targets) so it stays whole-resource even though
// `path` points at a single section.

import React, { useRef, useState } from 'react';
import type { WholeResourceExtensionProps, ExtensionRegistry } from '../context';
import type { ParsedAISectionsV12, AISection } from '@/lib/core/aiSections';
import { AISectionsOverview } from '@/components/aisections/AISectionsOverview';
import { ResetPairsTable } from '@/components/aisections/ResetPairsTable';
import { SectionsList } from '@/components/aisections/SectionsList';
import { AddSectionDialog } from '@/components/aisections/AddSectionDialog';
import { EdgesList } from '@/components/aisections/EdgesList';

// ---------------------------------------------------------------------------
// Overview — root-level propertyGroup extension
// ---------------------------------------------------------------------------

// WholeResource: legacy overview tab that operates on the full root.
const AISectionsOverviewExtension: React.FC<WholeResourceExtensionProps> = ({
	data,
	setData,
}) => (
	<AISectionsOverview
		data={data as ParsedAISectionsV12}
		onChange={setData as (next: ParsedAISectionsV12) => void}
	/>
);

// ---------------------------------------------------------------------------
// Sections list — customRenderer on root.sections
// ---------------------------------------------------------------------------

// Clicking the "Detail" button in the legacy SectionsList used to open a
// modal dialog; under the schema editor it navigates the tree selection
// to the clicked section instead, so the inspector takes over with the
// Identity / Portals / NoGo Lines / Corners tabs declared on AISection.
//
// WholeResource: list tab needs the full sections array; selectChild is
// relative to the extension's path (which is the root for a property-group
// tab) so `['sections', i]` lands on the right section.
const AISectionsListExtension: React.FC<WholeResourceExtensionProps> = ({
	data,
	setData,
	selectChild,
}) => {
	const scrollToIndexRef = useRef<((index: number) => void) | null>(null);
	const [addOpen, setAddOpen] = useState(false);

	const parsed = data as ParsedAISectionsV12;
	const onChange = setData as (next: ParsedAISectionsV12) => void;

	const handleAdd = (section: AISection) => {
		const newIndex = parsed.sections.length;
		onChange({ ...parsed, sections: [...parsed.sections, section] });
		// Select the freshly added section so the inspector jumps to it.
		requestAnimationFrame(() => {
			selectChild(['sections', newIndex]);
		});
	};

	return (
		<>
			<SectionsList
				data={parsed}
				onChange={onChange}
				onAddClick={() => setAddOpen(true)}
				onDetailClick={(i) => selectChild(['sections', i])}
				scrollToIndexRef={scrollToIndexRef}
			/>
			<AddSectionDialog open={addOpen} onOpenChange={setAddOpen} onAdd={handleAdd} />
		</>
	);
};

// ---------------------------------------------------------------------------
// Reset pairs — customRenderer on root.sectionResetPairs
// ---------------------------------------------------------------------------

// WholeResource: legacy reset-pairs tab operates on the full root.
const AISectionsResetPairsExtension: React.FC<WholeResourceExtensionProps> = ({
	data,
	setData,
}) => (
	<ResetPairsTable
		data={data as ParsedAISectionsV12}
		onChange={setData as (next: ParsedAISectionsV12) => void}
	/>
);

// ---------------------------------------------------------------------------
// AISection edges — propertyGroup `component` on AISection
// ---------------------------------------------------------------------------

// Renders one row per implicit polygon edge (corner[i] → corner[(i+1)%N]) so
// the user has a stable surface to right-click. Picking "Duplicate section
// through this edge" triggers `duplicateSectionThroughEdge` and selects the
// new section.
//
// `path` here is the AISection's path inside the resource — `['sections',
// srcIdx]`. We pull `srcIdx` from the path rather than counting indices in
// the parent, so the operation stays correct regardless of how the user
// got here (tree click, breadcrumb, programmatic selection).
//
// WholeResource: the EdgesList resolves duplicate-edge targets across
// other sections, so the full `ParsedAISectionsV12` model is required.
const AISectionEdgesExtension: React.FC<
	WholeResourceExtensionProps<AISection | undefined>
> = ({ path, value, data }) => {
	if (path.length < 2 || path[0] !== 'sections' || typeof path[1] !== 'number') {
		return (
			<div className="text-xs text-muted-foreground">
				Edges panel can only be rendered on a section.
			</div>
		);
	}
	const srcIdx = path[1];
	const section = value;
	const model = data as ParsedAISectionsV12;
	if (!section) {
		return <div className="text-xs text-muted-foreground">No section selected.</div>;
	}
	return <EdgesList section={section} srcIdx={srcIdx} model={model} />;
};

// ---------------------------------------------------------------------------
// Registry bundle — hand this map to SchemaEditorProvider.
// ---------------------------------------------------------------------------

export const aiSectionsExtensions: ExtensionRegistry = {
	AISectionsOverview: AISectionsOverviewExtension,
	AISectionsList: AISectionsListExtension,
	AISectionsResetPairs: AISectionsResetPairsExtension,
	AISectionEdges: AISectionEdgesExtension,
};

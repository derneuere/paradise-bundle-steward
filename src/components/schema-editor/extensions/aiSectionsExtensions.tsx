// Adapters that wrap the legacy AISections tab components as schema-editor
// extensions. Each adapter translates between:
//   - the schema editor's `(path, value, setValue, setData, data, resource)`
//     extension contract, and
//   - the tabs' original `(data, onChange, ...)` props.
//
// This is what lets the schema-driven page reuse the existing Overview +
// SectionsList + ResetPairsTable UIs verbatim while the schema still owns
// tree navigation, per-section inspection, and round-trip walks.

import React, { useRef, useState } from 'react';
import type { SchemaExtensionProps, ExtensionRegistry } from '../context';
import { useSchemaEditor } from '../context';
import type { ParsedAISections, AISection } from '@/lib/core/aiSections';
import { AISectionsOverview } from '@/components/aisections/AISectionsOverview';
import { ResetPairsTable } from '@/components/aisections/ResetPairsTable';
import { SectionsList } from '@/components/aisections/SectionsList';
import { AddSectionDialog } from '@/components/aisections/AddSectionDialog';

// ---------------------------------------------------------------------------
// Overview — root-level propertyGroup extension
// ---------------------------------------------------------------------------

export const AISectionsOverviewExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => (
	<AISectionsOverview
		data={data as ParsedAISections}
		onChange={setData as (next: ParsedAISections) => void}
	/>
);

// ---------------------------------------------------------------------------
// Sections list — customRenderer on root.sections
// ---------------------------------------------------------------------------

// Clicking the "Detail" button in the legacy SectionsList used to open a
// modal dialog; under the schema editor it navigates the tree selection
// to the clicked section instead, so the inspector takes over with the
// Identity / Portals / NoGo Lines / Corners tabs declared on AISection.
export const AISectionsListExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => {
	const { selectPath } = useSchemaEditor();
	const scrollToIndexRef = useRef<((index: number) => void) | null>(null);
	const [addOpen, setAddOpen] = useState(false);

	const parsed = data as ParsedAISections;
	const onChange = setData as (next: ParsedAISections) => void;

	const handleAdd = (section: AISection) => {
		const newIndex = parsed.sections.length;
		onChange({ ...parsed, sections: [...parsed.sections, section] });
		// Select the freshly added section so the inspector jumps to it.
		requestAnimationFrame(() => {
			selectPath(['sections', newIndex]);
		});
	};

	return (
		<>
			<SectionsList
				data={parsed}
				onChange={onChange}
				onAddClick={() => setAddOpen(true)}
				onDetailClick={(i) => selectPath(['sections', i])}
				scrollToIndexRef={scrollToIndexRef}
			/>
			<AddSectionDialog open={addOpen} onOpenChange={setAddOpen} onAdd={handleAdd} />
		</>
	);
};

// ---------------------------------------------------------------------------
// Reset pairs — customRenderer on root.sectionResetPairs
// ---------------------------------------------------------------------------

export const AISectionsResetPairsExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => (
	<ResetPairsTable
		data={data as ParsedAISections}
		onChange={setData as (next: ParsedAISections) => void}
	/>
);

// ---------------------------------------------------------------------------
// Registry bundle — hand this map to SchemaEditorProvider.
// ---------------------------------------------------------------------------

export const aiSectionsExtensions: ExtensionRegistry = {
	AISectionsOverview: AISectionsOverviewExtension,
	AISectionsList: AISectionsListExtension,
	AISectionsResetPairs: AISectionsResetPairsExtension,
};

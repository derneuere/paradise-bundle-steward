// Schema-editor extension adapters for StreetData.
//
// Each adapter wraps one of the existing table-tab components (previously
// inlined inside StreetDataEditor.tsx) so the schema editor can reuse them
// as custom renderers without rewriting the per-row edit logic.
//
// All five adapters take `WholeResourceExtensionProps`: the legacy tabs
// were authored against the resource root (`{ data, onChange }`) and
// fan out across multiple sibling arrays, which the narrow per-node view
// can't reach.

import React from 'react';
import type { WholeResourceExtensionProps, ExtensionRegistry } from '../context';
import type { ParsedStreetData } from '@/lib/core/streetData';

import { OverviewTab } from '@/components/streetdata/OverviewTab';
import { StreetsTab } from '@/components/streetdata/StreetsTab';
import { JunctionsTab } from '@/components/streetdata/JunctionsTab';
import { RoadsTab } from '@/components/streetdata/RoadsTab';
import { ChallengesTab } from '@/components/streetdata/ChallengesTab';

// ---------------------------------------------------------------------------
// Adapters — every one is WholeResource (legacy whole-tree tabs).
// ---------------------------------------------------------------------------

export const StreetDataOverviewExtension: React.FC<WholeResourceExtensionProps> = ({
	data,
	setData,
}) => (
	<OverviewTab
		data={data as ParsedStreetData}
		onChange={setData as (next: ParsedStreetData) => void}
	/>
);

export const StreetsExtension: React.FC<WholeResourceExtensionProps> = ({ data, setData }) => (
	<StreetsTab
		data={data as ParsedStreetData}
		onChange={setData as (next: ParsedStreetData) => void}
	/>
);

export const JunctionsExtension: React.FC<WholeResourceExtensionProps> = ({ data, setData }) => (
	<JunctionsTab
		data={data as ParsedStreetData}
		onChange={setData as (next: ParsedStreetData) => void}
	/>
);

export const RoadsExtension: React.FC<WholeResourceExtensionProps> = ({ data, setData }) => (
	<RoadsTab
		data={data as ParsedStreetData}
		onChange={setData as (next: ParsedStreetData) => void}
	/>
);

export const ChallengesExtension: React.FC<WholeResourceExtensionProps> = ({ data, setData }) => (
	<ChallengesTab
		data={data as ParsedStreetData}
		onChange={setData as (next: ParsedStreetData) => void}
	/>
);

// ---------------------------------------------------------------------------
// Registry bundle — passed to SchemaEditorProvider.
// ---------------------------------------------------------------------------

export const streetDataExtensions: ExtensionRegistry = {
	StreetDataOverviewTab: StreetDataOverviewExtension,
	StreetsTab: StreetsExtension,
	JunctionsTab: JunctionsExtension,
	RoadsTab: RoadsExtension,
	ChallengesTab: ChallengesExtension,
};

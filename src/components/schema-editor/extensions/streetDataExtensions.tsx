// Schema-editor extension adapters for StreetData.
//
// Each adapter wraps one of the existing table-tab components (previously
// inlined inside StreetDataEditor.tsx) so the schema editor can reuse them
// as custom renderers without rewriting the per-row edit logic.
//
// The contract is identical to trafficDataExtensions.tsx — an adapter
// receives `(path, value, setValue, setData, data, resource)` and delegates
// to a classic `{ data, onChange }` tab by passing `setData` through as
// `onChange`. Tabs only ever mutate their own list, so behavior matches
// the pre-schema editor.

import React from 'react';
import type { SchemaExtensionProps, ExtensionRegistry } from '../context';
import type { ParsedStreetData } from '@/lib/core/streetData';

import { OverviewTab } from '@/components/streetdata/OverviewTab';
import { StreetsTab } from '@/components/streetdata/StreetsTab';
import { JunctionsTab } from '@/components/streetdata/JunctionsTab';
import { RoadsTab } from '@/components/streetdata/RoadsTab';
import { ChallengesTab } from '@/components/streetdata/ChallengesTab';

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

export const StreetDataOverviewExtension: React.FC<SchemaExtensionProps> = ({
	data,
	setData,
}) => (
	<OverviewTab
		data={data as ParsedStreetData}
		onChange={setData as (next: ParsedStreetData) => void}
	/>
);

export const StreetsExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => (
	<StreetsTab
		data={data as ParsedStreetData}
		onChange={setData as (next: ParsedStreetData) => void}
	/>
);

export const JunctionsExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => (
	<JunctionsTab
		data={data as ParsedStreetData}
		onChange={setData as (next: ParsedStreetData) => void}
	/>
);

export const RoadsExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => (
	<RoadsTab
		data={data as ParsedStreetData}
		onChange={setData as (next: ParsedStreetData) => void}
	/>
);

export const ChallengesExtension: React.FC<SchemaExtensionProps> = ({ data, setData }) => (
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

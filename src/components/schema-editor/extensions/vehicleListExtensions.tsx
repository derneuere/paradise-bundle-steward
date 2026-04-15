// Schema-editor extensions for the VehicleList resource.
//
// Registers the legacy per-vehicle editor form as the `VehicleEditorTab`
// property group on VehicleListEntry. When the user picks a vehicle in the
// hierarchy tree, the inspector shows a tab with the full 5-tab editor
// (Basic / Gameplay / Performance / Audio / Technical) wired to the schema
// editor's mutation pipeline.

import React from 'react';
import type { SchemaExtensionProps, ExtensionRegistry } from '../context';
import type { VehicleListEntry } from '@/lib/core/vehicleList';
import { VehicleEditorForm } from '@/components/VehicleEditorForm';

export const VehicleEditorExtension: React.FC<SchemaExtensionProps> = ({ value, setValue }) => {
	if (!value || typeof value !== 'object') {
		return (
			<div className="text-xs text-muted-foreground">
				Select a vehicle in the hierarchy to edit its fields.
			</div>
		);
	}
	return (
		<VehicleEditorForm
			vehicle={value as VehicleListEntry}
			onChange={(next) => setValue(next)}
		/>
	);
};

export const vehicleListExtensions: ExtensionRegistry = {
	VehicleEditorTab: VehicleEditorExtension,
};

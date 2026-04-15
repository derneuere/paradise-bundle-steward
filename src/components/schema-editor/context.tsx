// Schema editor context — owns selection + mutation for a single resource.
//
// The shape is deliberately narrow: a resource schema, the current model,
// a selected path, and a few mutation helpers. Anything the panels need to
// coordinate on lives here; anything that's local concern (expand/collapse,
// filter text) stays in the component.

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ResourceSchema } from '@/lib/schema/types';
import {
	getAtPath,
	insertListItem as insertListItemWalk,
	removeListItem as removeListItemWalk,
	resolveSchemaAtPath,
	setAtPath as setAtPathWalk,
	updateAtPath as updateAtPathWalk,
	type NodePath,
	type SchemaLocation,
} from '@/lib/schema/walk';

// ---------------------------------------------------------------------------
// Extension registry
// ---------------------------------------------------------------------------

// Props passed to any React component registered as a custom field renderer
// via schema.kind === 'custom' or propertyGroup.component. Same mental model
// as visual-react's EditingExtensionProps — the extension gets the value at
// its path, a setter, and the full root for cross-ref lookups.
export type SchemaExtensionProps = {
	/** Path to the value this extension owns. */
	path: NodePath;
	/** Current value at `path`. */
	value: unknown;
	/** Replace the value at `path`. */
	setValue: (next: unknown) => void;
	/** Replace the entire resource root. Useful for legacy tab adapters
	 * whose contract is `(data, onChange(data)) => JSX`. */
	setData: (next: unknown) => void;
	/** Full resource root — read-only for cross-reference lookups. */
	data: unknown;
	/** The resource schema — for ref target resolution. */
	resource: ResourceSchema;
};

export type SchemaExtension = React.ComponentType<SchemaExtensionProps>;
export type ExtensionRegistry = Record<string, SchemaExtension>;

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export type SchemaEditorContextValue = {
	resource: ResourceSchema;
	data: unknown;
	// Selection
	selectedPath: NodePath;
	selectPath: (path: NodePath) => void;
	// Resolved schema for the current selection (memoized).
	selectedLocation: SchemaLocation | null;
	// Path helpers
	getAtPath: (path: NodePath) => unknown;
	// Mutations — all return void and propagate through the provided
	// onChange handler (which typically calls BundleContext.setResource).
	setAtPath: (path: NodePath, value: unknown) => void;
	updateAtPath: (path: NodePath, updater: (current: unknown) => unknown) => void;
	insertAt: (listPath: NodePath, item: unknown, index?: number) => void;
	removeAt: (listPath: NodePath, index: number) => void;
	// Extension registry — empty by default (Phase C adds custom renderers).
	getExtension: (name: string) => SchemaExtension | undefined;
};

const SchemaEditorContext = createContext<SchemaEditorContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type ProviderProps = {
	resource: ResourceSchema;
	data: unknown;
	onChange: (next: unknown) => void;
	initialPath?: NodePath;
	extensions?: ExtensionRegistry;
	children: React.ReactNode;
};

export function SchemaEditorProvider({
	resource,
	data,
	onChange,
	initialPath = [],
	extensions,
	children,
}: ProviderProps) {
	const [selectedPath, setSelectedPath] = useState<NodePath>(initialPath);

	// Resolve the schema at the current selection every time selection or
	// resource changes. Cheap — just walks record fields.
	const selectedLocation = useMemo(
		() => resolveSchemaAtPath(resource, selectedPath),
		[resource, selectedPath],
	);

	const selectPath = useCallback((path: NodePath) => {
		setSelectedPath(path);
	}, []);

	const getAtPathFn = useCallback(
		(path: NodePath) => getAtPath(data, path),
		[data],
	);

	const setAtPath = useCallback(
		(path: NodePath, value: unknown) => {
			const next = setAtPathWalk(data, path, value);
			onChange(next);
		},
		[data, onChange],
	);

	const updateAtPath = useCallback(
		(path: NodePath, updater: (current: unknown) => unknown) => {
			const next = updateAtPathWalk(data, path, updater);
			onChange(next);
		},
		[data, onChange],
	);

	const insertAt = useCallback(
		(listPath: NodePath, item: unknown, index?: number) => {
			const next = insertListItemWalk(data, listPath, item, index);
			onChange(next);
		},
		[data, onChange],
	);

	const removeAt = useCallback(
		(listPath: NodePath, index: number) => {
			const next = removeListItemWalk(data, listPath, index);
			onChange(next);
			// If the removed index is <= the selection's corresponding
			// segment, rebase the selection so it doesn't point past the end.
			// Simpler approach for now: if the selection touches this list at
			// or after the removed index, trim it to the list itself.
			if (selectedPath.length >= listPath.length) {
				let listMatches = true;
				for (let i = 0; i < listPath.length; i++) {
					if (selectedPath[i] !== listPath[i]) {
						listMatches = false;
						break;
					}
				}
				if (listMatches && selectedPath.length > listPath.length) {
					const maybeIndex = selectedPath[listPath.length];
					if (typeof maybeIndex === 'number' && maybeIndex >= index) {
						// Drop back to the list node itself — safest, avoids
						// pointing at a now-stale sibling.
						setSelectedPath(listPath);
					}
				}
			}
		},
		[data, onChange, selectedPath],
	);

	const getExtension = useCallback(
		(name: string) => extensions?.[name],
		[extensions],
	);

	const value = useMemo<SchemaEditorContextValue>(
		() => ({
			resource,
			data,
			selectedPath,
			selectPath,
			selectedLocation,
			getAtPath: getAtPathFn,
			setAtPath,
			updateAtPath,
			insertAt,
			removeAt,
			getExtension,
		}),
		[
			resource,
			data,
			selectedPath,
			selectPath,
			selectedLocation,
			getAtPathFn,
			setAtPath,
			updateAtPath,
			insertAt,
			removeAt,
			getExtension,
		],
	);

	return (
		<SchemaEditorContext.Provider value={value}>{children}</SchemaEditorContext.Provider>
	);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSchemaEditor(): SchemaEditorContextValue {
	const ctx = useContext(SchemaEditorContext);
	if (!ctx) {
		throw new Error('useSchemaEditor must be used within a SchemaEditorProvider');
	}
	return ctx;
}

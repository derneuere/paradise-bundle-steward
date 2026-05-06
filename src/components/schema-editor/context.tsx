// Schema editor context — owns selection + mutation for a single resource.
//
// The shape is deliberately narrow: a resource schema, the current model,
// a selected path, and a few mutation helpers. Anything the panels need to
// coordinate on lives here; anything that's local concern (expand/collapse,
// filter text) stays in the component.

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ResourceSchema } from '@/lib/schema/types';
import {
	applyDerives,
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

// Props passed to a schema-editor extension component (registered via
// `{ kind: 'custom', component }` on a field, or `propertyGroup.component`
// on a record). The default contract is deliberately narrow: an extension
// gets a path-rooted view of one node and the means to mutate / navigate
// inside it.
//
// If an extension genuinely owns the whole resource (e.g., a list-of-X tab
// that pages through siblings the schema can't address from a single node),
// type its props as `WholeResourceExtensionProps` and add a comment line
// justifying why the wider surface is needed. Don't widen
// `SchemaExtensionProps` itself — the narrow form is the default for a
// reason: every extra field on the prop bag is friction for whoever writes
// the next extension.
export type SchemaExtensionProps<T = unknown> = {
	/** Path to the value this extension owns. */
	path: NodePath;
	/** Current value at `path`. */
	value: T;
	/** Replace the value at `path`. */
	setValue: (next: T) => void;
	/** Move the editor's selection to a node relative to this extension's
	 * `path` (`rel` is appended to `path`). Pass `[]` to re-select this
	 * extension's own node. */
	selectChild: (rel: NodePath) => void;
};

// Props for extensions that genuinely operate on the resource as a whole
// — typically root-level tabs whose pre-schema contract was
// `(data, onChange(data)) => JSX`, or list tabs that need to walk sibling
// arrays the schema can't reach from a single node. Each call site that
// uses this type should justify it with a one-line comment.
export type WholeResourceExtensionProps<T = unknown> = SchemaExtensionProps<T> & {
	/** Full resource root — read-only for cross-reference lookups. */
	data: unknown;
	/** Replace the entire resource root. Mirrors the legacy tab contract
	 * `(data, onChange(data)) => JSX`. */
	setData: (next: unknown) => void;
	/** The resource schema — for ref target resolution. */
	resource: ResourceSchema;
};

// The registry stores components in their type-erased form. Runtime
// always hands them the full `WholeResourceExtensionProps` prop bag;
// each component's declared props (narrow or wide) decide what's
// observed on the consumer side. Using `any` for `value` lets us put
// both `React.FC<SchemaExtensionProps<ChallengeListEntry>>` and
// `React.FC<WholeResourceExtensionProps>` in the same map without
// fighting variance.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- variance escape hatch for the heterogeneous registry; see comment above.
export type SchemaExtension = React.ComponentType<WholeResourceExtensionProps<any>>;
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
	/**
	 * Uncontrolled initial selection. Only read on first mount — use the
	 * controlled `selectedPath` / `onSelectedPathChange` pair below when the
	 * page needs to drive selection externally (e.g., a multi-resource page
	 * switching resources without tearing down the viewport).
	 */
	initialPath?: NodePath;
	/**
	 * Controlled selection. When provided, the provider stops managing its
	 * own `selectedPath` state and mirrors this prop. Pair with
	 * `onSelectedPathChange` to receive updates from clicks inside the
	 * editor.
	 *
	 * Whether the provider is controlled or uncontrolled is determined by
	 * whether `selectedPath` is `undefined` on first render — flipping
	 * between controlled and uncontrolled across renders is not supported
	 * and produces a dev-only warning.
	 */
	selectedPath?: NodePath;
	/** Controlled selection setter. Required when `selectedPath` is provided. */
	onSelectedPathChange?: (next: NodePath) => void;
	extensions?: ExtensionRegistry;
	children: React.ReactNode;
};

export function SchemaEditorProvider({
	resource,
	data,
	onChange,
	initialPath = [],
	selectedPath: controlledPath,
	onSelectedPathChange,
	extensions,
	children,
}: ProviderProps) {
	// Decide once per mount whether this provider is controlled. Flipping
	// between controlled / uncontrolled would require swapping where the
	// selection lives mid-flight, which React discourages and no call site
	// in this repo needs; warn in dev and stick with the initial mode.
	const isControlledRef = useRef<boolean>(controlledPath !== undefined);
	if (import.meta.env?.DEV && isControlledRef.current !== (controlledPath !== undefined)) {
		console.warn(
			'SchemaEditorProvider: `selectedPath` switched between controlled and uncontrolled between renders. The initial mode is kept.',
		);
	}
	const isControlled = isControlledRef.current;

	const [internalPath, setInternalPath] = useState<NodePath>(initialPath);
	const selectedPath = isControlled ? (controlledPath ?? []) : internalPath;

	// Resolve the schema at the current selection every time selection or
	// resource changes. Cheap — just walks record fields.
	const selectedLocation = useMemo(
		() => resolveSchemaAtPath(resource, selectedPath),
		[resource, selectedPath],
	);

	// Single write funnel used by every mutation path below — routes to the
	// parent's setter in controlled mode or to local state otherwise.
	const writeSelection = useCallback(
		(path: NodePath) => {
			if (isControlled) onSelectedPathChange?.(path);
			else setInternalPath(path);
		},
		[isControlled, onSelectedPathChange],
	);

	const selectPath = useCallback(
		(path: NodePath) => {
			writeSelection(path);
		},
		[writeSelection],
	);

	const getAtPathFn = useCallback(
		(path: NodePath) => getAtPath(data, path),
		[data],
	);

	const setAtPath = useCallback(
		(path: NodePath, value: unknown) => {
			const next = setAtPathWalk(data, path, value);
			// Run schema-declared derive hooks on the ancestors of the
			// mutated path so cached fields (e.g., mfMaxVehicleRecip) stay
			// in sync with their source of truth without the mutator
			// having to know about them.
			const reconciled = applyDerives(data, next, path, resource);
			onChange(reconciled);
		},
		[data, onChange, resource],
	);

	const updateAtPath = useCallback(
		(path: NodePath, updater: (current: unknown) => unknown) => {
			const next = updateAtPathWalk(data, path, updater);
			const reconciled = applyDerives(data, next, path, resource);
			onChange(reconciled);
		},
		[data, onChange, resource],
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
						// pointing at a now-stale sibling. Routes through the
						// controlled/uncontrolled-aware setter.
						writeSelection(listPath);
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

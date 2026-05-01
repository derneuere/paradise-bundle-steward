// Schema-driven inspector — renders the form for the currently selected path.

import React, { useMemo, useState } from 'react';
import { useResetOnChange } from '@/hooks/useResetOnChange';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ChevronRight } from 'lucide-react';
import type { FieldMetadata, PropertyGroup, RecordSchema } from '@/lib/schema/types';
import { FieldRenderer } from './fields/FieldRenderer';
import { useSchemaEditor } from './context';
import { formatPath, getAtPath, type NodePath } from '@/lib/schema/walk';
import { GenericBulkEditPanel } from './GenericBulkEditPanel';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InspectorPanel() {
	const { resource, data, selectedPath, selectPath, selectedLocation, setAtPath } = useSchemaEditor();

	const rootRecord = resource.registry[resource.rootType];

	// When there's no selection, show the root record.
	const record =
		selectedLocation?.record ??
		(selectedPath.length === 0 ? rootRecord : undefined);

	const selectedValue = useMemo(() => getAtPath(data, selectedPath), [data, selectedPath]);

	if (!record) {
		// Selection is a leaf field (e.g., user clicked into a ref). Render
		// the single field by itself.
		const field = selectedLocation?.field;
		if (field && selectedLocation?.parentRecord && selectedLocation.parentFieldName) {
			const meta = selectedLocation.parentRecord.fieldMetadata?.[selectedLocation.parentFieldName];
			return (
				<div className="h-full flex flex-col min-h-0">
					<GenericBulkEditPanel />
					<div className="flex-1 min-h-0 overflow-auto p-4">
						<Breadcrumb path={selectedPath} selectPath={selectPath} />
						<div className="mt-2">
							<FieldRenderer
								label={meta?.label ?? selectedLocation.parentFieldName}
								field={field}
								value={selectedValue}
								onChange={(next) => setAtPath(selectedPath, next)}
								meta={meta}
								path={selectedPath}
							/>
						</div>
					</div>
				</div>
			);
		}
		return (
			<div className="h-full flex flex-col min-h-0">
				<GenericBulkEditPanel />
				<div className="flex-1 min-h-0 p-4 text-xs text-muted-foreground">Nothing selected.</div>
			</div>
		);
	}

	return (
		<div className="h-full flex flex-col min-h-0">
			<GenericBulkEditPanel />
			<div className="flex-1 min-h-0">
				<RecordForm record={record} path={selectedPath} value={selectedValue as Record<string, unknown>} />
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

function Breadcrumb({ path, selectPath }: { path: NodePath; selectPath: (p: NodePath) => void }) {
	if (path.length === 0) {
		return <div className="text-[11px] text-muted-foreground">root</div>;
	}
	const segments: { label: string; path: NodePath }[] = [{ label: 'root', path: [] }];
	for (let i = 0; i < path.length; i++) {
		const seg = path[i];
		segments.push({
			label: typeof seg === 'number' ? `[${seg}]` : String(seg),
			path: path.slice(0, i + 1),
		});
	}
	return (
		<div className="flex items-center flex-wrap gap-0.5 text-[11px]">
			{segments.map((s, i) => (
				<React.Fragment key={i}>
					{i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
					<button
						className="text-muted-foreground hover:text-foreground hover:underline"
						onClick={() => selectPath(s.path)}
					>
						{s.label}
					</button>
				</React.Fragment>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Record form
// ---------------------------------------------------------------------------

type RecordFormProps = {
	record: RecordSchema;
	path: NodePath;
	value: Record<string, unknown> | undefined;
};

function RecordForm({ record, path, value }: RecordFormProps) {
	const { selectPath, updateAtPath } = useSchemaEditor();

	// Group fields by propertyGroups if the schema provides them.
	const { groups, ungrouped } = useMemo(() => {
		if (!record.propertyGroups || record.propertyGroups.length === 0) {
			return { groups: null, ungrouped: Object.keys(record.fields) };
		}
		const groupedSet = new Set<string>();
		for (const g of record.propertyGroups) {
			if ('properties' in g) for (const p of g.properties) groupedSet.add(p);
		}
		return {
			groups: record.propertyGroups,
			ungrouped: Object.keys(record.fields).filter((f) => !groupedSet.has(f)),
		};
	}, [record]);

	// Default active tab — reset whenever the selected record type changes
	// so an old tab title from a previous record doesn't leave the current
	// record with no visibly-active tab.
	const defaultTab = useMemo(() => {
		if (record.propertyGroups && record.propertyGroups.length > 0) return record.propertyGroups[0].title;
		return 'Fields';
	}, [record]);

	const [activeTab, setActiveTab] = useState<string>(defaultTab);

	useResetOnChange(defaultTab, () => setActiveTab(defaultTab));

	const renderFields = (fieldNames: string[]) => (
		<div className="space-y-3">
			{fieldNames.map((fieldName) => {
				const field = record.fields[fieldName];
				if (!field) return null;
				const meta = record.fieldMetadata?.[fieldName];
				if (meta?.hidden) return null;
				const fieldPath: NodePath = [...path, fieldName];
				const fieldValue = value?.[fieldName];
				return (
					<FieldRenderer
						key={fieldName}
						label={meta?.label ?? fieldName}
						field={field}
						value={fieldValue}
						onChange={(next) => updateAtPath(fieldPath, () => next)}
						meta={meta}
						path={fieldPath}
					/>
				);
			})}
		</div>
	);

	// Layout note: when the selected record has propertyGroups, the Tabs
	// root is OUTSIDE the ScrollArea. This is deliberate — some extensions
	// (like TrafficData's OverviewTab) render wide summary tables that
	// force the ScrollArea's inner content to expand horizontally. If the
	// TabsList lives inside that expanded container, its `w-full` resolves
	// to the content width rather than the visible panel width, and the
	// tabs never wrap. Pinning the TabsList outside the ScrollArea keeps
	// it anchored to the panel width, so wrap engages when the panel is
	// narrow. Only the TabsContent scrolls.
	return (
		<div className="flex flex-col h-full min-h-0">
			<div className="px-4 pt-4 pb-2 border-b bg-card/60 shrink-0">
				<Breadcrumb path={path} selectPath={selectPath} />
				<h3 className="text-sm font-semibold mt-1">{record.name}</h3>
				{record.description && (
					<p className="text-[11px] text-muted-foreground">{record.description}</p>
				)}
			</div>
			{groups ? (
				<Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
					<div className="px-4 pt-3 shrink-0">
						<TabsList className="flex w-full flex-wrap h-auto gap-1 py-1 justify-start">
							{groups.map((g: PropertyGroup) => (
								<TabsTrigger key={g.title} value={g.title} className="text-[11px] px-2 py-1 h-auto">
									{g.title}
								</TabsTrigger>
							))}
							{ungrouped.length > 0 && (
								<TabsTrigger value="Other" className="text-[11px] px-2 py-1 h-auto">Other</TabsTrigger>
							)}
						</TabsList>
					</div>
					<ScrollArea className="flex-1 min-h-0">
						<div className="p-4">
							{groups.map((g: PropertyGroup) => (
								<TabsContent key={g.title} value={g.title} className="mt-0">
									{'properties' in g &&
										g.properties &&
										renderFields(g.properties.filter((p) => p in record.fields))}
									{'component' in g && g.component && (
										<CustomExtensionGroup componentName={g.component} path={path} value={value} />
									)}
								</TabsContent>
							))}
							{ungrouped.length > 0 && (
								<TabsContent value="Other" className="mt-0">
									{renderFields(ungrouped)}
								</TabsContent>
							)}
						</div>
					</ScrollArea>
				</Tabs>
			) : (
				<ScrollArea className="flex-1 min-h-0">
					<div className="p-4">{renderFields(ungrouped)}</div>
				</ScrollArea>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Extension-group renderer (for propertyGroups with `component`)
// ---------------------------------------------------------------------------

function CustomExtensionGroup({
	componentName,
	path,
	value,
}: {
	componentName: string;
	path: NodePath;
	value: unknown;
}) {
	const { data, resource, updateAtPath, setAtPath, getExtension } = useSchemaEditor();
	const Component = getExtension(componentName);
	if (!Component) {
		return (
			<div className="text-xs text-yellow-600 dark:text-yellow-500 border border-yellow-500/30 rounded p-2 bg-yellow-500/5">
				Extension <span className="font-mono">&quot;{componentName}&quot;</span> is not registered.
			</div>
		);
	}
	return (
		<Component
			path={path}
			value={value}
			setValue={(next) => updateAtPath(path, () => next)}
			setData={(next) => setAtPath([], next)}
			data={data}
			resource={resource}
		/>
	);
}

// Silence TS warnings about formatPath import being unused by default —
// kept around because downstream phases will want debug-friendly breadcrumbs.
void formatPath;

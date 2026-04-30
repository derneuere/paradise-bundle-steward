// Schema-driven editor for Texture resources (type 0x0).
//
// Vehicle bundles (e.g. VEH_CARBRWDS_GR.BIN) hold hundreds of Texture
// resources — diffuse / normal / spec / masks at several LODs per mesh
// group. This page uses the tree-embedded collection picker to let the
// user sort by name, format, or pixel count and filter by either; the
// selected texture drives the 2D preview in TextureViewport and the
// header fields shown in the inspector.
//
// The header is all this page edits. Pixel decode happens on demand in
// the viewport via decodeTexture(); edits to header fields are kept in
// memory (setResourceAt) but the handler is read-only, so they're
// dropped on export. Every field is marked readOnly in the schema to
// make that behavior visible.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFirstLoadedBundle, useFirstLoadedBundleId, useWorkspace } from '@/context/WorkspaceContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import {
	MultiResourcePickerContext,
	type MultiResourcePickerValue,
	type PickerRow,
} from '@/components/schema-editor/multiResourcePickerContext';
import {
	ShortcutsHelp,
	PICKER_SHORTCUTS,
	SCHEMA_TREE_SHORTCUTS,
	type ShortcutGroup,
} from '@/components/schema-editor/ShortcutsHelp';
import { textureResourceSchema } from '@/lib/schema/resources/texture';
import { textureHandler } from '@/lib/core/registry/handlers/texture';
import {
	TEXTURE_TYPE_ID,
	decodeTexture,
	type ParsedTextureHeader,
} from '@/lib/core/texture';
import {
	TextureContext,
	type TextureContextValue,
	type TextureDecodeResult,
} from '@/components/schema-editor/viewports/textureContext';
import type { NodePath } from '@/lib/schema/walk';
import type { PickerEntry, PickerResourceCtx } from '@/lib/core/registry/handler';

const TEXTURE_HANDLER_KEY = 'texture';

const TEXTURE_SHORTCUT_GROUPS: ShortcutGroup[] = [
	PICKER_SHORTCUTS,
	SCHEMA_TREE_SHORTCUTS,
];

const TexturePage = () => {
	const { getResources, setResourceAt } = useWorkspace();
	const bundleId = useFirstLoadedBundleId();
	const activeBundle = useFirstLoadedBundle();
	const loadedBundle = activeBundle?.parsed ?? null;
	const originalArrayBuffer = activeBundle?.originalArrayBuffer ?? null;
	const uiResources = activeBundle?.resources ?? [];
	const headers = useMemo(
		() => (bundleId ? [...getResources<ParsedTextureHeader>(bundleId, TEXTURE_HANDLER_KEY)] : []),
		[bundleId, getResources],
	);

	// The resources the decoder maps onto. `getResources('texture')` gives
	// us one model per resource in bundle order, but the decoder also needs
	// the ResourceEntry itself so it can find block 1 (the pixel block).
	const textureResources = useMemo(() => {
		if (!loadedBundle) return [];
		return loadedBundle.resources.filter((r) => r.resourceTypeId === TEXTURE_TYPE_ID);
	}, [loadedBundle]);

	// Pair parsed headers with their bundle-level UIResource so the picker
	// labelOf / searchText callbacks get the debug name + formatted hex id.
	const textureUIResources = useMemo(
		() => uiResources.filter((r) => r.raw?.resourceTypeId === TEXTURE_TYPE_ID),
		[uiResources],
	);

	const pickerCtxs = useMemo<PickerResourceCtx[]>(() => {
		const out: PickerResourceCtx[] = [];
		for (let i = 0; i < headers.length; i++) {
			const ui = textureUIResources[i];
			out.push({
				id: ui?.id ?? `__texture:${i}__`,
				name: ui?.name ?? `Resource_${i}`,
				index: i,
			});
		}
		return out;
	}, [headers.length, textureUIResources]);

	// -------------------------------------------------------------------------
	// Picker state (sort / search / visibility / selection)
	// -------------------------------------------------------------------------

	const pickerConfig = textureHandler.picker!;

	const [sortKey, setSortKey] = useState<string>(pickerConfig.defaultSort);
	const [searchQuery, setSearchQuery] = useState('');
	const [hideEmpty, setHideEmpty] = useState(false); // No "empty" badge for textures; kept for symmetry with the tree-header control.
	const [selectedIndex, setSelectedIndex] = useState<number>(-1);
	const [selectedPath, setSelectedPath] = useState<NodePath>([]);

	// Picker visibility is a no-op for textures (no 3D viewport to dim), but
	// the context still needs a stable visibility set so the eye icon isn't
	// misleadingly grey. Default to "all visible"; the eye still toggles
	// state and the picker row dims, giving the user a lightweight way to
	// mark "don't look at this one again" on a cluttered bundle. Reseeded
	// whenever the underlying resource set changes (e.g. load a new bundle).
	const initBundleRef = useRef<number>(0);
	const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set());
	useEffect(() => {
		if (pickerCtxs.length === 0) return;
		const bundleKey = pickerCtxs.map((c) => c.id).join('|').length;
		if (initBundleRef.current !== bundleKey) {
			initBundleRef.current = bundleKey;
			setVisibleIds(new Set(pickerCtxs.map((c) => c.id)));
		}
	}, [pickerCtxs]);

	// Sort → filter → (ensure selected row included)
	const allEntries = useMemo<PickerEntry<ParsedTextureHeader>[]>(
		() => headers.map((m, i) => ({ model: m, ctx: pickerCtxs[i] })),
		[headers, pickerCtxs],
	);

	const sortedEntries = useMemo(() => {
		const active = pickerConfig.sortKeys.find((k) => k.id === sortKey) ?? pickerConfig.sortKeys[0];
		return [...allEntries].sort((a, b) => active.compare(a, b));
	}, [allEntries, sortKey, pickerConfig]);

	const filteredEntries = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		const textOf = pickerConfig.searchText ?? ((_m: unknown, ctx: PickerResourceCtx) => ctx.name);
		return sortedEntries.filter((e) => {
			if (!q) return true;
			return textOf(e.model, e.ctx).toLowerCase().includes(q);
		});
	}, [sortedEntries, searchQuery, pickerConfig]);

	// Seed selection on first non-empty list — prefer first parseable texture
	// so the preview opens on something decoding-ready.
	useEffect(() => {
		if (selectedIndex !== -1) return;
		if (sortedEntries.length === 0) return;
		const firstParsed = sortedEntries.find((e) => e.model != null);
		const target = firstParsed ?? sortedEntries[0];
		setSelectedIndex(target.ctx.index);
	}, [sortedEntries, selectedIndex]);

	const pickerRows = useMemo<PickerRow[]>(() => {
		const rows = filteredEntries.map<PickerRow>((e) => ({
			modelIndex: e.ctx.index,
			ctx: e.ctx,
			model: e.model,
			label: pickerConfig.labelOf(e.model, e.ctx),
			visible: visibleIds.has(e.ctx.id),
		}));
		if (selectedIndex >= 0 && !rows.some((r) => r.modelIndex === selectedIndex)) {
			const sel = allEntries[selectedIndex];
			if (sel) {
				rows.unshift({
					modelIndex: sel.ctx.index,
					ctx: sel.ctx,
					model: sel.model,
					label: pickerConfig.labelOf(sel.model, sel.ctx),
					visible: visibleIds.has(sel.ctx.id),
				});
			}
		}
		return rows;
	}, [filteredEntries, allEntries, selectedIndex, visibleIds, pickerConfig]);

	const switchTexture = useCallback((nextIndex: number, nextPath: NodePath = []) => {
		setSelectedIndex(nextIndex);
		setSelectedPath(nextPath);
	}, []);

	const onToggleVisible = useCallback((resourceId: string) => {
		setVisibleIds((prev) => {
			const next = new Set(prev);
			if (next.has(resourceId)) next.delete(resourceId);
			else next.add(resourceId);
			return next;
		});
	}, []);

	const onSoloVisible = useCallback(
		(resourceId: string) => {
			setVisibleIds((prev) => {
				const onlySelf = prev.size === 1 && prev.has(resourceId);
				if (onlySelf) return new Set(pickerCtxs.map((c) => c.id));
				return new Set([resourceId]);
			});
		},
		[pickerCtxs],
	);

	const currentModel = selectedIndex >= 0 ? (headers[selectedIndex] ?? null) : null;

	// Re-decode pixel data whenever the selection or source bundle changes.
	// Edits to header fields (via the schema editor) do NOT invalidate this
	// — we key on (bundle, resourceIndex) so the preview doesn't flicker
	// while the user fiddles with width/height/etc. in the inspector.
	const decoded: TextureDecodeResult = useMemo(() => {
		if (!loadedBundle || !originalArrayBuffer) {
			return { status: 'error', error: 'No bundle loaded.' };
		}
		const resource = textureResources[selectedIndex];
		if (!resource) {
			return { status: 'error', error: `No texture at index ${selectedIndex}.` };
		}
		try {
			const d = decodeTexture(originalArrayBuffer, loadedBundle, resource);
			return {
				status: 'ok',
				pixels: d.pixels,
				width: d.header.width,
				height: d.header.height,
			};
		} catch (err) {
			return {
				status: 'error',
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}, [loadedBundle, originalArrayBuffer, textureResources, selectedIndex]);

	const handleChange = useCallback(
		(next: unknown) => {
			if (!bundleId) return;
			setResourceAt(bundleId, TEXTURE_HANDLER_KEY, selectedIndex, next);
		},
		[setResourceAt, selectedIndex, bundleId],
	);

	const pickerContextValue = useMemo<MultiResourcePickerValue | null>(() => {
		if (headers.length <= 1) return null;
		return {
			handlerKey: TEXTURE_HANDLER_KEY,
			rows: pickerRows,
			selectedModelIndex: selectedIndex,
			onSelectModel: (i) => switchTexture(i, []),
			onToggleVisible,
			onSoloVisible,
			sortKey,
			onSortKeyChange: setSortKey,
			sortKeys: pickerConfig.sortKeys,
			searchQuery,
			onSearchQueryChange: setSearchQuery,
			hideEmpty,
			onHideEmptyChange: setHideEmpty,
		};
	}, [
		headers.length,
		pickerRows,
		selectedIndex,
		switchTexture,
		onToggleVisible,
		onSoloVisible,
		sortKey,
		pickerConfig.sortKeys,
		searchQuery,
		hideEmpty,
	]);

	if (headers.length === 0 || !loadedBundle) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Texture</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle containing a Texture resource (type 0x0) to begin.
					</div>
				</CardContent>
			</Card>
		);
	}

	if (selectedIndex < 0) return null;

	if (!currentModel) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Texture</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Texture #{selectedIndex} failed to parse — pick a different one from the tree.
					</div>
				</CardContent>
			</Card>
		);
	}

	const textureCtxValue: TextureContextValue = {
		headers,
		selectedIndex,
		decoded,
	};

	return (
		<div className="h-full min-h-0 flex flex-col gap-3">
			<div className="shrink-0">
				<div className="flex items-center gap-3">
					<h2 className="text-lg font-semibold">Texture — Schema Editor</h2>
					<ShortcutsHelp groups={TEXTURE_SHORTCUT_GROUPS} />
				</div>
				<p className="text-xs text-muted-foreground mt-1">
					Image assets (resource type 0x0). Each Texture pairs a read-only header — pixel format
					(DXT1 / DXT5 / A8R8G8B8), dimensions, mip count, addressing flags — with a pixel block
					decoded on demand for the 2D preview. Downstream Renderables reference textures through
					MaterialAssembly imports; the material-chain resolver in the Renderable editor's
					"Materials &amp; Textures" tab surfaces which mesh group each texture feeds.
				</p>
			</div>
			<div className="flex-1 min-h-0">
				<TextureContext.Provider value={textureCtxValue}>
					<MultiResourcePickerContext.Provider value={pickerContextValue}>
						<SchemaEditorProvider
							resource={textureResourceSchema}
							data={currentModel}
							onChange={handleChange}
							selectedPath={selectedPath}
							onSelectedPathChange={setSelectedPath}
						>
							<SchemaEditor />
						</SchemaEditorProvider>
					</MultiResourcePickerContext.Provider>
				</TextureContext.Provider>
			</div>
		</div>
	);
};

export default TexturePage;

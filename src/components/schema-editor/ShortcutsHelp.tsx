// Reusable "Shortcuts" button + popover for schema-editor pages.
//
// Intent: shortcuts in the schema editor (Ctrl/Cmd-click for bulk, Alt-click
// on the eye icon to solo, 3D viewport click to jump to a polygon) aren't
// discoverable from the UI. This component is the one place they're spelled
// out, rendered as a popover triggered by a ? icon + "Shortcuts" label that
// pages drop next to their title.
//
// Usage:
//   <ShortcutsHelp groups={[PICKER_SHORTCUTS, SCHEMA_TREE_SHORTCUTS, ...]} />
//
// Pages compose the `groups` array from the exported presets plus any
// page-specific entries. No context / registry — keep it dumb until a
// second page actually needs to share more.

import { HelpCircle } from 'lucide-react';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type ShortcutItem = {
	/** Ordered key tokens, rendered as stacked <kbd>s joined by " + ". Non-key
	 *  tokens (e.g. "click", "drag") are accepted too — they render as <kbd>
	 *  all the same, which looks consistent in the popover. */
	keys: string[];
	label: string;
};

export type ShortcutGroup = {
	title: string;
	items: ShortcutItem[];
};

// ---------------------------------------------------------------------------
// Shared presets — pages compose these with their own entries.
// ---------------------------------------------------------------------------

export const PICKER_SHORTCUTS: ShortcutGroup = {
	title: 'Resource picker',
	items: [
		{ keys: ['Click'], label: 'Select a resource for editing' },
		{ keys: ['Click', 'eye'], label: 'Toggle viewport visibility' },
		{ keys: ['Alt', 'Click', 'eye'], label: 'Solo (hide every other resource); Alt-click again to restore' },
	],
};

export const SCHEMA_TREE_SHORTCUTS: ShortcutGroup = {
	title: 'Hierarchy tree',
	items: [
		{ keys: ['Click'], label: 'Select a node to edit its fields in the inspector' },
		{ keys: ['Click', '▶'], label: 'Expand or collapse a record / list' },
	],
};

export const BULK_SHORTCUTS: ShortcutGroup = {
	title: 'Bulk edit',
	items: [
		{ keys: ['Ctrl', 'Click'], label: 'Toggle a polygon in the bulk selection (⌘-click on macOS)' },
		{ keys: ['Shift', 'Click'], label: 'Extend the bulk selection from the current row to this one (same soup)' },
	],
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShortcutsHelp({ groups, className }: { groups: ShortcutGroup[]; className?: string }) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(
						'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors',
						className,
					)}
					aria-label="Keyboard and mouse shortcuts"
				>
					<HelpCircle className="h-3 w-3" />
					Shortcuts
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[360px] p-3 text-xs">
				<div className="font-medium text-sm mb-2">Shortcuts</div>
				<div className="space-y-3">
					{groups.map((g) => (
						<div key={g.title}>
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
								{g.title}
							</div>
							<ul className="space-y-1">
								{g.items.map((item, i) => (
									<li key={i} className="flex items-start gap-2">
										<span className="flex items-center gap-0.5 shrink-0 pt-0.5">
											{item.keys.map((k, idx) => (
												<span key={idx} className="flex items-center gap-0.5">
													{idx > 0 && <span className="text-muted-foreground">+</span>}
													<kbd className="px-1 py-0.5 bg-muted rounded border text-[10px] font-mono">
														{k}
													</kbd>
												</span>
											))}
										</span>
										<span className="text-foreground/80 leading-snug">{item.label}</span>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}

// Decoded inspector for PolygonSoupPoly.collisionTag.
//
// Registered against the schema's `{ kind: 'custom', component: 'collisionTag' }`
// field on PolygonSoupPoly, and reused (via AISectionPicker + FlagCheckbox)
// by the bulk-edit side panel in PolygonSoupListPage so the two flows share
// semantics and pickers.
//
// Editing contract: every change goes through the per-field setters from
// `lib/core/collisionTag`, which clear only the bits they own and paste the
// new value back. The other half of the u32 (and reserved bits + highest-bit
// guards) stay byte-for-byte identical, so the writer round-trips losslessly.

import React, { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Copy } from 'lucide-react';
import type { SchemaExtensionProps, ExtensionRegistry } from '../context';
import { useActiveBundleId, useWorkspace } from '@/context/WorkspaceContext';
import type { ParsedAISections } from '@/lib/core/aiSections';
import { SectionSpeed } from '@/lib/core/aiSections';
import {
	decodeCollisionTag,
	setAiSectionIndex,
	setSurfaceId,
	setTrafficInfo,
	setFlagFatal,
	setFlagDriveable,
	setFlagSuperfatal,
	trafficInfoLabel,
	formatCollisionTagHex,
	AI_SECTION_INDEX_MAX,
	SURFACE_ID_MAX,
	TRAFFIC_INFO_MAX,
} from '@/lib/core/collisionTag';

import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandList,
	CommandItem,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// AI section labels
// ---------------------------------------------------------------------------

const SECTION_SPEED_LABELS: Record<number, string> = {
	[SectionSpeed.E_SECTION_SPEED_VERY_SLOW]: 'Very Slow',
	[SectionSpeed.E_SECTION_SPEED_SLOW]: 'Slow',
	[SectionSpeed.E_SECTION_SPEED_NORMAL]: 'Normal',
	[SectionSpeed.E_SECTION_SPEED_FAST]: 'Fast',
	[SectionSpeed.E_SECTION_SPEED_VERY_FAST]: 'Very Fast',
};

function formatAiSectionLabel(index: number, section: { id: number; speed: number } | undefined): string {
	if (!section) return `#${index}`;
	const speed = SECTION_SPEED_LABELS[section.speed] ?? `Speed ${section.speed}`;
	const idHex = `0x${(section.id >>> 0).toString(16).toUpperCase()}`;
	return `#${index} · ${idHex} · ${speed}`;
}

// ---------------------------------------------------------------------------
// AISectionPicker — popover + command combobox for 15-bit section indices
// ---------------------------------------------------------------------------

type AISectionPickerProps = {
	/** Current AI section index (0–32767). `null` = indeterminate / multi-value. */
	value: number | null;
	onChange: (next: number) => void;
	disabled?: boolean;
	placeholder?: string;
	/** When true, the numeric input + picker render inline. */
	compact?: boolean;
};

export function AISectionPicker({
	value,
	onChange,
	disabled,
	placeholder,
	compact,
}: AISectionPickerProps) {
	const { getResource } = useWorkspace();
	const bundleId = useActiveBundleId();
	const aiSections = bundleId ? getResource<ParsedAISections>(bundleId, 'aiSections') : null;
	const sections = aiSections?.sections;
	const hasSections = !!sections && sections.length > 0;

	const [open, setOpen] = useState(false);

	const buttonLabel = useMemo(() => {
		if (value == null) return placeholder ?? '(mixed)';
		if (!hasSections) return `#${value}`;
		return formatAiSectionLabel(value, sections?.[value]);
	}, [value, sections, hasSections, placeholder]);

	const handleNumericChange = (raw: string) => {
		const v = parseInt(raw, 10);
		if (Number.isFinite(v)) onChange(Math.max(0, Math.min(AI_SECTION_INDEX_MAX, v)));
	};

	return (
		<div className={cn('flex items-center gap-2', compact && 'flex-wrap')}>
			<Input
				type="number"
				inputMode="numeric"
				min={0}
				max={AI_SECTION_INDEX_MAX}
				value={value ?? ''}
				placeholder={placeholder ?? 'index'}
				disabled={disabled}
				className="h-8 w-28 font-mono text-xs"
				onChange={(e) => handleNumericChange(e.target.value)}
			/>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						role="combobox"
						aria-expanded={open}
						disabled={disabled || !hasSections}
						className="h-8 flex-1 min-w-0 justify-between text-xs font-normal"
						title={hasSections ? 'Browse AI sections from the loaded AISections resource' : 'Load an AISections resource to enable the picker'}
					>
						<span className="truncate">{buttonLabel}</span>
						<ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="p-0 w-[22rem]" align="start">
					<Command
						filter={(itemValue, search) => {
							// cmdk lowercases both sides before calling. Return 1 on
							// substring match so the default ranking isn't too strict
							// for numeric + hex queries.
							if (!search) return 1;
							return itemValue.includes(search.toLowerCase()) ? 1 : 0;
						}}
					>
						<CommandInput placeholder="Search index, hex ID, speed…" className="h-9" />
						<CommandList>
							<CommandEmpty>No matching section.</CommandEmpty>
							{sections?.slice(0, 2000).map((section, index) => {
								const label = formatAiSectionLabel(index, section);
								return (
									<CommandItem
										key={index}
										value={label.toLowerCase()}
										onSelect={() => {
											onChange(index);
											setOpen(false);
										}}
									>
										<Check className={cn('mr-2 h-3 w-3', value === index ? 'opacity-100' : 'opacity-0')} />
										<span className="font-mono text-xs truncate">{label}</span>
									</CommandItem>
								);
							})}
							{sections && sections.length > 2000 && (
								<div className="px-3 py-2 text-[11px] text-muted-foreground">
									Showing first 2000 of {sections.length}. Refine the search to narrow further.
								</div>
							)}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}

// ---------------------------------------------------------------------------
// FlagCheckbox — tristate-aware checkbox (for bulk-edit indeterminate state)
// ---------------------------------------------------------------------------

type FlagCheckboxProps = {
	label: string;
	/** `null` = indeterminate (bulk-edit mixed state). */
	value: boolean | null;
	onChange: (next: boolean) => void;
	disabled?: boolean;
};

export function FlagCheckbox({ label, value, onChange, disabled }: FlagCheckboxProps) {
	const state: boolean | 'indeterminate' = value == null ? 'indeterminate' : value;
	return (
		<label className={cn('inline-flex items-center gap-2 text-xs select-none', disabled && 'opacity-50')}>
			<Checkbox
				checked={state}
				disabled={disabled}
				onCheckedChange={(next) => onChange(!!next)}
			/>
			<span>{label}</span>
		</label>
	);
}

// ---------------------------------------------------------------------------
// Main extension — decoded inspector for a single polygon's collisionTag
// ---------------------------------------------------------------------------

export const CollisionTagExtension: React.FC<SchemaExtensionProps> = ({ value, setValue }) => {
	const raw = (typeof value === 'number' ? value : 0) >>> 0;
	const decoded = decodeCollisionTag(raw);

	const [error, setError] = useState<string | null>(null);

	const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));

	const copyRaw = () => {
		const hex = formatCollisionTagHex(raw);
		void navigator.clipboard?.writeText(hex);
	};

	return (
		<div className="space-y-3 rounded border border-border/40 bg-muted/20 p-3">
			{/* AI section index */}
			<div className="space-y-1">
				<div className="text-[11px] font-medium text-muted-foreground">AI section index</div>
				<AISectionPicker
					value={decoded.aiSectionIndex}
					onChange={(next) => setValue(setAiSectionIndex(raw, next))}
				/>
				<p className="text-[10px] text-muted-foreground/70">
					15-bit index (0–{AI_SECTION_INDEX_MAX}) into the AISections resource.
				</p>
			</div>

			{/* Surface ID */}
			<div className="space-y-1">
				<div className="text-[11px] font-medium text-muted-foreground">Surface ID</div>
				<Input
					type="number"
					min={0}
					max={SURFACE_ID_MAX}
					value={decoded.surfaceId}
					className="h-8 w-28 font-mono text-xs"
					onChange={(e) => {
						const v = parseInt(e.target.value, 10);
						if (!Number.isFinite(v)) return;
						if (v < 0 || v > SURFACE_ID_MAX) {
							setError(`Surface ID must be 0–${SURFACE_ID_MAX}`);
							return;
						}
						setError(null);
						setValue(setSurfaceId(raw, clamp(v, SURFACE_ID_MAX)));
					}}
				/>
				<p className="text-[10px] text-muted-foreground/70">6-bit index (0–{SURFACE_ID_MAX}) into the surface list.</p>
			</div>

			{/* Flags */}
			<div className="space-y-1">
				<div className="text-[11px] font-medium text-muted-foreground">Flags</div>
				<div className="flex flex-wrap gap-4">
					<FlagCheckbox
						label="Fatal (wreck)"
						value={decoded.fatal}
						onChange={(v) => setValue(setFlagFatal(raw, v))}
					/>
					<FlagCheckbox
						label="Driveable"
						value={decoded.driveable}
						onChange={(v) => setValue(setFlagDriveable(raw, v))}
					/>
					<FlagCheckbox
						label="Superfatal"
						value={decoded.superfatal}
						onChange={(v) => setValue(setFlagSuperfatal(raw, v))}
					/>
				</div>
			</div>

			{/* Traffic info */}
			<div className="space-y-1">
				<div className="text-[11px] font-medium text-muted-foreground">Traffic info</div>
				<div className="flex items-center gap-3">
					<Input
						type="number"
						min={0}
						max={TRAFFIC_INFO_MAX}
						value={decoded.trafficInfo}
						className="h-8 w-28 font-mono text-xs"
						onChange={(e) => {
							const v = parseInt(e.target.value, 10);
							if (!Number.isFinite(v)) return;
							if (v < 0 || v > TRAFFIC_INFO_MAX) {
								setError(`Traffic info must be 0–${TRAFFIC_INFO_MAX}`);
								return;
							}
							setError(null);
							setValue(setTrafficInfo(raw, clamp(v, TRAFFIC_INFO_MAX)));
						}}
					/>
					<span className="text-xs text-muted-foreground font-mono">{trafficInfoLabel(decoded.trafficInfo)}</span>
				</div>
				<p className="text-[10px] text-muted-foreground/70">
					4-bit value. 0 = no lanes, 1 = unknown, 2–15 = valid angle via <code>(v − 2) / 14 · 2π</code> rad.
				</p>
			</div>

			{error && (
				<div className="text-[11px] text-destructive">{error}</div>
			)}

			{/* Raw u32 + reserved bits (debug) */}
			<div className="pt-2 border-t border-border/40 space-y-1">
				<div className="flex items-center justify-between gap-2">
					<div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Raw u32</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[10px]"
						onClick={copyRaw}
						title="Copy raw hex to clipboard"
					>
						<Copy className="h-3 w-3 mr-1" />
						Copy
					</Button>
				</div>
				<div className="font-mono text-xs">{formatCollisionTagHex(raw)}</div>
				{(decoded.reserved !== 0 || !decoded.materialHighestBit || !decoded.groupHighestBit) && (
					<div className="text-[10px] text-muted-foreground/70 space-y-0.5">
						{decoded.reserved !== 0 && (
							<div>Reserved bits (material 11–10): {decoded.reserved} · preserved verbatim</div>
						)}
						{!decoded.materialHighestBit && (
							<div className="text-yellow-500">Material bit 15 is clear (unusual — preserved verbatim)</div>
						)}
						{!decoded.groupHighestBit && (
							<div className="text-yellow-500">Group bit 15 is clear (unusual — preserved verbatim)</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Registry bundle
// ---------------------------------------------------------------------------

export const polygonSoupListExtensions: ExtensionRegistry = {
	collisionTag: CollisionTagExtension,
};

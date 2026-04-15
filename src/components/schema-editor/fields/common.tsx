// Shared primitives for field renderers.

import React from 'react';
import { Label } from '@/components/ui/label';
import type { FieldMetadata } from '@/lib/schema/types';

// ---------------------------------------------------------------------------
// Shared props — every field renderer accepts this shape
// ---------------------------------------------------------------------------

export type FieldRendererProps<T = unknown> = {
	/** Human-readable label (falls back to the raw field name). */
	label: string;
	/** Current value. */
	value: T;
	/** Setter — writes back to the owning record. */
	onChange: (next: T) => void;
	/** Optional metadata (description, warning, readOnly). */
	meta?: FieldMetadata;
};

// ---------------------------------------------------------------------------
// FieldShell — label / description / warning wrapper
// ---------------------------------------------------------------------------

export function FieldShell({
	label,
	description,
	warning,
	children,
}: {
	label: string;
	description?: string;
	warning?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-1">
			<Label className="text-xs font-medium text-muted-foreground">{label}</Label>
			{children}
			{description && <p className="text-[11px] text-muted-foreground/80">{description}</p>}
			{warning && (
				<p className="text-[11px] text-yellow-600 dark:text-yellow-500">{warning}</p>
			)}
		</div>
	);
}

// Numeric input clamped into a u8/u16/u32/i8/i16/i32 range.
export const INT_RANGES: Record<string, { min: number; max: number }> = {
	u8: { min: 0, max: 0xFF },
	u16: { min: 0, max: 0xFFFF },
	u32: { min: 0, max: 0xFFFFFFFF },
	i8: { min: -128, max: 127 },
	i16: { min: -32768, max: 32767 },
	i32: { min: -2147483648, max: 2147483647 },
};

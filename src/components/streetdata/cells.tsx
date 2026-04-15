// Shared input cells for the StreetData table tabs.
//
// Lifted out of the old monolithic StreetDataEditor.tsx so the per-tab
// components (StreetsTab, JunctionsTab, RoadsTab, ChallengesTab) can share
// a single set of editable cells without duplicating the plumbing.

import React from 'react';
import { Input } from '@/components/ui/input';

export function NumberCell(props: {
	value: number;
	onChange: (v: number) => void;
	step?: number;
	int?: boolean;
	width?: string;
}) {
	const { value, onChange, step = 1, int = true, width = 'w-24' } = props;
	return (
		<Input
			type="number"
			step={step}
			className={`h-7 ${width}`}
			value={Number.isFinite(value) ? value : 0}
			onChange={(e) => {
				const next = int ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
				onChange(Number.isFinite(next) ? next : 0);
			}}
		/>
	);
}

export function BigIntCell(props: { value: bigint; onChange: (v: bigint) => void }) {
	const { value, onChange } = props;
	return (
		<Input
			className="h-7 w-44 font-mono"
			value={value.toString()}
			onChange={(e) => {
				const raw = e.target.value.trim();
				try {
					onChange(raw === '' || raw === '-' ? 0n : BigInt(raw));
				} catch {
					// ignore parse errors, keep previous value
				}
			}}
		/>
	);
}

export function StringCell(props: {
	value: string;
	onChange: (v: string) => void;
	maxLength: number;
	width?: string;
}) {
	const { value, onChange, maxLength, width = 'w-40' } = props;
	return (
		<Input
			className={`h-7 ${width}`}
			maxLength={maxLength}
			value={value.replace(/\0+$/, '')}
			onChange={(e) => onChange(e.target.value)}
		/>
	);
}

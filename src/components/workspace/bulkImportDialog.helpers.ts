// Pure helpers for BulkImportDialog. Parsing the Starting-ID input and
// computing the default starting id live here so the dialog component
// stays focused on layout / wiring.

import type { ParsedAISectionsV12 } from '@/lib/core/aiSections';

/** Parse a user-entered starting id. Accepts decimal (`12345`) or hex
 *  with `0x` prefix (`0x90000000`). Returns null on garbage input. */
export function parseStartingId(input: string): number | null {
	const trimmed = input.trim();
	if (trimmed.length === 0) return null;
	if (/^0x[0-9a-f]+$/i.test(trimmed)) {
		const n = Number.parseInt(trimmed.slice(2), 16);
		return Number.isFinite(n) ? n >>> 0 : null;
	}
	if (/^[0-9]+$/.test(trimmed)) {
		const n = Number.parseInt(trimmed, 10);
		return Number.isFinite(n) ? n >>> 0 : null;
	}
	return null;
}

/** Suggest a starting id high enough to avoid collisions with the
 *  destination's existing sections. Returns `max(existing.id) + 1`,
 *  or 0 when the destination is empty. */
export function defaultStartingId(destination: ParsedAISectionsV12): number {
	let max = -1;
	for (const s of destination.sections) {
		if (s.id > max) max = s.id;
	}
	return (max + 1) >>> 0;
}

/** Detect collisions between the proposed assigned-id range and any id
 *  already on the destination's sections. Returns the colliding ids
 *  sorted ascending. */
export function detectIdCollisions(
	destination: ParsedAISectionsV12,
	startId: number,
	count: number,
): number[] {
	if (count <= 0) return [];
	const lo = startId >>> 0;
	const hi = (startId + count - 1) >>> 0;
	const existingIds = new Set<number>();
	for (const s of destination.sections) existingIds.add(s.id >>> 0);
	const out: number[] = [];
	for (let i = lo; i <= hi; i++) {
		if (existingIds.has(i)) out.push(i);
	}
	return out;
}

/** Format an id as a decimal+hex paired string (`0x9000 (36864)`). */
export function formatIdLabel(id: number): string {
	const u = id >>> 0;
	return `0x${u.toString(16).toUpperCase()} (${u})`;
}

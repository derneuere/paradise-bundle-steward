import { useState, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Selection type
// ---------------------------------------------------------------------------

// PVS cells are not owned by a hull — they are top-level entries in the
// TrafficData root, so they need their own variant in the selection union.
// Use `isPvsCellSelection` to discriminate.
export type PvsCellSelection = { kind: 'pvsCell'; cellIndex: number };

export type HullSelection = {
	hullIndex: number;
	sub?:
		| { type: 'section'; index: number }
		| { type: 'rung'; index: number }
		| { type: 'junction'; index: number }
		| { type: 'lightTrigger'; index: number }
		| { type: 'staticVehicle'; index: number };
};

export type TrafficDataSelection = HullSelection | PvsCellSelection | null;

export function isPvsCellSelection(s: TrafficDataSelection): s is PvsCellSelection {
	return s != null && (s as { kind?: string }).kind === 'pvsCell';
}

export function isHullSelection(s: TrafficDataSelection): s is HullSelection {
	return s != null && (s as { kind?: string }).kind !== 'pvsCell';
}

// ---------------------------------------------------------------------------
// Sub-type → tab mapping
// ---------------------------------------------------------------------------

const SUB_TYPE_TO_TAB: Record<string, string> = {
	section: 'sections',
	rung: 'rungs',
	junction: 'junctions',
	lightTrigger: 'lightTriggers',
	staticVehicle: 'staticVehicles',
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTrafficSelection() {
	const [selected, setSelected] = useState<TrafficDataSelection>(null);
	const [activeHullIndex, setActiveHullIndex] = useState(0);
	const [tab, setTab] = useState('overview');
	const scrollToIndexRef = useRef<((index: number) => void) | null>(null);

	const select = useCallback((sel: TrafficDataSelection) => {
		setSelected(sel);
		if (!sel) return;
		// PVS cells aren't bound to a hull or one of the existing tabs, so
		// don't shuffle the table tabs underneath when one is picked.
		if (isPvsCellSelection(sel)) return;
		setActiveHullIndex(sel.hullIndex);
		if (sel.sub) {
			const nextTab = SUB_TYPE_TO_TAB[sel.sub.type];
			if (nextTab) setTab(nextTab);
			requestAnimationFrame(() => scrollToIndexRef.current?.(sel.sub!.index));
		}
	}, []);

	return { selected, select, activeHullIndex, setActiveHullIndex, tab, setTab, scrollToIndexRef };
}

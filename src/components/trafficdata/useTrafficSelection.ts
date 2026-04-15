import { useState, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Selection type
// ---------------------------------------------------------------------------

export type TrafficDataSelection = {
	hullIndex: number;
	sub?:
		| { type: 'section'; index: number }
		| { type: 'rung'; index: number }
		| { type: 'junction'; index: number }
		| { type: 'lightTrigger'; index: number }
		| { type: 'staticVehicle'; index: number };
} | null;

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
		setActiveHullIndex(sel.hullIndex);
		if (sel.sub) {
			const nextTab = SUB_TYPE_TO_TAB[sel.sub.type];
			if (nextTab) setTab(nextTab);
			requestAnimationFrame(() => scrollToIndexRef.current?.(sel.sub!.index));
		}
	}, []);

	return { selected, select, activeHullIndex, setActiveHullIndex, tab, setTab, scrollToIndexRef };
}

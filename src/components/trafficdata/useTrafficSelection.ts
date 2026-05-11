// ---------------------------------------------------------------------------
// Selection type
// ---------------------------------------------------------------------------

// PVS cells are not owned by a hull — they are top-level entries in the
// TrafficData root, so they need their own variant in the selection union.
// Use `isPvsCellSelection` to discriminate.
export type PvsCellSelection = { kind: 'pvsCell'; cellIndex: number };

type HullSelection = {
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
